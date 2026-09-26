import { REST, Routes, type Client } from 'discord.js'
import type { ResponseLike } from '@discordjs/rest'
import { bodyAndFiles } from '../discord/messages'
import { timed } from '../timing'
import { state } from '../state'
import { env } from '../env'

type Json = Record<string, any>

/** A narrow REST-backed stand-in for the channel methods used by the bot. */
export function createRestClient(rest = new REST({ version: '10', makeRequest: async (url, init) => {
    await state.discordRequest()
    return timed('discord', { method: init.method }, async () => await fetch(url, init as RequestInit) as unknown as ResponseLike)
} }).setToken(env.DISCORD_BOT_TOKEN)): Client {

    const message = (channelId: string, messageId: string) => ({
        id: messageId,
        async edit(payload: Json) {
            const data = bodyAndFiles(payload)
            return rest.patch(Routes.channelMessage(channelId, messageId), data)
        },
        async delete() {
            return rest.delete(Routes.channelMessage(channelId, messageId))
        }
    })

    const channels = {
        async fetch(channelId: string) {
            const raw = await rest.get(Routes.channel(channelId)) as { id: string; type: number }
            const textBased = [0, 5, 10, 11, 12].includes(raw.type)
            return {
                id: raw.id,
                isTextBased: () => textBased,
                isSendable: () => textBased,
                async send(payload: Json) {
                    const data = bodyAndFiles(payload)
                    return rest.post(Routes.channelMessages(channelId), data) as Promise<{ id: string }>
                },
                messages: {
                    async fetch(messageId: string) {
                        await rest.get(Routes.channelMessage(channelId, messageId))
                        return message(channelId, messageId)
                    }
                }
            }
        }
    }

    return { channels, rest } as unknown as Client
}
