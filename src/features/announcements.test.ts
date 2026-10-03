import { expect, test } from 'bun:test'
import { DiscordAPIError, type Client } from 'discord.js'
import type { Guild, Shift } from '../api'
import { state } from '../state'
import { announceUpcoming, announceStart, remindHost } from './announcements'

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

test('editing a posted announcement updates its original channel without another ping',async()=>{
 const original=state.findNotice; const edits:any[]=[]; const channels:string[]=[]
 state.findNotice=async()=>({channelId:'old-channel',messageId:'message'})
 const client={channels:{fetch:async(id:string)=>{channels.push(id);return {id,isSendable:()=>true,messages:{fetch:async()=>({edit:async(payload:any)=>edits.push(payload)})},send:async()=>{throw new Error('An edit must not send a new notice')}}}}} as unknown as Client
 const guild={guildId:'guild',groupSlug:'group',groupName:'Group',siteUrl:'https://example.com',config:{announcementChannel:'new-channel',languages:['en'],pingUpcoming:true}} as Guild
 const shift={eventId:'event',slug:'shift',name:'Shift',description:'',note:'Updated note',color:'#4287f5',imageUrl:'https://images.example.com/shift.png',start:'2026-09-27T12:00:00Z',end:'2026-09-27T13:00:00Z'} as Shift
 try{
  expect(await announceUpcoming(client,guild,shift,true)).toEqual({ok:true,channelId:'old-channel'})
  expect(channels).toEqual(['old-channel']);expect(edits).toHaveLength(1)
  expect(edits[0].allowedMentions).toEqual({parse:[]})
  const embed=edits[0].embeds[0].toJSON()
  expect(embed.description).toContain('Updated note');expect(embed.image.url).toBe(shift.imageUrl)
 }finally{state.findNotice=original}
})


test('public demand announcement uses one button, an exact dated link, and disables voting after a decision', async () => {
    const find = state.findNotice, remember = state.rememberNotice
    const sent: any[] = []
    state.findNotice = async () => null
    state.rememberNotice = async () => {}
    const client = { channels: { fetch: async () => ({ id: 'channel', isSendable: () => true,
        send: async (payload: any) => { sent.push(payload); return { id: 'notice' } } }) } } as unknown as Client
    const guild = { guildId: 'guild', groupSlug: 'group', groupName: 'Group', siteUrl: 'https://example.com',
        config: { announcementChannel: 'channel', languages: ['en'], pingUpcoming: false } } as Guild
    const shift = { eventId: '12345678-1234-1234-1234-123456789012', slug: 'shift', name: 'Shift', description: '', note: '', color: '#4287f5',
        start: new Date(Date.now() + 3600000).toISOString(), end: new Date(Date.now() + 7200000).toISOString(), onDemand: true,
        decision: 'PENDING', voteOpensAt: new Date(Date.now() - 60000).toISOString(), decisionAt: new Date(Date.now() + 60000).toISOString(),
        minimumVotes: 5, voteCount: 2, voters: [], withdrawnVoters: [], ownerRobloxId: null, signupsOpenAt: new Date().toISOString(), signupsOpen: false } as Shift
    try {
        await announceUpcoming(client, guild, shift)
        const components = sent[0].components[0].toJSON().components
        expect(components).toHaveLength(2)
        expect(components.every((c: any) => c.type === 2)).toBe(true)
        expect(components[0].url).toEndWith('/shift/shift/' + new Date(shift.start).getTime())
        expect(components[1].custom_id).toStartWith('shift-vote:')
        expect(components[1].disabled).toBe(false)
        expect(sent[0].embeds[0].toJSON().description).toContain('2')
        shift.decision = 'FAILED'
        await announceUpcoming(client, guild, shift)
        expect(sent[1].components[0].toJSON().components[1].disabled).toBe(true)
        expect(sent[1].embeds[0].toJSON().description).toContain('did not')
        expect((await announceStart(client, guild, shift)).ok).toBe(false)
        expect((await remindHost(client, guild, shift)).ok).toBe(false)
        expect(sent).toHaveLength(2)
    } finally { state.findNotice = find; state.rememberNotice = remember }
})
