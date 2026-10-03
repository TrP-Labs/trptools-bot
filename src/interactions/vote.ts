import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Interaction } from 'discord.js'
import { api, ApiError } from '../api'
import { decodeVote, encodeVote, VOTE_PREFIX } from '../discord/ids'
import { EPHEMERAL, englishOnly, reply, voice, type ComponentHandler } from '../discord/registry'
import { announceUpcoming } from '../features/announcements'

export const handler: ComponentHandler = {
    matches: id => id.startsWith(`${VOTE_PREFIX}:`),
    async execute(interaction: Interaction, client) {
        if (!interaction.isButton() || !interaction.guildId) return
        const target = decodeVote(interaction.customId)
        if (!target) return
        await interaction.deferReply(EPHEMERAL)
        const guild = await api.guild(interaction.guildId)
        const l = guild ? voice(guild) : englishOnly
        try {
            await api.vote(interaction.guildId, { ...target, discordUserId: interaction.user.id, name: interaction.user.displayName || interaction.user.username })
            await interaction.editReply({ embeds: [reply(l).info(l.line(target.attending ? 'bot_demand_registered' : 'bot_demand_released'))],
                components: target.attending ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
                    .setStyle(ButtonStyle.Secondary).setLabel(l.line('bot_demand_withdraw')).setCustomId(encodeVote(target.eventId, target.occurrence, false)))] : [] })
            const current = guild ? await api.occurrence(guild.guildId, target.eventId, target.occurrence) : null
            if (guild && current) await announceUpcoming(client, guild, current.shift, true)
        } catch (error) {
            if (!(error instanceof ApiError)) throw error
            await interaction.editReply({ embeds: [reply(l).error(l.text(error.status === 403 ? 'bot_demand_ineligible' : 'bot_demand_closed'))], components: [] })
        }
    }
}
