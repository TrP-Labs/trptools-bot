import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply, voice } from '../discord/registry'
import { postSheets } from '../features/signups'
import { clamp, LIMIT } from '../i18n'
import { dashboardLink, describeCommand } from '../i18n/command'

/**
 * Opens the staff sign-up sheets for the next shift.
 *
 * Named `/signups` rather than the legacy `/staff-anounce`, which was a typo
 * that had to be lived with for two years.
 */
export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder().setName('signups').setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_signups_description'
    ),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        const l = voice(guild)

        if (!guild.config.signupsEnabled) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_off_signups', { link: dashboardLink(guild, 'bot') }))]
            })
            return
        }

        const shift = await api.shift(guild.guildId, 'next')
        if (!shift) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(l.text('bot_nothing_to_open_signups_for', { link: dashboardLink(guild, 'shifts') }))
                ]
            })
            return
        }

        // Posting before the group's window opens would give people a form
        // whose website half refuses them, which reads as a broken bot.
        if (!shift.signupsOpen) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(
                        l.block((t) => [
                            t('bot_signups_not_yet', {
                                name: shift.name,
                                relative: timestamp(shift.signupsOpenAt, 'R'),
                                at: timestamp(shift.signupsOpenAt, 'F')
                            }),
                            '',
                            t('bot_signups_change_lead')
                        ])
                    )
                ]
            })
            return
        }

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)
        if (!occurrence || occurrence.sheets.length === 0) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_signups_no_sheets', { link: dashboardLink(guild, 'ranks') }))]
            })
            return
        }

        const outcome = await postSheets(client, guild, occurrence.shift, occurrence.sheets)

        if (outcome.posted.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply(l).error(
                        l.block((t) => [
                            t('bot_signups_none_posted'),
                            ...outcome.skipped.map(
                                (entry) =>
                                    `• ${t('bot_signups_skipped_entry', {
                                        sheet: entry.sheet.name,
                                        reason: t(entry.reason)
                                    })}`
                            )
                        ])
                    )
                ]
            })
            return
        }

        const embed = reply(l)
            .success(
                l.line('bot_signups_open_title'),
                l.text('bot_signups_open_body', { name: shift.name, at: timestamp(shift.start, 'F') })
            )
            .addFields(
                outcome.posted.map((entry) => ({
                    name: clamp(entry.sheet.name, LIMIT.embedFieldName),
                    value: `<#${entry.channelId}>`,
                    inline: true
                }))
            )

        if (outcome.skipped.length > 0) {
            embed.addFields({
                name: clamp(l.line('bot_signups_not_posted'), LIMIT.embedFieldName),
                value: clamp(
                    l.block((t) =>
                        outcome.skipped.map((entry) =>
                            t('bot_signups_skipped_entry', { sheet: entry.sheet.name, reason: t(entry.reason) })
                        )
                    ),
                    LIMIT.embedFieldValue
                ),
                inline: false
            })
        }

        await interaction.editReply({ embeds: [embed] })
    }
}
