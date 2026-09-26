import { afterEach, expect, test } from 'bun:test'
import type { Client, Interaction } from 'discord.js'
import { api, type Guild, type Sheet, type Shift } from '../api'
import { state } from '../state'
import { refreshBoard } from './automation'
import { clearShiftMessages } from './completion'
import { postSheets, refreshSheets } from './signups'
import { handler as signup } from '../interactions/signup'
import { encodeSignup } from '../discord/ids'
import { postManifest } from './manifest'

const originalState = { ...state }
const originalApi = { ...api }
afterEach(() => { Object.assign(state, originalState); Object.assign(api, originalApi) })

const shift = {
    eventId: '11111111-1111-1111-1111-111111111111', name: 'Shift', slug: 'shift', color: '#4287f5',
    start: '2026-09-26T12:00:00.123Z', end: '2026-09-26T13:00:00.123Z'
} as Shift
const guild = {
    guildId: 'g', groupName: 'Group', groupSlug: 'group', siteUrl: 'https://example.com',
    config: { manifestEnabled: true, manifestRefreshSeconds: 300, languages: ['en'] }
} as Guild
const sheet = (id: string): Sheet => ({
    sheetId: id, rankNames: [], name: id, description: '', color: '#4287f5', discordChannel: 'c', discordPingRole: null,
    slots: [{ id: 'slot', name: 'Driver', description: '', capacity: 1, order: 0, signups: [] }]
})

test('cleanup preserves failed deletions and treats only unknown messages as already gone', async () => {
    const entries = ['deleted', 'missing', 'blocked'].map((messageId) => ({ field: 'upcoming', channelId: 'c', messageId }))
    let forgotten = 0
    let blocked = true
    state.allFor = async () => entries
    state.forget = async () => { forgotten++ }
    const client = { rest: { delete: async (route: string) => {
        if (route.endsWith('/missing')) throw { code: 10008 }
        if (blocked && route.endsWith('/blocked')) throw { code: 50013 }
    } } } as unknown as Client
    expect(await clearShiftMessages(client, guild, shift)).toMatchObject({ removed: 1, failed: 1, blockedChannels: ['c'] })
    expect(forgotten).toBe(0)
    blocked = false
    expect(await clearShiftMessages(client, guild, shift)).toMatchObject({ removed: 2, failed: 0 })
    expect(forgotten).toBe(1)
})

test('posting existing sheets reads mappings once and makes no preliminary Discord fetches', async () => {
    let reads = 0
    const edits: string[] = []
    const sheets = [sheet('22222222-2222-2222-2222-222222222222'), sheet('33333333-3333-3333-3333-333333333333')]
    state.allFor = async () => {
        reads++
        return sheets.map((sheet) => ({ field: `sheet:${sheet.sheetId}`, channelId: 'c', messageId: sheet.sheetId }))
    }
    state.findSheet = async () => { throw new Error('Unexpected individual mapping read') }
    const client = { rest: { patch: async (route: string) => { edits.push(route) } } } as unknown as Client
    expect((await postSheets(client, guild, shift, sheets)).posted).toHaveLength(2)
    expect(reads).toBe(1)
    expect(edits).toHaveLength(2)
})

test('coalesced sheets reuse the resolved guild and one authoritative occurrence', async () => {
    let reads = 0
    let edits = 0
    const sheets = [sheet('22222222-2222-2222-2222-222222222222'), sheet('33333333-3333-3333-3333-333333333333')]
    api.guildStrict = async () => { throw new Error('Unexpected repeated guild read') }
    api.occurrenceStrict = async () => { reads++; return { shift, sheets } }
    state.allFor = async () => sheets.map((sheet) => ({ field: `sheet:${sheet.sheetId}`, channelId: 'c', messageId: sheet.sheetId }))
    const client = { rest: { patch: async () => { edits++ } } } as unknown as Client
    await refreshSheets(client, guild.guildId, shift.eventId, shift.start, sheets.map((sheet) => sheet.sheetId), guild)
    expect(reads).toBe(1)
    expect(edits).toBe(2)
})

