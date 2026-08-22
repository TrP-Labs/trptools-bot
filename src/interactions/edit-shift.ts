import type { Client, Interaction } from 'discord.js'
import { api } from '../api'
import { decodeEditShift, EDIT_SHIFT_MODAL } from '../discord/ids'
import { EPHEMERAL, reply, type ComponentHandler } from '../discord/registry'

export const handler: ComponentHandler = {
    matches: (customId) => customId.startsWith(`${EDIT_SHIFT_MODAL}:`),

    async execute(interaction: Interaction, _client: Client) {
        if (!interaction.isModalSubmit() || !interaction.guildId) return

        const target = decodeEditShift(interaction.customId)
        if (!target) return

        await interaction.deferReply(EPHEMERAL)

        const note = interaction.fields.getTextInputValue('note').trim()
        const owner = interaction.fields.getTextInputValue('owner').trim()

        // A non-numeric owner id would produce a join link that silently drops
        // the player into the public game instead of the shift's server.
        if (owner && !/^[0-9]{1,20}$/.test(owner)) {
            await interaction.editReply({
                embeds: [reply.error('The server owner has to be a Roblox user ID — digits only.')]
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
            await interaction.editReply({ embeds: [reply.error('TrP Tools did not accept that. Try again.')] })
            return
        }

        await interaction.editReply({
            embeds: [
                reply.success(
                    'Shift updated',
                    [
                        note ? `**Note**\n${note}` : 'No note will be shown.',
                        owner ? `**Server owner**\n\`${owner}\`` : 'Using the group owner’s server.'
                    ].join('\n\n')
                )
            ]
        })
    }
}
