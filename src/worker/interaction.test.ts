import { expect, test } from 'bun:test'
import { REST } from 'discord.js'
import { configureEnv } from '../env'
import { createInteraction } from './interaction'

test('HTTP interaction acknowledges through Discord and edits the original reply', async () => {
    configureEnv({
        DISCORD_APP_ID: '123', DISCORD_BOT_TOKEN: 'bot-token',
        API_URL: 'https://example.invalid', BOT_SERVICE_TOKEN: 'service-token'
    })
    const calls: Array<{ url: string; authorization: string | null; body: any }> = []
    const rest = new REST({ version: '10', makeRequest: async (input, init) => {
        calls.push({
            url: String(input),
            authorization: new Headers(init?.headers as HeadersInit).get('authorization'),
            body: init?.body ? JSON.parse(String(init.body)) : null
        })
        return calls.length === 1
            ? new Response(null, { status: 204 }) as any
            : Response.json({ id: '456' }) as any
    } })

    const { interaction, acknowledged } = createInteraction({ id: '123456789012345678', token: 'interaction-token', type: 2 }, rest)
    if (!interaction.isChatInputCommand()) throw new Error('Expected command')
    await interaction.deferReply()
    await interaction.deferReply()
    await acknowledged
    await interaction.editReply({ content: 'done' })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('/interactions/123456789012345678/interaction-token/callback')
    expect(calls[0]?.authorization).toBeNull()
    expect(calls[0]?.body).toEqual({ type: 5, data: {} })
    expect(calls[1]?.url).toContain('/webhooks/123/interaction-token/messages/%40original')
    expect(calls[1]?.body).toEqual({ content: 'done' })
})

test('inline deferral removes the callback request and still permits a webhook edit', async () => {
    const calls: string[] = []
    const responses: unknown[] = []
    const rest = new REST({ version: '10', makeRequest: async (url) => {
        calls.push(String(url))
        return Response.json({ id: '456' }) as any
    } })
    const { interaction, acknowledged } = createInteraction(
        { id: '123456789012345678', token: 'token', type: 3 }, rest, false, (response) => { responses.push(response) }
    )
    await (interaction as any).deferReply({ flags: 64 })
    await acknowledged
    expect(calls).toHaveLength(0)
    expect(responses).toEqual([{ type: 5, data: { flags: 64 } }])
    await (interaction as any).editReply({ content: 'done' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/webhooks/123/token/messages/%40original')
})

test('withResponse is sent as a callback query parameter', async () => {
    const calls: Array<{ url: string; body: any }> = []
    const rest = new REST({ version: '10', makeRequest: async (url, init) => {
        calls.push({ url, body: JSON.parse(String(init.body)) })
        return Response.json({ resource: { message: { timestamp: '2026-09-22T00:00:00Z' } } }) as any
    } })
    const { interaction } = createInteraction({ id: '123456789012345678', token: 'token', type: 2 }, rest)
    if (!interaction.isChatInputCommand()) throw new Error('Expected command')
    const response = await interaction.reply({ content: 'Pinging', withResponse: true })
    expect(calls[0]?.url).toContain('with_response=true')
    expect(calls[0]?.body).toEqual({ type: 4, data: { content: 'Pinging' } })
    expect(response.resource?.message?.createdTimestamp).toBe(Date.parse('2026-09-22T00:00:00Z'))
})

test('queued command resumes an already deferred interaction', async () => {
    const calls: string[] = []
    const rest = new REST({ version: '10', makeRequest: async (url) => {
        calls.push(String(url))
        return Response.json({ id: '456' }) as any
    } })
    const { interaction, acknowledged } = createInteraction(
        { id: '123456789012345678', token: 'token', type: 2 }, rest, true
    )
    if (!interaction.isChatInputCommand()) throw new Error('Expected command')
    await acknowledged
    await interaction.deferReply()
    await interaction.editReply({ content: 'done' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/webhooks/123/token/messages/%40original')
})

test('a consumer can finish before Discord has created the deferred reply', async () => {
    let attempts = 0
    const rest = new REST({ version: '10', makeRequest: async () => {
        attempts++
        return attempts === 1
            ? Response.json({ code: 10008, message: 'Unknown Message' }, { status: 404 }) as any
            : Response.json({ id: '456' }) as any
    } })
    const { interaction } = createInteraction({ id: '123456789012345678', token: 'token', type: 2 }, rest, true)
    await (interaction as any).editReply({ content: 'done' })
    expect(attempts).toBe(2)
})

test('modal labels resolve text fields and native uploaded attachments',()=>{
 const {interaction}=createInteraction({id:'123',token:'token',type:5,data:{custom_id:'edit',components:[{type:18,component:{type:4,custom_id:'note',value:'Changed'}},{type:18,component:{type:19,custom_id:'image',values:['image-id']}}],resolved:{attachments:{'image-id':{id:'image-id',filename:'shift.png',url:'https://cdn.discordapp.com/attachments/channel/message/shift.png'}}}}} as any,new REST())
 if(!interaction.isModalSubmit())throw new Error('Expected modal')
 expect(interaction.fields.getTextInputValue('note')).toBe('Changed')
 expect(interaction.fields.getUploadedFiles('image')?.first()?.url).toBe('https://cdn.discordapp.com/attachments/channel/message/shift.png')
})
