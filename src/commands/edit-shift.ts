import {
    ActionRowBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js'
import { api } from '../api'
import { encodeEditShift } from '../discord/ids'
import type { Command } from '../discord/registry'
import { EPHEMERAL, reply } from '../discord/registry'

/**
 * Sets the note and private-server owner for one occurrence.
 *
 * Both travel in the modal's custom id, so the submission knows exactly which
 * occurrence it is about even if the next shift rolls over while the modal is
 * open.
 */
export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('edit-shift')
        .setDescription('Set the note and server owner shown on the next shift announcement.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute({ interaction, guild }) {
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.reply({
                embeds: [reply.error('There is no shift running or coming up to edit.')],
                ...EPHEMERAL
            })
            return
        }

        const note = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('Shift note')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(false)
            .setValue(shift.note)
            .setPlaceholder('Shown alongside the announcement. Leave blank for none.')

        const owner = new TextInputBuilder()
            .setCustomId('owner')
            .setLabel('Server owner Roblox ID')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(20)
            .setRequired(false)
            .setValue(shift.ownerRobloxId ?? '')
            .setPlaceholder('Leave blank to use the group default.')

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(encodeEditShift(shift.eventId, shift.start))
                .setTitle(`Edit ${shift.name}`.slice(0, 45))
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(note),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(owner)
                )
        )
    }
}
