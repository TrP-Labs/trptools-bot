import { REST, Routes, type Interaction } from 'discord.js'
import { env } from '../env'

type Payload = {
    id: string
    token: string
    type: number
    guild_id?: string
    member?: { user?: { id: string; username: string; global_name?: string } }
    user?: { id: string; username: string; global_name?: string }
    data?: {
        name?: string
        custom_id?: string
        component_type?: number
        values?: string[]
        options?: Array<{ name: string; value?: string }>
        components?: Array<{ components?: Array<{ custom_id: string; value?: string }> }>
    }
}

function json(value: any): any {
    if (value && typeof value.toJSON === 'function') return value.toJSON()
    if (Array.isArray(value)) return value.map(json)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, json(part)]))
    }
    return value
}

/** Adapt Discord's signed HTTP payload to the narrow interaction API our commands use. */
export function createInteraction(payload: Payload, rest = new REST({ version: '10' }), initiallyDeferred = false) {
    let replied = false
    let deferred = initiallyDeferred
    let acknowledging = false
    let notify!: () => void
    const acknowledged = new Promise<void>((resolve) => { notify = resolve })
    if (initiallyDeferred) notify()

    async function callback(type: number, data?: any, withResponse = false) {
        if (replied || deferred) throw new Error('Interaction already acknowledged')
        acknowledging = true
        let result: unknown
        try {
            result = await rest.post(Routes.interactionCallback(payload.id, payload.token), {
                auth: false,
                body: data === undefined ? { type } : { type, data: json(data) },
                query: withResponse ? new URLSearchParams({ with_response: 'true' }) : undefined
            })
        } finally {
            acknowledging = false
        }
        replied = type !== 5 && type !== 6
        deferred = type === 5 || type === 6
        notify()
        return result
    }

    const user = payload.member?.user ?? payload.user ?? { id: '', username: '' }
    const data = payload.data
    const interaction = {
        id: payload.id,
        token: payload.token,
        guildId: payload.guild_id ?? null,
        commandName: data?.name ?? '',
        customId: data?.custom_id ?? '',
        values: data?.values ?? [],
        user: { ...user, displayName: user.global_name ?? user.username },
        createdTimestamp: Number((BigInt(payload.id) >> 22n) + 1420070400000n),
        options: { getString: (name: string) => data?.options?.find((option) => option.name === name)?.value ?? null },
        fields: {
            getTextInputValue: (name: string) => data?.components?.flatMap((row) => row.components ?? [])
                .find((field) => field.custom_id === name)?.value ?? ''
        },
        get replied() { return replied },
        get deferred() { return deferred },
        isRepliable: () => true,
        isChatInputCommand: () => payload.type === 2,
        isButton: () => payload.type === 3 && data?.component_type === 2,
        isAnySelectMenu: () => payload.type === 3 && [3, 5, 6, 7, 8].includes(data?.component_type ?? 0),
        isStringSelectMenu: () => payload.type === 3 && data?.component_type === 3,
        isModalSubmit: () => payload.type === 5,
        async reply(value: any): Promise<any> {
            if (replied || deferred) {
                const { flags: _flags, withResponse: _withResponse, ...edit } = value
                return interaction.editReply(edit)
            }
            const { withResponse, ...data } = value
            const result = await callback(4, data, withResponse === true)
            if (result && typeof result === 'object') {
                const response = result as { resource?: { message?: { timestamp?: string; createdTimestamp?: number } } }
                if (response.resource?.message) {
                    response.resource.message.createdTimestamp = Date.parse(response.resource.message.timestamp ?? '') || Date.now()
                }
                return response
            }
            return { resource: { message: { createdTimestamp: Date.now() } } }
        },
        async deferReply(value?: any) {
            if (deferred) return
            await callback(5, value ?? {})
        },
        async editReply(value: any): Promise<any> {
            if (!replied && !deferred) return interaction.reply(value)
            return rest.patch(Routes.webhookMessage(env.DISCORD_APP_ID, payload.token, '@original'), {
                auth: false,
                body: json(value)
            })
        },
        async showModal(value: any) { await callback(9, value) }
    }

    return {
        interaction: interaction as unknown as Interaction,
        acknowledged,
        isAcknowledged: () => replied || deferred,
        isAcknowledging: () => acknowledging
    }
}
