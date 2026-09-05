import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply, voice } from '../discord/registry'
import { announceStart } from '../features/announcements'
import { postManifest } from '../features/manifest'
import { dashboardLink, describeCommand, describeOption } from '../i18n/command'
import { state } from '../state'

/**
 * The public "we are open" announcement.
 *
 * It does not touch sign-ups. Staff who claimed a slot are let in earlier, by
 * `/staff-begin`, which is the point of signing up in the first place.
 */
export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder()
            .setName('begin')
            .addStringOption((option) =>
                describeOption(option.setName('code'), 'bot_command_option_code_description')
                    .setMinLength(4)
                    .setMaxLength(12)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_begin_description'
    ),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        const l = voice(guild)

        // The shift that is running now, falling back to the next one so a
        // host starting a few minutes early is not told there is nothing on.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_nothing_to_start', { link: dashboardLink(guild, 'shifts') }))]
            })
            return
        }

        if (!guild.config.announcementsEnabled) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(
                        l.text('bot_off_announcements_nothing_posted', { link: dashboardLink(guild, 'bot') })
                    )
                ]
            })
            return
        }

        // Falls back to whatever `/staff-begin` was given, so the host types
        // the code once per shift rather than once per command.
        const code =
            interaction.options.getString('code') ?? (await state.findCode(shift.eventId, shift.start))

        if (code) await state.rememberCode(shift.eventId, shift.start, code)

        const announced = await announceStart(client, guild, shift, code)

        // The public announcement is the whole point of the command. If it did
        // not go out, saying "the shift has started" would be a lie.
        if (!announced.ok) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(
                        l.block((t) => [
                            t('bot_begin_failed', { reason: t(announced.reason) }),
                            '',
                            t('bot_announce_command_check_channel', { link: dashboardLink(guild, 'bot') })
                        ])
                    )
                ]
            })
            return
        }

        // Staff are let in by `/staff-begin`, normally well before this. Say so
        // if that has not happened, since it is easy to reach for `/begin`
        // alone and leave the people who signed up waiting outside.
        const staffAlreadyIn =
            guild.config.signupsEnabled && guild.sheets.length > 0
                ? await state.staffPinged(shift.eventId, shift.start)
                : null

        // The board is genuinely optional: most shifts start before anybody
        // opens a dispatch room, and the refresh loop posts one when they do.
        const boardPosted = guild.config.manifestEnabled ? await postManifest(client, guild, shift) : null

        await interaction.editReply({
            embeds: [
                reply(l).success(
                    l.line('bot_begin_started_title', { name: shift.name }),
                    l.block((t) => [
                        t('bot_begin_announced_in', { channel: `<#${announced.channelId}>` }),
                        staffAlreadyIn !== null &&
                            t(staffAlreadyIn ? 'bot_begin_staff_already_in' : 'bot_begin_staff_not_in'),
                        boardPosted !== null && t(boardPosted ? 'bot_begin_board_posted' : 'bot_begin_board_waiting')
                    ])
                )
            ]
        })
    }
}
