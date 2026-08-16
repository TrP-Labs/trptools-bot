import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from 'discord.js'
import type { Guild, Occurrence, Shift } from '../api'
import { sendable } from '../discord/channels'
import { colorOf, joinLink, mentionPerson, mentionRole, shiftUrl, timestamp } from '../discord/format'
import { log } from '../log'
import { state } from '../state'

/**
 * Shift announcements: the upcoming notice, the "starting now" post with its
 * join link, and the ping that tells signed-up staff to come in.
 */

function websiteButton(guild: Guild, shift: Shift) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Sign up on the website')
            .setURL(shiftUrl(guild, shift))
    )
}

export type AnnounceResult = { ok: true; channelId: string } | { ok: false; reason: string }

/** "A shift is coming up." */
export async function announceUpcoming(client: Client, guild: Guild, shift: Shift): Promise<AnnounceResult> {
    const channel = await sendable(client, guild.config.announcementChannel)
    if (!channel) return { ok: false, reason: 'no shift announcement channel the bot can post in' }

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle('Upcoming shift')
        .setDescription(
            [
                `**${shift.name}** is scheduled for ${timestamp(shift.start, 'F')} (${timestamp(shift.start, 'R')}).`,
                shift.description,
                shift.note
            ]
                .filter(Boolean)
                .join('\n\n')
        )
        .setFooter({ text: guild.groupName })

    try {
        const message = await channel.send({
            content: mentionRole(guild.config.shiftPingRole) || undefined,
            embeds: [embed],
            components: [websiteButton(guild, shift)]
        })

        await state.rememberNotice(shift.eventId, shift.start, 'upcoming', {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'upcoming announcement refused', error)
        return { ok: false, reason: 'Discord refused the message' }
    }
}

/**
 * "The shift is starting now", with the join link.
 *
 * The message is remembered so the live dispatch manifest can be posted
 * directly underneath it once a room opens.
 */
export async function announceStart(
    client: Client,
    guild: Guild,
    shift: Shift,
    code?: string | null
): Promise<AnnounceResult> {
    const channel = await sendable(client, guild.config.announcementChannel)
    if (!channel) return { ok: false, reason: 'no shift announcement channel the bot can post in' }

    const link = joinLink(guild, shift, code)

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle(`${shift.name} is starting`)
        .setDescription(
            [
                shift.note,
                `[Click here to join](${link})${code ? `, or use the code **${code}**` : ''}`,
                '-# You can also join through the servers menu in game.'
            ]
                .filter(Boolean)
                .join('\n\n')
        )
        .addFields({ name: 'Ends', value: timestamp(shift.end, 'R'), inline: true })
        .setFooter({ text: guild.groupName })

    try {
        const message = await channel.send({
            content: mentionRole(guild.config.shiftPingRole) || undefined,
            embeds: [embed],
            components: [websiteButton(guild, shift)]
        })

        await state.rememberAnnouncement(shift.eventId, shift.start, {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'start announcement refused', error)
        return { ok: false, reason: 'Discord refused the message' }
    }
}

/**
 * Tells the people who signed up that the server is open.
 *
 * Posted into each sheet's own channel and pinging its own sign-ups, so a
 * driver is not notified by the dispatcher sheet and vice versa.
 */
export async function announceToStaff(
    client: Client,
    guild: Guild,
    occurrence: Occurrence,
    code?: string | null
): Promise<{ notified: string[]; skipped: string[] }> {
    const notified: string[] = []
    const skipped: string[] = []
    const link = joinLink(guild, occurrence.shift, code)

    for (const sheet of occurrence.sheets) {
        const people = sheet.slots.flatMap((slot) =>
            slot.signups.map((person) => ({ slot: slot.name, person }))
        )

        if (people.length === 0) {
            skipped.push(`${sheet.name} (nobody signed up)`)
            continue
        }

        const channel = await sendable(client, sheet.discordChannel)
        if (!channel) {
            skipped.push(`${sheet.name} (no channel the bot can post in)`)
            continue
        }

        const embed = new EmbedBuilder()
            .setColor(colorOf(sheet.color))
            .setTitle(`${sheet.name} — the shift is starting`)
            .setDescription(
                [
                    `**${occurrence.shift.name}** starts ${timestamp(occurrence.shift.start, 'R')}.`,
                    `[Click here to join](${link})${code ? `, or use the code **${code}**` : ''}`
                ].join('\n\n')
            )
            .addFields(
                people.map((entry) => ({
                    name: entry.slot,
                    value: mentionPerson(entry.person),
                    inline: true
                }))
            )

        try {
            await channel.send({
                // A real mention outside the embed, since Discord does not
                // notify anyone for a mention that only appears inside one.
                content: people.map((entry) => mentionPerson(entry.person)).join(' '),
                embeds: [embed]
            })

            notified.push(sheet.name)
        } catch (error) {
            log.error('announce', `staff ping for ${sheet.name} refused`, error)
            skipped.push(`${sheet.name} (Discord refused the message)`)
        }
    }

    return { notified, skipped }
}

/** Reminds whoever hosts that a shift needs opening. */
export async function remindHost(client: Client, guild: Guild, shift: Shift): Promise<AnnounceResult> {
    const channel = await sendable(client, guild.config.hostChannel ?? guild.config.announcementChannel)
    if (!channel) return { ok: false, reason: 'no host channel the bot can post in' }

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle('A shift needs a host')
        .setDescription(
            `**${shift.name}** starts ${timestamp(shift.start, 'R')} (${timestamp(shift.start, 'F')}).\n\n` +
                'Open the dispatch room and start the server when you are ready.'
        )
        .setFooter({ text: guild.groupName })

    try {
        const message = await channel.send({
            content: mentionRole(guild.config.hostPingRole) || undefined,
            embeds: [embed],
            components: [websiteButton(guild, shift)]
        })

        await state.rememberNotice(shift.eventId, shift.start, 'host', {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'host reminder refused', error)
        return { ok: false, reason: 'Discord refused the message' }
    }
}
