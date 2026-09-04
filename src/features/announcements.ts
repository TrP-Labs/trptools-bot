import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client } from 'discord.js'
import type { Guild, Occurrence, Shift } from '../api'
import { sendable } from '../discord/channels'
import { colorOf, joinLink, mentionPerson, mentionRole, shiftUrl, timestamp } from '../discord/format'
import { clamp, LIMIT, type Localizer, type ReasonKey } from '../i18n'
import { log } from '../log'
import { pingsUpcoming, showsJoinCode } from './rules'
import { voice } from '../discord/registry'
import { state } from '../state'

/**
 * Shift announcements: the upcoming notice, the "starting now" post with its
 * join link, and the earlier ping that lets signed-up staff into the server.
 */

/**
 * The link out to a shift's page.
 *
 * Deliberately not "sign up": an announcement goes to everyone, and sign-ups
 * exist only for the few staff roles a group has built a sheet for —
 * dispatchers, maintenance. Telling every driver to sign up sends them to a
 * page with nothing on it for them. The sheets themselves say "sign up",
 * because that is what they are.
 */
function websiteButton(l: Localizer, guild: Guild, shift: Shift) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(clamp(l.line('bot_common_view_on_the_website'), LIMIT.buttonLabel))
            .setURL(shiftUrl(guild, shift))
    )
}

/**
 * Why a post did not go out, as a key rather than a sentence.
 *
 * The command that called this renders the reason inside its own apology, in
 * the group's own languages — see `ReasonKey`.
 */
export type AnnounceResult = { ok: true; channelId: string } | { ok: false; reason: ReasonKey }

