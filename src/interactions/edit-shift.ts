import type { Client, Interaction } from 'discord.js'
import { api } from '../api'
import { decodeEditShift, EDIT_SHIFT_MODAL } from '../discord/ids'
import { EPHEMERAL, englishOnly, reply, voice, type ComponentHandler } from '../discord/registry'

export const handler: ComponentHandler = {
    matches: (customId) => customId.startsWith(`${EDIT_SHIFT_MODAL}:`),

    async execute(interaction: Interaction, _client: Client) {
        if (!interaction.isModalSubmit() || !interaction.guildId) return

        const target = decodeEditShift(interaction.customId)
        if (!target) return

        await interaction.deferReply(EPHEMERAL)

        const guild = await api.guild(interaction.guildId)
        const l = guild ? voice(guild) : englishOnly

        const note = interaction.fields.getTextInputValue('note').trim()
        const owner = interaction.fields.getTextInputValue('owner').trim()

        // A non-numeric owner id would produce a join link that silently drops
        // the player into the public game instead of the shift's server.
        if (owner && !/^[0-9]{1,20}$/.test(owner)) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_edit_shift_owner_not_a_number'))]
            })
            return
        }

        const saved = await api.setNote(interaction.guildId, {
            eventId: target.eventId,
            occurrence: target.occurrence,
            note,
            ownerRobloxId: owner || null
        })

        if (!saved) {
            await interaction.editReply({ embeds: [reply(l).error(l.text('bot_edit_shift_refused'))] })
            return
        }

        await interaction.editReply({
            embeds: [
                reply(l).success(
                    l.line('bot_edit_shift_saved_title'),
                    l.block((t) => [
                        note ? t('bot_edit_shift_saved_note', { note }) : t('bot_edit_shift_saved_no_note'),
                        '',
                        owner ? t('bot_edit_shift_saved_owner', { owner }) : t('bot_edit_shift_saved_default_owner')
                    ])
                )
            ]
        })
    }
}
