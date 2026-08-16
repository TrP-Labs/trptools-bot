import { AttachmentBuilder, EmbedBuilder, type Client } from 'discord.js'
import { api, type Guild, type Shift } from '../api'
import { sendable } from '../discord/channels'
import { colorOf } from '../discord/format'
import { log } from '../log'
import { state } from '../state'

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

function manifestEmbed(shift: Shift): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle('Dispatch board')
        .setImage(`attachment://${FILENAME}`)
        .setFooter({ text: 'Updates while the room is open' })
        .setTimestamp(new Date())
}

/** Posts the board, or does nothing when no room is open yet. */
export async function postManifest(client: Client, guild: Guild, shift: Shift): Promise<boolean> {
    if (!guild.config.manifestEnabled) return false

    const image = await api.manifest(guild.guildId)
    if (!image) return false

    const anchor = await state.findAnnouncement(shift.eventId, shift.start)
    if (!anchor) return false

    try {
        const channel = await sendable(client, anchor.channelId)
        if (!channel) return false

        const message = await channel.send({
            reply: { messageReference: anchor.messageId, failIfNotExists: false },
            embeds: [manifestEmbed(shift)],
            files: [new AttachmentBuilder(image, { name: FILENAME })]
        })

        await state.rememberManifest(shift.eventId, shift.start, {
            channelId: channel.id,
            messageId: message.id
        })

        await state.trackManifest(guild.guildId, shift.eventId, shift.start)

        return true
    } catch (error) {
        log.error('manifest', 'could not post the board', error)
        return false
    }
}

/**
 * Redraws a board that is already up.
 *
 * Returns false once the room has closed, which is the refresh loop's signal
 * to stop tracking this occurrence.
 */
export async function refreshManifest(client: Client, guild: Guild, shift: Shift): Promise<boolean> {
    const posted = await state.findManifest(shift.eventId, shift.start)
    if (!posted) return postManifest(client, guild, shift)

    const image = await api.manifest(guild.guildId)
    if (!image) return false

    try {
        const channel = await client.channels.fetch(posted.channelId)
        if (!channel?.isTextBased()) return false

        const message = await channel.messages.fetch(posted.messageId)

        // The attachment is replaced wholesale; Discord has no way to swap the
        // bytes behind an existing one.
        await message.edit({
            embeds: [manifestEmbed(shift)],
            files: [new AttachmentBuilder(image, { name: FILENAME })],
            attachments: []
        })

        return true
    } catch (error) {
        log.warn('manifest', 'could not redraw the board', error)
        return false
    }
}
