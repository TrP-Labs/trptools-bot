import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply, voice } from '../discord/registry'
import { letStaffIn } from '../features/announcements'
import { dashboardLink, describeCommand, describeOption } from '../i18n/command'
import { state } from '../state'

/**
 * Lets the staff who signed up into the server, ahead of everyone else.
 *
 * Separate from `/begin` on purpose. Signing up for a slot is what earns early
 * access — dispatchers and maintenance are meant to be in position before the
 * public announcement goes out — so the two are different moments and the host
 * decides when each happens.
 */
export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder()
            .setName('staff-begin')
            .addStringOption((option) =>
                describeOption(option.setName('code'), 'bot_command_option_code_description')
                    .setMinLength(4)
                    .setMaxLength(12)
            )
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_staff_begin_description'
    ),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        const l = voice(guild)

        if (!guild.config.signupsEnabled) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_off_signups_nobody', { link: dashboardLink(guild, 'bot') }))]
            })
            return
        }

        // The shift running now, falling back to the next one — this command is
        // normally used before the start, so the next one is the usual case.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_nothing_to_let_in', { link: dashboardLink(guild, 'shifts') }))]
            })
            return
        }

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)

        if (!occurrence) {
            await interaction.editReply({ embeds: [reply(l).error(l.text('bot_staff_begin_no_signups_read'))] })
            return
        }

        if (occurrence.sheets.length === 0) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_staff_begin_no_sheets', { link: dashboardLink(guild, 'ranks') }))]
            })
            return
        }

        // A code given here is remembered, so `/begin` can reuse it minutes
        // later without the host retyping it — and mistyping it.
        const code = interaction.options.getString('code')
        if (code) await state.rememberCode(shift.eventId, shift.start, code)

        const result = await letStaffIn(client, guild, occurrence, code ?? undefined)

        if (result.notified.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(
                        l.block((t) => [
                            t('bot_staff_begin_nobody_let_in'),
                            ...result.skipped.map(
                                (entry) =>
                                    `• ${t('bot_staff_begin_skipped_entry', {
                                        sheet: entry.sheet,
                                        reason: t(entry.reason)
                                    })}`
                            ),
                            '',
                            t('bot_staff_begin_where_sheets_post', { link: dashboardLink(guild, 'ranks') })
                        ])
                    )
                ]
            })
            return
        }

        const startsLater = new Date(shift.start).getTime() > Date.now()

        await interaction.editReply({
            embeds: [
                reply(l).success(
                    l.line('bot_staff_begin_title', { name: shift.name }),
                    l.block((t) => [
                        t('bot_staff_begin_told', { sheets: result.notified.join(', ') }),
                        result.skipped.length > 0 &&
                            t('bot_staff_begin_skipped', {
                                sheets: result.skipped
                                    .map((entry) =>
                                        t('bot_staff_begin_skipped_entry', {
                                            sheet: entry.sheet,
                                            reason: t(entry.reason)
                                        })
                                    )
                                    .join(', ')
                            }),
                        !code && t('bot_staff_begin_no_code'),
                        startsLater
                            ? t('bot_staff_begin_announce_at', { at: timestamp(shift.start, 't') })
                            : t('bot_staff_begin_announce_when_ready')
                    ])
                )
            ]
        })
    }
}
