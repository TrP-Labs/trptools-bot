import { AttachmentBuilder, EmbedBuilder, type Client } from 'discord.js'
import { api, type Guild, type Shift } from '../api'
import { editPosted, missingMessage } from '../discord/messages'
import { sendable } from '../discord/channels'
import { colorOf } from '../discord/format'
import { voice } from '../discord/registry'
import { clamp, LIMIT } from '../i18n'
import { manifestPresentation } from './rules'
import { log } from '../log'
import { StateUnavailableError, state } from '../state'

/**
 * The live dispatch board, posted under a shift's start announcement.
 *
 * The picture itself is rendered by the API, which already holds the room
 * state, the routes and their colours — sending that down as JSON for the bot
 * to draw would mean two copies of the same presentation logic.
 *
 * It is posted as a reply to the announcement so it stays visually attached to
 * the shift it belongs to, and edited in place afterwards rather than reposted,
 * so the channel does not fill up with a new board every couple of minutes.
 */

const FILENAME = 'manifest.png'

/**
 * The wrapper round the picture.
 *
 * Only the wrapper is rendered per language. The board itself is drawn by the
 * API, in one image, and its headings would have to be laid out four times to
 * carry a language list — so the labels inside it stay English for now.
 */
function manifestEmbed(guild: Guild, shift: Shift): EmbedBuilder {
    const l = voice(guild)

    return new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle(clamp(l.line('bot_manifest_title'), LIMIT.embedTitle))
        .setImage(`attachment://${FILENAME}`)
        .setFooter({ text: clamp(l.line('bot_manifest_footer'), LIMIT.embedFooter) })
        .setTimestamp(new Date())
}

/** Posts the board, or does nothing when no room is open yet. */
export async function postManifest(client: Client, guild: Guild, shift: Shift, replaceMissing = false): Promise<boolean> {
    if (!guild.config.manifestEnabled) return false

    if (!replaceMissing && await state.findManifest(shift.eventId, shift.start)) {
        const tracked = await state.trackedManifest(guild.guildId)
        if (!tracked || tracked.eventId !== shift.eventId || tracked.occurrence !== shift.start) {
            await state.trackManifest(guild.guildId, shift.eventId, shift.start, { checkedAt: Date.now() })
        }
        return true
    }
    const [image, anchor] = await Promise.all([
        api.manifest(guild.guildId), state.findAnnouncement(shift.eventId, shift.start)
    ])
    if (image.status !== 'changed') return false
    if (!anchor) throw new Error('The live board has no recorded announcement')

    try {
        const channel = await sendable(client, anchor.channelId)
        if (!channel) throw new Error('The live board channel is unavailable')

        const message = await channel.send({
            reply: { messageReference: anchor.messageId, failIfNotExists: false },
            embeds: [manifestEmbed(guild, shift)],
            files: [new AttachmentBuilder(image.image, { name: FILENAME })]
        })

        await state.rememberManifest(shift.eventId, shift.start, {
            channelId: channel.id,
            messageId: message.id
        })

        await state.trackManifest(guild.guildId, shift.eventId, shift.start, { checkedAt: Date.now(), etag: image.etag, presentation: manifestPresentation(guild, shift.color) })

        return true
    } catch (error) {
        if (error instanceof StateUnavailableError) throw error
        log.error('manifest', 'could not post the board', error)
        throw error
    }
}

/**
 * Redraws a board that is already up.
 *
 * Returns false once the room has closed, which is the refresh loop's signal
 * to stop tracking this occurrence.
 */
export async function refreshManifest(client: Client, guild: Guild, shift: Shift, etag?: string): Promise<{ alive: boolean; etag?: string; reposted?: boolean }> {
    const posted = await state.findManifest(shift.eventId, shift.start)
    if (!posted) return { alive: await postManifest(client, guild, shift, true), reposted: true }

    const image = await api.manifest(guild.guildId, etag)
    if (image.status === 'closed') return { alive: false }
    if (image.status === 'unchanged') return { alive: true, etag: image.etag }

    try {
        // The attachment is replaced wholesale; Discord has no way to swap the
        // bytes behind an existing one.
        await editPosted(client, posted, {
            embeds: [manifestEmbed(guild, shift)],
            files: [new AttachmentBuilder(image.image, { name: FILENAME })],
            attachments: []
        })

        return { alive: true, etag: image.etag }
    } catch (error) {
        if (missingMessage(error)) return { alive: await postManifest(client, guild, shift, true), reposted: true }
        throw error
    }
}
