import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { announceUpcoming } from '../features/announcements'

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Announce the next scheduled shift in the announcements channel.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        if (!guild.config.announcementsEnabled) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'Shift announcements are switched off for this group. Turn them on at ' +
                            `${guild.siteUrl}/dashboard/${guild.groupSlug}/bot.`
                    )
                ]
            })
            return
        }

        const shift = await api.shift(guild.guildId, 'next')
        if (!shift) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'There is no upcoming shift to announce. Add one at ' +
                            `${guild.siteUrl}/dashboard/${guild.groupSlug}/shifts.`
                    )
                ]
            })
            return
        }

        const result = await announceUpcoming(client, guild, shift)

        await interaction.editReply({
            embeds: [
                result.ok
                    ? reply.success(
                          'Shift announced',
                          `**${shift.name}** on ${timestamp(shift.start, 'F')} was announced in <#${result.channelId}>.`
                      )
                    : reply.error(
                          `Could not announce it: ${result.reason}.\n\n` +
                              `Set the announcement channel at ${guild.siteUrl}/dashboard/${guild.groupSlug}/bot, ` +
                              'and check the bot can send messages and embed links there.'
                      )
            ]
        })
    }
}
