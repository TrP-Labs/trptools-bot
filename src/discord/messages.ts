import { Routes, type Client, type MessageEditOptions } from 'discord.js'
import type { RawFile } from '@discordjs/rest'
import type { PostedMessage } from '../state'

type Json = Record<string, any>

function json(value: any): any {
    if (value && typeof value.toJSON === 'function') return value.toJSON()
    if (Array.isArray(value)) return value.map(json)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, json(part)]))
    }
    return value
}

export function bodyAndFiles(payload: Json): { body: Json; files: RawFile[] } {
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

export function missingMessage(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 10008
}

// Both runtimes already know the channel and message IDs. Fetching either
// before a mutation adds latency without changing Discord's access checks.
export async function editPosted(client: Client, posted: PostedMessage, payload: MessageEditOptions) {
    return client.rest.patch(Routes.channelMessage(posted.channelId, posted.messageId), bodyAndFiles(payload as Json))
}

export async function deletePosted(client: Client, posted: PostedMessage) {
    return client.rest.delete(Routes.channelMessage(posted.channelId, posted.messageId))
}
