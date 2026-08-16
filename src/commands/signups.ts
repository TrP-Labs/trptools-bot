import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { postSheets } from '../features/signups'

/**
 * Opens the staff sign-up sheets for the next shift.
 *
 * Named `/signups` rather than the legacy `/staff-anounce`, which was a typo
 * that had to be lived with for two years.
 */
export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('signups')
        .setDescription('Post the staff sign-up sheets for the next shift.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        if (!guild.config.signupsEnabled) {
            await interaction.editReply({
                embeds: [reply.error('Sign-up sheets are switched off for this group. Turn them on in the dashboard.')]
            })
            return
        }

        const shift = await api.shift(guild.guildId, 'next')
        if (!shift) {
            await interaction.editReply({
                embeds: [reply.error('There is no upcoming shift to open sign-ups for.')]
            })
            return
        }

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)
        if (!occurrence || occurrence.sheets.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'No rank has a sign-up sheet set up yet. Add one per rank on the Ranks page in the dashboard.'
                    )
                ]
            })
            return
        }

        const outcome = await postSheets(client, guild, occurrence.shift, occurrence.sheets)

        if (outcome.posted.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        ['No sheet could be posted:', ...outcome.skipped.map((entry) => `• **${entry.sheet.name}** — ${entry.reason}`)].join(
                            '\n'
                        )
                    )
                ]
            })
            return
        }

        const embed = reply
            .success(
                'Sign-ups are open',
                `For **${shift.name}** on ${timestamp(shift.start, 'F')}.`
            )
            .addFields(
                outcome.posted.map((entry) => ({
                    name: entry.sheet.name,
                    value: `<#${entry.channelId}>`,
                    inline: true
                }))
            )

        if (outcome.skipped.length > 0) {
            embed.addFields({
                name: 'Not posted',
                value: outcome.skipped.map((entry) => `**${entry.sheet.name}** — ${entry.reason}`).join('\n'),
                inline: false
            })
        }

        await interaction.editReply({ embeds: [embed] })
    }
}
