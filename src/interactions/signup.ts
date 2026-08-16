import type { Client, Interaction } from 'discord.js'
import { api } from '../api'
import { colorOf } from '../discord/format'
import { decodeSignup, SIGNUP_PREFIX } from '../discord/ids'
import { EPHEMERAL, reply, type ComponentHandler } from '../discord/registry'
import { editSheet } from '../features/signups'
import { log } from '../log'
import { EmbedBuilder } from 'discord.js'

/**
 * Somebody picked a slot on a sheet.
 *
 * The reply is ephemeral and the sheet itself is edited afterwards, so the
 * channel shows one authoritative message rather than a running commentary of
 * who joined and left.
 */
export const handler: ComponentHandler = {
    matches: (customId) => customId.startsWith(`${SIGNUP_PREFIX}:`),

    async execute(interaction: Interaction, client: Client) {
        if (!interaction.isStringSelectMenu() || !interaction.guildId) return

        const target = decodeSignup(interaction.customId)
        const slotId = interaction.values[0]

        if (!target || !slotId) {
            await interaction.reply({
                embeds: [reply.error('That sign-up sheet is no longer valid. Ask for a fresh one.')],
                ...EPHEMERAL
            })
            return
        }

        await interaction.deferReply(EPHEMERAL)

        const guild = await api.guild(interaction.guildId)
        if (!guild) {
            await interaction.editReply({
                embeds: [reply.error('This server is not connected to a TrP Tools group any more.')]
            })
            return
        }

        const result = await api.signup(interaction.guildId, {
            slotId,
            eventId: target.eventId,
            occurrence: target.occurrence,
            discordUserId: interaction.user.id,
            discordUsername: interaction.user.displayName || interaction.user.username
        })

        if (!result) {
            await interaction.editReply({
                embeds: [reply.error('TrP Tools did not answer. Try again in a moment.')]
            })
            return
        }

        const sheet = guild.sheets.find((candidate) => candidate.signupId === target.signupId)
        const colour = colorOf(sheet?.color ?? '#4287f5')

        const messages: Record<typeof result.status, string> = {
            TAKEN: `You have the **${result.slotName}** slot.`,
            MOVED: `Moved you from **${result.previousSlotName}** to **${result.slotName}**.`,
            RELEASED: `You have given up the **${result.slotName}** slot.`,
            FULL: `**${result.slotName}** is already full. Pick another.`,
            GONE: 'That slot no longer exists — the sheet was changed.'
        }

        const failed = result.status === 'FULL' || result.status === 'GONE'

        await interaction.editReply({
            embeds: [
                failed
                    ? reply.error(messages[result.status])
                    : new EmbedBuilder()
                          .setColor(colour)
                          .setTitle(result.status === 'RELEASED' ? 'Signed off' : 'Signed up')
                          .setDescription(messages[result.status])
            ]
        })

        if (failed) return

        // Redraw from the authoritative state rather than patching the embed
        // in place, so two people clicking at once cannot leave it half right.
        try {
            const current = await api.occurrence(interaction.guildId, target.eventId, target.occurrence)
            const updated = current?.sheets.find((candidate) => candidate.signupId === target.signupId)

            if (current && updated) await editSheet(client, guild, current.shift, updated)
        } catch (error) {
            log.error('signup', 'could not redraw the sheet', error)
        }
    }
}
