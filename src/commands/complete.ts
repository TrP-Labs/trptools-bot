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
        // first; a host tidying up after it ended falls back to the next one's
        // predecessor being gone, in which case there is nothing to clear.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({ embeds: [reply.error('There is no shift to close out.')] })
            return
        }

        const removed = await clearShiftMessages(client, shift)
        const polled = await postPoll(client, guild, shift)
        await state.untrackManifest(guild.guildId)

        await interaction.editReply({
            embeds: [
                reply.success(
                    `${shift.name} is closed out`,
                    [
                        removed > 0
                            ? `Cleared ${removed} message${removed === 1 ? '' : 's'} the bot posted for this shift.`
                            : 'There was nothing left to clear.',
                        polled
                            ? `Posted the feedback poll in <#${guild.config.pollChannel}>.`
                            : guild.config.pollsEnabled
                              ? 'No poll channel is set, so no poll was posted.'
                              : 'Polls are switched off for this group.'
                    ].join('\n')
                )
            ]
        })
    }
}
