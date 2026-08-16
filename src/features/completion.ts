import type { Client } from 'discord.js'
import type { Guild, Shift } from '../api'
import { sendable } from '../discord/channels'
import { log } from '../log'
import { state } from '../state'

/**
 * Closing a shift out: clearing the sheets it posted and asking how it went.
 *
 * The legacy bot bulk-deleted the last hundred messages in every configured
 * channel, which also destroyed anything people had said in them. This deletes
 * only the messages the bot itself posted for this occurrence, which is what
 * the message bookkeeping in Redis exists for.
 */

const POLL_ANSWERS = [
    { text: 'I loved it', emoji: '❤️' },
    { text: 'I liked it', emoji: '👍' },
    { text: 'It could be better', emoji: '🤷' },
    { text: 'I did not like it', emoji: '👎' },
    { text: 'I hated it', emoji: '💔' }
]

export type ClearResult = {
    removed: number
    /**
     * Messages that were still there and could not be deleted, which almost
     * always means the bot lost Manage Messages. Counted apart from the ones
     * already gone, so a command can tell somebody to check permissions rather
     * than reporting a clean sweep that did not happen.
     */
    failed: number
    tracked: number
}

export async function clearShiftMessages(client: Client, shift: Shift): Promise<ClearResult> {
    const posted = await state.allFor(shift.eventId, shift.start)
    let removed = 0
    let failed = 0

    for (const entry of posted) {
        try {
            const channel = await client.channels.fetch(entry.channelId)
            if (!channel?.isTextBased()) {
                failed++
                continue
            }

            const message = await channel.messages.fetch(entry.messageId).catch(() => null)

            // Already deleted by hand is a success, not a failure — there is
            // nothing left to do about it either way.
            if (!message) continue

            await message.delete()
            removed++
        } catch (error) {
            log.warn('complete', 'could not delete a message', error)
            failed++
        }
    }

    await state.forget(shift.eventId, shift.start)

    return { removed, failed, tracked: posted.length }
}

export async function postPoll(client: Client, guild: Guild, shift: Shift): Promise<boolean> {
    if (!guild.config.pollsEnabled || !guild.config.pollChannel) return false

    const channel = await sendable(client, guild.config.pollChannel)
    if (!channel) return false

    // Dated from the shift itself rather than from "now", so a poll posted
    // late still names the shift it is about.
    const date = new Date(shift.start).toISOString().slice(0, 10)

    try {
        await channel.send({
            poll: {
                question: { text: `${shift.name} — ${date}` },
                answers: POLL_ANSWERS,
                allowMultiselect: false,
                duration: 24
            }
        })

        return true
    } catch (error) {
        log.error('poll', 'poll refused', error)
        return false
    }
}
