import type { Client } from 'discord.js'
import { api, type Guild, type Sheet, type Shift } from '../api'
import { editPosted, missingMessage } from '../discord/messages'
import { sendable } from '../discord/channels'
import { mentionRole } from '../discord/format'
import { sheetMessage } from '../embeds/signup'
import type { ReasonKey } from '../i18n'
import { log } from '../log'
import { StateUnavailableError, state, type PostedMessage } from '../state'

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

    const recorded = new Map((await state.allFor(shift.eventId, shift.start)).map((entry) => [entry.field, entry]))

    for (const sheet of sheets) {
        if (sheet.slots.length === 0) {
            outcome.skipped.push({ sheet, reason: 'bot_reason_no_slots' })
            continue
        }

        const existing = recorded.get(`sheet:${sheet.sheetId}`)

        if (existing) {
            const edited = await editSheet(client, guild, shift, sheet, existing)
            if (edited) {
                outcome.posted.push({ sheet, channelId: existing.channelId })
                continue
            }
            // The message was deleted out from under us; fall through and post
            // a fresh one rather than silently doing nothing.
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
            if (error instanceof StateUnavailableError) throw error
            log.error('signups', `could not post ${sheet.name}`, error)
            outcome.skipped.push({ sheet, reason: 'bot_reason_discord_refused' })
        }
    }

    return outcome
}

/** Redraws one already-posted sheet. Returns false if it is no longer there. */
export async function editSheet(client: Client, guild: Guild, shift: Shift, sheet: Sheet, knownPosted?: PostedMessage): Promise<boolean> {
    const posted = knownPosted ?? await state.findSheet(shift.eventId, shift.start, sheet.sheetId)
    if (!posted) return false

    try {
        await editPosted(client, posted, sheetMessage(guild, shift, sheet))

        return true
    } catch (error) {
        if (missingMessage(error)) return false
        throw error
    }
}

/**
 * Redraws one sheet from whatever the API currently holds.
 *
 * Used by the realtime sync, which knows only that something changed and has
 * to read the authoritative state back rather than patch an embed blindly.
 */
export async function refreshSheet(client: Client, guildId: string, eventId: string, occurrence: string, sheetId: string, knownGuild?: Guild) {
    return refreshSheets(client, guildId, eventId, occurrence, [sheetId], knownGuild)
}

export async function refreshSheets(client: Client, guildId: string, eventId: string, occurrence: string, sheetIds: string[], knownGuild?: Guild) {
    const guild = knownGuild ?? await api.guildStrict(guildId)
    if (!guild) return

    const [current, entries] = await Promise.all([
        api.occurrenceStrict(guildId, eventId, occurrence), state.allFor(eventId, occurrence)
    ])
    if (!current) return
    const recorded = new Map(entries.map((entry) => [entry.field, entry]))
    for (const sheet of current.sheets) {
        const posted = recorded.get(`sheet:${sheet.sheetId}`)
        if (posted && sheetIds.includes(sheet.sheetId)) await editSheet(client, guild, current.shift, sheet, posted)
    }
}
