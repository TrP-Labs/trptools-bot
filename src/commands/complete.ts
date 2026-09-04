import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply, voice } from '../discord/registry'
import { clearShiftMessages, postPoll } from '../features/completion'
import { clamp, LIMIT } from '../i18n'
import { dashboardLink, describeCommand } from '../i18n/command'
import { state } from '../state'

export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder().setName('complete').setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_complete_description'
    ),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        const l = voice(guild)

        // The shift being closed is the one that just ran, so `current` comes
        // first; a host tidying up afterwards falls back to the next one.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_nothing_to_close', { link: dashboardLink(guild, 'shifts') }))]
            })
            return
        }

        const cleared = await clearShiftMessages(client, guild, shift)
        const polled = await postPoll(client, guild, shift)
        await state.untrackManifest(guild.guildId)

        const considered = cleared.tracked - cleared.kept
        const where = cleared.blockedChannels.map((id) => `<#${id}>`).join(', ')
        const pollChannel = `<#${guild.config.pollChannel}>`

        const wentWrong = cleared.failed > 0 || Boolean(guild.config.pollsEnabled && guild.config.pollChannel && !polled)

        const body = l.block((t) => [
            cleared.tracked === 0
                ? t('bot_complete_nothing_to_clear')
                : considered === 0
                  ? t('bot_complete_clearing_off')
                  : t(considered === 1 ? 'bot_complete_cleared_one' : 'bot_complete_cleared', {
                        removed: cleared.removed,
                        considered
                    }),

            // Kept on purpose is not a problem, but saying so stops a host
            // reading a partial sweep as a failure and going hunting for one.
            cleared.kept > 0 &&
                t('bot_complete_kept', { kept: cleared.kept, link: dashboardLink(guild, 'bot') }),

            // A silent partial failure here is how a channel ends up with last
            // week's sheets still in it, so it is called out rather than logged.
            cleared.failed > 0 && t('bot_complete_blocked', { failed: cleared.failed, where }),

            polled
                ? t('bot_complete_poll_posted', { channel: pollChannel })
                : !guild.config.pollsEnabled
                  ? t('bot_complete_polls_off')
                  : !guild.config.pollChannel
                    ? t('bot_complete_no_poll_channel')
                    : t('bot_complete_poll_failed', { channel: pollChannel })
        ])

        await interaction.editReply({
            embeds: [
                wentWrong
                    ? reply(l)
                          .error(body)
                          .setTitle(
                              clamp(l.line('bot_complete_title_problems', { name: shift.name }), LIMIT.embedTitle)
                          )
                    : reply(l).success(l.line('bot_complete_title', { name: shift.name }), body)
            ]
        })
    }
}
