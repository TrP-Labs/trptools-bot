import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { clearShiftMessages, postPoll } from '../features/completion'
import { state } from '../state'

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Close out the shift: clear its sign-up sheets and ask how it went.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        // The shift being closed is the one that just ran, so `current` comes
        // first; a host tidying up afterwards falls back to the next one.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'There is no shift to close out. Nothing is running, and nothing is scheduled — ' +
                            `check the schedule at ${guild.siteUrl}/dashboard/${guild.groupSlug}/shifts.`
                    )
                ]
            })
            return
        }

        const cleared = await clearShiftMessages(client, guild, shift)
        const polled = await postPoll(client, guild, shift)
        await state.untrackManifest(guild.guildId)

        const lines: string[] = []

        if (cleared.tracked === 0) {
            lines.push('There was nothing left to clear.')
        } else {
            const considered = cleared.tracked - cleared.kept
            lines.push(
                considered === 0
                    ? 'Clearing is switched off for every channel this shift posted in.'
                    : `Cleared ${cleared.removed} of ${considered} message${considered === 1 ? '' : 's'}.`
            )
        }

        // Kept on purpose is not a problem, but saying so stops a host reading
        // a partial sweep as a failure and going hunting for one.
        if (cleared.kept > 0) {
            lines.push(
                `Left ${cleared.kept} alone — those channels are set to keep their messages at ` +
                    `${guild.siteUrl}/dashboard/${guild.groupSlug}/bot.`
            )
        }

        // A silent partial failure here is how a channel ends up with last
        // week's sheets still in it, so it is called out rather than logged.
        if (cleared.failed > 0) {
            const where = cleared.blockedChannels.map((id) => `<#${id}>`).join(', ')

            lines.push(
                `Could not delete ${cleared.failed} of them in ${where} — the bot needs **Manage ` +
                    'Messages** and **Read Message History** there. Fix that and run `/complete` again; ' +
                    'the messages are still tracked, so nothing is stranded.'
            )
        }

        if (polled) {
            lines.push(`Posted the feedback poll in <#${guild.config.pollChannel}>.`)
        } else if (!guild.config.pollsEnabled) {
            lines.push('Polls are switched off for this group.')
        } else if (!guild.config.pollChannel) {
            lines.push('No poll channel is set, so no poll was posted.')
        } else {
            lines.push(
                `Could not post the poll in <#${guild.config.pollChannel}> — check the bot can send ` +
                    'messages and create polls there.'
            )
        }

        const wentWrong = cleared.failed > 0 || (guild.config.pollsEnabled && guild.config.pollChannel && !polled)

        await interaction.editReply({
            embeds: [
                wentWrong
                    ? reply
                          .error(lines.join('\n'))
                          .setTitle(`${shift.name} closed out, with problems`)
                    : reply.success(`${shift.name} is closed out`, lines.join('\n'))
            ]
        })
    }
}
