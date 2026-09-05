import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply, voice } from '../discord/registry'
import { announceUpcoming } from '../features/announcements'
import { describeCommand, dashboardLink } from '../i18n/command'

export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder().setName('announce').setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_announce_description'
    ),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        const l = voice(guild)

        if (!guild.config.announcementsEnabled) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_off_announcements', { link: dashboardLink(guild, 'bot') }))]
            })
            return
        }

        const shift = await api.shift(guild.guildId, 'next')
        if (!shift) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_nothing_to_announce', { link: dashboardLink(guild, 'shifts') }))]
            })
            return
        }

        const result = await announceUpcoming(client, guild, shift)

        await interaction.editReply({
            embeds: [
                result.ok
                    ? reply(l).success(
                          l.line('bot_announce_command_announced_title'),
                          l.text('bot_announce_command_announced_body', {
                              name: shift.name,
                              at: timestamp(shift.start, 'F'),
                              channel: `<#${result.channelId}>`
                          })
                      )
                    : reply(l).error(
                          l.block((t) => [
                              t('bot_announce_command_failed', { reason: t(result.reason) }),
                              '',
                              t('bot_announce_command_check_channel', { link: dashboardLink(guild, 'bot') })
                          ])
                      )
            ]
        })
    }
}
