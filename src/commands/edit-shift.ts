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
import { EPHEMERAL, reply, voice } from '../discord/registry'
import { clamp, LIMIT } from '../i18n'
import { dashboardLink, describeCommand } from '../i18n/command'

/**
 * Sets the note and private-server owner for one occurrence.
 *
 * Both travel in the modal's custom id, so the submission knows exactly which
 * occurrence it is about even if the next shift rolls over while the modal is
 * open.
 */
export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder().setName('edit-shift').setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),
        'bot_command_edit_shift_description'
    ),

    async execute({ interaction, guild }) {
        const l = voice(guild)
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.reply({
                embeds: [reply(l).error(l.text('bot_nothing_to_edit', { link: dashboardLink(guild, 'shifts') }))],
                ...EPHEMERAL
            })
            return
        }

        // A modal is the tightest space the bot has — 45 characters for the
        // title and for each label — so its own wording is the group's first
        // language only. Joining four of them would leave every label cut off
        // mid-word, which is worse than one language somebody can read.
        const t = l.first

        const note = new TextInputBuilder()
            .setCustomId('note')
            .setLabel(clamp(t('bot_edit_shift_note_label'), LIMIT.textInputLabel))
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(false)
            .setValue(shift.note)
            .setPlaceholder(clamp(t('bot_edit_shift_note_placeholder'), LIMIT.textInputPlaceholder))

        const owner = new TextInputBuilder()
            .setCustomId('owner')
            .setLabel(clamp(t('bot_edit_shift_owner_label'), LIMIT.textInputLabel))
            .setStyle(TextInputStyle.Short)
            .setMaxLength(20)
            .setRequired(false)
            .setValue(shift.ownerRobloxId ?? '')
            .setPlaceholder(clamp(t('bot_edit_shift_owner_placeholder'), LIMIT.textInputPlaceholder))

        await interaction.showModal(
            new ModalBuilder()
                .setCustomId(encodeEditShift(shift.eventId, shift.start))
                .setTitle(clamp(t('bot_edit_shift_modal_title', { name: shift.name }), LIMIT.modalTitle))
                .addComponents(
                    new ActionRowBuilder<TextInputBuilder>().addComponents(note),
                    new ActionRowBuilder<TextInputBuilder>().addComponents(owner)
                )
        )
    }
}
