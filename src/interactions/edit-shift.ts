import type { Client, Interaction } from 'discord.js'
import { log } from '../log'
import { refreshShiftMessages } from '../features/announcements'
import { api } from '../api'
import { decodeEditShift, EDIT_SHIFT_MODAL } from '../discord/ids'
import { EPHEMERAL, englishOnly, reply, voice, type ComponentHandler } from '../discord/registry'

export const handler: ComponentHandler = {
    matches: (customId) => customId.startsWith(`${EDIT_SHIFT_MODAL}:`),

    async execute(interaction: Interaction, client: Client) {
        if (!interaction.isModalSubmit() || !interaction.guildId) return

        const target = decodeEditShift(interaction.customId)
        if (!target) return

        await interaction.deferReply(EPHEMERAL)

        const guild = await api.guild(interaction.guildId)
        const l = guild ? voice(guild) : englishOnly

        const note = interaction.fields.getTextInputValue('note').trim()
        const owner = interaction.fields.getTextInputValue('owner').trim()
        // Modals opened before a bot update may still have the previous fields.
        const optionalInput = (name: string) => {
            try { return interaction.fields.getTextInputValue(name).trim() }
            catch { return undefined }
        }
        const code = optionalInput('code')
        const visibility = optionalInput('codeVisibility')?.toLowerCase()

        if ((code && !/^[a-zA-Z0-9]{4,12}$/.test(code)) ||
            (visibility && !['yes', 'no', 'default'].includes(visibility))) {
            await interaction.editReply({ embeds: [reply(l).error(l.text('bot_edit_shift_invalid_code'))] })
            return
        }

        // A non-numeric owner id would produce a join link that silently drops
        // the player into the public game instead of the shift's server.
        if (owner && !/^[0-9]{1,20}$/.test(owner)) {
            await interaction.editReply({
                embeds: [reply(l).error(l.text('bot_edit_shift_owner_not_a_number'))]
            })
            return
        }

        const files = interaction.fields.getUploadedFiles('image')
        const image = files?.first()
        const saved = await api.setNote(interaction.guildId, {
            eventId: target.eventId,
            occurrence: target.occurrence,
            note,
            ownerRobloxId: owner || null,
            ...(code === undefined ? {} : { joinCode: code || null }),
            ...(visibility === undefined ? {} : { announceJoinCode: visibility === 'yes' ? true : visibility === 'no' ? false : null }),
            ...(image ? { imageUrl: image.url } : {})
        })

        if (!saved) {
            await interaction.editReply({ embeds: [reply(l).error(l.text('bot_edit_shift_refused'))] })
            return
        }

        if (guild) {
            const occurrence = await api.occurrenceStrict(guild.guildId, target.eventId, target.occurrence)
            if (occurrence) await refreshShiftMessages(client, guild, occurrence).catch(error => log.error('edit-shift', 'saved, but announcement refresh will retry', error))
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
