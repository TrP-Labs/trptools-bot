import { REST, Routes, type Client } from 'discord.js'
import type { RawFile } from '@discordjs/rest'
import { env } from '../env'

type Json = Record<string, any>

function json(value: any): any {
    if (value && typeof value.toJSON === 'function') return value.toJSON()
    if (Array.isArray(value)) return value.map(json)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, json(part)]))
    }
    return value
}

function bodyAndFiles(payload: Json): { body: Json; files: RawFile[] } {
    const { files: attachments = [], reply, poll, attachments: retained, ...rest } = payload
    const files: RawFile[] = attachments.map((file: any) => ({
        data: file.attachment,
        name: file.name ?? 'file'
    }))
    const body: Json = json(rest)
    if (reply) body.message_reference = {
        message_id: reply.messageReference,
        fail_if_not_exists: reply.failIfNotExists
    }
    if (poll) body.poll = {
        question: poll.question,
        answers: poll.answers.map((answer: any) => ({
            poll_media: {
                text: answer.text,
                emoji: typeof answer.emoji === 'string' ? { name: answer.emoji } : answer.emoji
            }
        })),
        allow_multiselect: poll.allowMultiselect,
        duration: poll.duration,
        layout_type: 1
    }
    if (retained) body.attachments = retained
    if (files.length) body.attachments = files.map((file, id) => ({ id, filename: file.name }))
    return { body, files }
}

/** A narrow REST-backed stand-in for the channel methods used by the bot. */
export function createRestClient(rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)): Client {

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

    return { channels } as unknown as Client
}
