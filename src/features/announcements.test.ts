import { expect, test } from 'bun:test'
import { DiscordAPIError, type Client } from 'discord.js'
import type { Guild, Shift } from '../api'
import { state } from '../state'
import { announceUpcoming } from './announcements'

test('a deleted upcoming post is sent again instead of being reported as announced', async () => {
    const findNotice = state.findNotice
    const rememberNotice = state.rememberNotice
    const sent: unknown[] = []
    const remembered: unknown[] = []

    state.findNotice = async () => ({ channelId: 'channel-1', messageId: 'deleted-message' })
    state.rememberNotice = async (...args) => { remembered.push(args) }

    const client = {
        channels: {
            fetch: async () => ({
                id: 'channel-1',
                isSendable: () => true,
                messages: {
                    fetch: async () => {
                        throw new DiscordAPIError(
                            { code: 10008, message: 'Unknown Message' }, 10008, 404,
                            'GET', '/channels/channel-1/messages/deleted-message', { body: undefined, files: undefined }
                        )
                    }
                },
                send: async (payload: unknown) => {
                    sent.push(payload)
                    return { id: 'new-message' }
                }
            })
        }
    } as unknown as Client
    const guild = {
        guildId: 'guild-1', groupSlug: 'group', groupName: 'Group', siteUrl: 'https://example.com',
        config: { announcementChannel: 'channel-1', languages: ['en'], pingUpcoming: false }
    } as Guild
    const shift = {
        eventId: 'event-1', slug: 'shift', name: 'Shift', description: '', note: '', color: '#4287f5',
        start: '2026-09-25T15:30:00.000Z', end: '2026-09-25T16:30:00.000Z'
    } as Shift

    try {
        expect(await announceUpcoming(client, guild, shift)).toEqual({ ok: true, channelId: 'channel-1' })
        expect(sent).toHaveLength(1)
        expect(remembered).toEqual([[
            'event-1', '2026-09-25T15:30:00.000Z', 'upcoming',
            { channelId: 'channel-1', messageId: 'new-message' }
        ]])
    } finally {
        state.findNotice = findNotice
        state.rememberNotice = rememberNotice
    }
})
