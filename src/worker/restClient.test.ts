import { expect, test } from 'bun:test'
import { EmbedBuilder, REST } from 'discord.js'
import { createRestClient } from './restClient'
import { editPosted, deletePosted } from '../discord/messages'

test('REST channel adapter sends Discord API message and poll shapes', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const rest = new REST({ version: '10', makeRequest: async (url, init) => {
        calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null })
        return Response.json(calls.length === 1 ? { id: '10', type: 0 } : { id: '20' }) as any
    } }).setToken('test-token')
    const channel = await createRestClient(rest).channels.fetch('10')
    if (!channel?.isSendable()) throw new Error('Expected text channel')
    await channel.send({
        embeds: [new EmbedBuilder().setTitle('Shift')],
        poll: {
            question: { text: 'How was it?' },
            answers: [{ text: 'Good', emoji: '👍' }],
            allowMultiselect: false,
            duration: 24
        }
    })
    expect(calls[1]?.body.embeds[0].title).toBe('Shift')
    expect(calls[1]?.body.poll.answers[0].poll_media).toEqual({ text: 'Good', emoji: { name: '👍' } })
    expect(calls[1]?.body.poll.allow_multiselect).toBe(false)
})

test('stored message edits and deletes use one Discord request each', async () => {
    const calls: Array<{ method: unknown; url: string; body: any }> = []
    const rest = new REST({ version: '10', makeRequest: async (url, init) => {
        calls.push({ method: init.method, url, body: init.body ? JSON.parse(String(init.body)) : null })
        return init.method === 'DELETE' ? new Response(null, { status: 204 }) as any : Response.json({ id: '20' }) as any
    } }).setToken('test-token')
    const client = createRestClient(rest)
    const posted = { channelId: '10', messageId: '20' }
    await editPosted(client, posted, { embeds: [new EmbedBuilder().setTitle('Updated')] })
    await deletePosted(client, posted)
    expect(calls.map((call) => call.method)).toEqual(['PATCH', 'DELETE'])
    expect(calls[0]?.body.embeds[0].title).toBe('Updated')
    expect(calls.every((call) => call.url.endsWith('/channels/10/messages/20'))).toBe(true)
})