test('board refresh respects the interval and does not upload an unchanged image', async () => {
    let reads = 0
    const tracked = { eventId: shift.eventId, occurrence: shift.start, checkedAt: Date.now(), etag: '"v1"', presentation: JSON.stringify([['en'], shift.color]) }
    state.trackedManifest = async () => tracked
    api.occurrenceStrict = async () => { reads++; return { shift, sheets: [] } }
    state.findManifest = async () => ({ channelId: 'c', messageId: 'm' })
    api.manifest = async (_id, etag) => { expect(etag).toBe('"v1"'); return { status: 'unchanged', etag } }
    state.trackManifest = async (_guild, _event, _occurrence, metadata) => { expect(metadata?.checkedAt).toBeGreaterThan(tracked.checkedAt) }
    const client = { rest: { patch: async () => { throw new Error('Unchanged board was uploaded') } } } as unknown as Client
    await refreshBoard(client, guild)
    expect(reads).toBe(0)
    tracked.checkedAt -= 301_000
    await refreshBoard(client, guild)
    expect(reads).toBe(1)
})

test('a manifest API failure keeps the active board available for retry', async () => {
    const tracked = { eventId: shift.eventId, occurrence: shift.start }
    api.occurrenceStrict = async () => ({ shift, sheets: [] })
    state.findManifest = async () => ({ channelId: 'c', messageId: 'm' })
    state.untrackManifest = async () => { throw new Error('A temporary failure removed the pointer') }
    api.manifest = async () => { throw new Error('Temporary outage') }
    await expect(refreshBoard({} as Client, guild, tracked)).rejects.toThrow('Temporary outage')
})

test('a delivered signup notification prevents a duplicate interaction redraw', async () => {
    const sheetId = '22222222-2222-2222-2222-222222222222'
    const currentGuild = { ...guild, sheets: [sheet(sheetId)] }
    api.guild = async () => currentGuild
    api.signup = async () => ({ status: 'TAKEN', slotName: 'Driver', previousSlotName: null, syncDelivered: true })
    api.occurrence = async () => { throw new Error('Duplicate redraw read the occurrence') }
    let replies = 0
    const interaction = {
        isStringSelectMenu: () => true, guildId: 'g',
        customId: encodeSignup({ eventId: shift.eventId, occurrence: shift.start, sheetId }), values: ['slot'],
        user: { id: 'user', username: 'Driver' }, deferReply: async () => {}, editReply: async () => { replies++ }
    } as unknown as Interaction
    await signup.execute(interaction, {} as Client)
    expect(replies).toBe(1)
})

test('presentation changes invalidate the board validator even when vehicle state is unchanged', async () => {
    api.occurrenceStrict = async () => ({ shift, sheets: [] })
    state.findManifest = async () => ({ channelId: 'c', messageId: 'm' })
    api.manifest = async (_id, etag) => {
        expect(etag).toBeUndefined()
        return { status: 'changed', image: Buffer.from('PNG'), etag: '"v1"' }
    }
    state.trackManifest = async (_guild, _event, _occurrence, metadata) => {
        expect(metadata?.presentation).toBe(JSON.stringify([['en'], shift.color]))
    }
    let edits = 0
    const client = { rest: { patch: async () => { edits++ } } } as unknown as Client
    await refreshBoard(client, guild, { eventId: shift.eventId, occurrence: shift.start,
        etag: '"v1"', presentation: JSON.stringify([['en'], '#000000']) })
    expect(edits).toBe(1)
})

test('a retried begin reuses its recorded board instead of posting a duplicate', async () => {
    state.findManifest = async () => ({ channelId: 'c', messageId: 'm' })
    state.trackedManifest = async () => ({ eventId: shift.eventId, occurrence: shift.start })
    api.manifest = async () => { throw new Error('Recorded board rendered again') }
    expect(await postManifest({} as Client, guild, shift)).toBe(true)
})
