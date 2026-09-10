import type { Client } from 'discord.js'
import { api, type Guild, type Sheet, type Shift } from '../api'
import { sendable } from '../discord/channels'
import { mentionRole } from '../discord/format'
import { sheetMessage } from '../embeds/signup'
import type { ReasonKey } from '../i18n'
import { log } from '../log'
import { state } from '../state'

/**
 * Posting and maintaining sign-up sheets in Discord.
 *
 * A sheet is posted once per occurrence into its rank's channel, then edited in
 * place for the rest of the shift — by clicks on the menu, and by the realtime
 * sync when somebody signs up on the website instead.
 */

export type PostOutcome = {
    posted: Array<{ sheet: Sheet; channelId: string }>
    /**
     * Sheets that could not go anywhere, so a command can say which.
     *
     * The reason is a message key rather than a sentence: `/signups` renders
     * it inside its own reply, in the group's own languages.
     */
    skipped: Array<{ sheet: Sheet; reason: ReasonKey }>
}

/**
 * Posts every sheet for one occurrence into its own channel.
 *
 * A sheet already posted for this occurrence is edited rather than duplicated,
 * which makes running /signups twice harmless — the legacy bot spawned a
 * second set of forms and split the sign-ups between them.
 */
export async function postSheets(client: Client, guild: Guild, shift: Shift, sheets: Sheet[]): Promise<PostOutcome> {
    const outcome: PostOutcome = { posted: [], skipped: [] }

    for (const sheet of sheets) {
        if (sheet.slots.length === 0) {
            outcome.skipped.push({ sheet, reason: 'bot_reason_no_slots' })
            continue
        }

        const channel = await sendable(client, sheet.discordChannel)
        if (!channel) {
            outcome.skipped.push({
                sheet,
                reason: sheet.discordChannel
                    ? 'bot_reason_cannot_post_in_channel'
                    : 'bot_reason_no_channel_set'
            })
            continue
        }

        const existing = await state.findSheet(shift.eventId, shift.start, sheet.sheetId)

        if (existing) {
            const edited = await editSheet(client, guild, shift, sheet)
            if (edited) {
                outcome.posted.push({ sheet, channelId: existing.channelId })
                continue
            }
            // The message was deleted out from under us; fall through and post
            // a fresh one rather than silently doing nothing.
        }

        try {
            const message = await channel.send({
                content: mentionRole(sheet.discordPingRole) || undefined,
                ...sheetMessage(guild, shift, sheet)
            })

            await state.rememberSheet(shift.eventId, shift.start, sheet.sheetId, {
                channelId: channel.id,
                messageId: message.id
            })

            outcome.posted.push({ sheet, channelId: channel.id })
        } catch (error) {
            log.error('signups', `could not post ${sheet.name}`, error)
            outcome.skipped.push({ sheet, reason: 'bot_reason_discord_refused' })
        }
    }

    return outcome
}

/** Redraws one already-posted sheet. Returns false if it is no longer there. */
export async function editSheet(client: Client, guild: Guild, shift: Shift, sheet: Sheet): Promise<boolean> {
    const posted = await state.findSheet(shift.eventId, shift.start, sheet.sheetId)
    if (!posted) return false

    try {
        const channel = await client.channels.fetch(posted.channelId)
        if (!channel?.isTextBased()) return false

        const message = await channel.messages.fetch(posted.messageId)
        await message.edit(sheetMessage(guild, shift, sheet))

        return true
    } catch {
        // Deleted, or the bot lost access. Either way the mapping is stale.
        return false
    }
}

/**
 * Redraws one sheet from whatever the API currently holds.
 *
 * Used by the realtime sync, which knows only that something changed and has
 * to read the authoritative state back rather than patch an embed blindly.
 */
export async function refreshSheet(client: Client, guildId: string, eventId: string, occurrence: string, sheetId: string) {
    const guild = await api.guild(guildId)
    if (!guild) return

    const current = await api.occurrence(guildId, eventId, occurrence)
    if (!current) return

    const sheet = current.sheets.find((candidate) => candidate.sheetId === sheetId)
    if (!sheet) return

    await editSheet(client, guild, current.shift, sheet)
}