/** "A shift is coming up." */
export async function announceUpcoming(client: Client, guild: Guild, shift: Shift): Promise<AnnounceResult> {
    const channel = await sendable(client, guild.config.announcementChannel)
    if (!channel) return { ok: false, reason: 'bot_reason_no_announcement_channel' }

    const l = voice(guild)

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle(clamp(l.line('bot_announce_upcoming_title'), LIMIT.embedTitle))
        .setDescription(
            clamp(
                [
                    l.text('bot_announce_upcoming_body', {
                        name: shift.name,
                        at: timestamp(shift.start, 'F'),
                        relative: timestamp(shift.start, 'R')
                    }),
                    // The group wrote these themselves, in whatever language
                    // they wrote them in. Nothing here translates them.
                    shift.description,
                    shift.note
                ]
                    .filter(Boolean)
                    .join('\n\n'),
                LIMIT.embedDescription
            )
        )
        .setFooter({ text: clamp(guild.groupName, LIMIT.embedFooter) })

    try {
        const message = await channel.send({
            content: (pingsUpcoming(guild) ? mentionRole(guild.config.shiftPingRole) : '') || undefined,
            embeds: [embed],
            components: [websiteButton(l, guild, shift)]
        })

        await state.rememberNotice(shift.eventId, shift.start, 'upcoming', {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'upcoming announcement refused', error)
        return { ok: false, reason: 'bot_reason_discord_refused' }
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
    if (!channel) return { ok: false, reason: 'bot_reason_no_announcement_channel' }

    const l = voice(guild)
    const link = joinLink(guild, shift, code)
    const showCode = showsJoinCode(code, guild)

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle(clamp(l.line('bot_announce_start_title', { name: shift.name }), LIMIT.embedTitle))
        .setDescription(
            clamp(
                [
                    shift.note,
                    l.block((t) =>
                        showCode
                            ? t('bot_announce_start_join_with_code', { link, code: code ?? '' })
                            : t('bot_announce_start_join', { link })
                    ),
                    // `-#` is Discord's small text. It has to lead the line, so
                    // it is applied per rendered stanza rather than baked into
                    // a string a translator would have to carry it through.
                    l.block((t) => `-# ${t('bot_announce_start_servers_menu')}`)
                ]
                    .filter(Boolean)
                    .join('\n\n'),
                LIMIT.embedDescription
            )
        )
        .addFields({
            name: clamp(l.line('bot_announce_start_ends'), LIMIT.embedFieldName),
            value: timestamp(shift.end, 'R'),
            inline: true
        })
        .setFooter({ text: clamp(guild.groupName, LIMIT.embedFooter) })

    try {
        const message = await channel.send({
            content: mentionRole(guild.config.shiftPingRole) || undefined,
            embeds: [embed],
            components: [websiteButton(l, guild, shift)]
        })

        await state.rememberAnnouncement(shift.eventId, shift.start, {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'start announcement refused', error)
        return { ok: false, reason: 'bot_reason_discord_refused' }
    }
}

/** One sheet the staff ping could not reach, and why. */
export type StaffSkip = { sheet: string; reason: ReasonKey }

/**
 * Lets the people who signed up into the server.
 *
 * This is what signing up buys: the join code goes to the staff who claimed a
 * slot, ahead of the public announcement, so dispatchers and maintenance are in
 * position before anyone else arrives. It is deliberately not part of the start
 * announcement — the two happen at different times, from different commands.
 *
 * Posted into each sheet's own channel and pinging only its own sign-ups, so a
 * dispatcher is not notified by the maintenance sheet and vice versa.
 */
export async function letStaffIn(
    client: Client,
    guild: Guild,
    occurrence: Occurrence,
    code?: string | null
): Promise<{ notified: string[]; skipped: StaffSkip[] }> {
    const notified: string[] = []
    const skipped: StaffSkip[] = []
    const l = voice(guild)
    const link = joinLink(guild, occurrence.shift, code)
    const started = new Date(occurrence.shift.start).getTime() <= Date.now()

    for (const sheet of occurrence.sheets) {
        const people = sheet.slots.flatMap((slot) =>
            slot.signups.map((person) => ({ slot: slot.name, person }))
        )

        if (people.length === 0) {
            skipped.push({ sheet: sheet.name, reason: 'bot_reason_nobody_signed_up' })
            continue
        }

        const channel = await sendable(client, sheet.discordChannel)
        if (!channel) {
            skipped.push({ sheet: sheet.name, reason: 'bot_reason_cannot_post_in_channel' })
            continue
        }

        const embed = new EmbedBuilder()
            .setColor(colorOf(sheet.color))
            .setTitle(clamp(l.line('bot_staff_title', { sheet: sheet.name }), LIMIT.embedTitle))
            .setDescription(
                clamp(
                    l.block((t) => [
                        started
                            ? t('bot_staff_running_now', { name: occurrence.shift.name })
                            : t('bot_staff_starting_soon', {
                                  name: occurrence.shift.name,
                                  relative: timestamp(occurrence.shift.start, 'R')
                              }),
                        '',
                        code
                            ? t('bot_announce_start_join_with_code', { link, code })
                            : t('bot_announce_start_join', { link })
                    ]),
                    LIMIT.embedDescription
                )
            )
            .addFields(
                people.map((entry) => ({
                    name: clamp(entry.slot, LIMIT.embedFieldName),
                    value: mentionPerson(entry.person, l),
                    inline: true
                }))
            )
            .setFooter({
                text: clamp(
                    l.line(started ? 'bot_staff_footer_running' : 'bot_staff_footer_early'),
                    LIMIT.embedFooter
                )
            })

        try {
            const message = await channel.send({
                // A real mention outside the embed, since Discord does not
                // notify anyone for a mention that only appears inside one.
                content: people.map((entry) => mentionPerson(entry.person, l)).join(' '),
                embeds: [embed]
            })

            await state.rememberStaffPing(
                occurrence.shift.eventId,
                occurrence.shift.start,
                sheet.signupId,
                { channelId: channel.id, messageId: message.id }
            )

            notified.push(sheet.name)
        } catch (error) {
            log.error('announce', `staff ping for ${sheet.name} refused`, error)
            skipped.push({ sheet: sheet.name, reason: 'bot_reason_discord_refused' })
        }
    }

    return { notified, skipped }
}

/** Reminds whoever hosts that a shift needs opening. */
export async function remindHost(client: Client, guild: Guild, shift: Shift): Promise<AnnounceResult> {
    const channel = await sendable(client, guild.config.hostChannel ?? guild.config.announcementChannel)
    if (!channel) return { ok: false, reason: 'bot_reason_no_host_channel' }

    const l = voice(guild)

    const embed = new EmbedBuilder()
        .setColor(colorOf(shift.color))
        .setTitle(clamp(l.line('bot_announce_host_title'), LIMIT.embedTitle))
        .setDescription(
            clamp(
                l.block((t) => [
                    t('bot_announce_host_body', {
                        name: shift.name,
                        relative: timestamp(shift.start, 'R'),
                        at: timestamp(shift.start, 'F')
                    }),
                    '',
                    t('bot_announce_host_open_the_room')
                ]),
                LIMIT.embedDescription
            )
        )
        .setFooter({ text: clamp(guild.groupName, LIMIT.embedFooter) })

    try {
        const message = await channel.send({
            content: mentionRole(guild.config.hostPingRole) || undefined,
            embeds: [embed],
            components: [websiteButton(l, guild, shift)]
        })

        await state.rememberNotice(shift.eventId, shift.start, 'host', {
            channelId: channel.id,
            messageId: message.id
        })

        return { ok: true, channelId: channel.id }
    } catch (error) {
        log.error('announce', 'host reminder refused', error)
        return { ok: false, reason: 'bot_reason_discord_refused' }
    }
}
