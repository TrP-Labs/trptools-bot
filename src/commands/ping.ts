import { SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { englishOnly, reply } from '../discord/registry'
import { localizer } from '../i18n'
import { describeCommand } from '../i18n/command'

/**
 * Latency to Discord and reachability of the API.
 *
 * The only command that works without a configured guild, so that somebody
 * looking at a bot that is doing nothing can tell "not set up" apart from
 * "cannot reach TrP Tools" apart from "offline".
 */
export const command: Command = {
    needsGuild: false,

    data: describeCommand(new SlashCommandBuilder().setName('ping'), 'bot_command_ping_description'),

    async execute({ interaction }) {
        // English until the group is known, since finding out *is* the command.
        const sent = await interaction.reply({ content: englishOnly.first('bot_ping_pinging'), withResponse: true })
        const roundtrip = (sent.resource?.message?.createdTimestamp ?? Date.now()) - interaction.createdTimestamp

        const startedAt = Date.now()
        const guild = interaction.guildId ? await api.guild(interaction.guildId) : null
        const apiLatency = Date.now() - startedAt

        // A guild that resolves proves the API answered; the read is scoped to
        // this server, so a null here means unreachable *or* unconfigured, and
        // those are worded apart. It also finally tells us which languages this
        // server speaks, so the answer can be given in them.
        const l = guild ? localizer(guild.config.languages) : englishOnly

        await interaction.editReply({
            content: '',
            embeds: [
                reply(l).info(
                    l.line('bot_ping_title'),
                    l.block((t) => [
                        t('bot_ping_roundtrip', { ms: roundtrip }),
                        guild ? t('bot_ping_api_reachable', { ms: apiLatency }) : t('bot_ping_api_unreachable'),
                        guild ? t('bot_ping_connected_to', { group: guild.groupName }) : t('bot_ping_not_connected')
                    ])
                )
            ]
        })
    }
}
