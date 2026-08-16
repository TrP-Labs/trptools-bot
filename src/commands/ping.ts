import { SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'

/**
 * Latency to Discord and reachability of the API.
 *
 * The only command that works without a configured guild, so that somebody
 * looking at a bot that is doing nothing can tell "not set up" apart from
 * "cannot reach TrP Tools" apart from "offline".
 */
export const command: Command = {
    needsGuild: false,

    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check that the bot can reach Discord and TrP Tools.'),

    async execute({ interaction }) {
        const sent = await interaction.reply({ content: 'Pinging…', withResponse: true })
        const roundtrip = (sent.resource?.message?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp

        const startedAt = Date.now()
        const guild = interaction.guildId ? await api.guild(interaction.guildId) : null
        const apiLatency = Date.now() - startedAt

        // A guild that resolves proves the API answered; the read is scoped to
        // this server, so a null here means unreachable *or* unconfigured, and
        // those are worded apart.
        const reachable = guild !== null

        await interaction.editReply({
            content: '',
            embeds: [
                reply.info(
                    'Pong',
                    [
                        `Discord roundtrip: **${roundtrip}ms**`,
                        `TrP Tools: ${reachable ? `**reachable** (${apiLatency}ms)` : '**not answering for this server**'}`,
                        reachable
                            ? `Connected to **${guild.groupName}**`
                            : 'Either this server is not connected to a group yet, or the API is down.'
                    ].join('\n')
                )
            ]
        })
    }
}
