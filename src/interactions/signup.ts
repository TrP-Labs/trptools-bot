import type { Client, Interaction } from 'discord.js'
import { EmbedBuilder } from 'discord.js'
import { api } from '../api'
import { colorOf } from '../discord/format'
import { decodeSignup, SIGNUP_PREFIX } from '../discord/ids'
import { EPHEMERAL, englishOnly, reply, voice, type ComponentHandler } from '../discord/registry'
import { editSheet } from '../features/signups'
import { clamp, LIMIT, type MessageKey } from '../i18n'
import { log } from '../log'

/**
 * Somebody picked a slot on a sheet.
 *
 * The reply is ephemeral and the sheet itself is edited afterwards, so the
 * channel shows one authoritative message rather than a running commentary of
 * who joined and left.
 */

/** What each outcome is called, so the union and the wording cannot drift. */
const OUTCOME: Record<'TAKEN' | 'MOVED' | 'RELEASED' | 'FULL' | 'GONE', MessageKey> = {
    TAKEN: 'bot_signup_taken',
    MOVED: 'bot_signup_moved',
    RELEASED: 'bot_signup_released',
    FULL: 'bot_signup_full',
    GONE: 'bot_signup_gone'
}

export const handler: ComponentHandler = {
    matches: (customId) => customId.startsWith(`${SIGNUP_PREFIX}:`),

    async execute(interaction: Interaction, client: Client) {
        if (!interaction.isStringSelectMenu() || !interaction.guildId) return

        const target = decodeSignup(interaction.customId)
        const slotId = interaction.values[0]

        if (!target || !slotId) {
            await interaction.reply({
                embeds: [reply(englishOnly).error(englishOnly.text('bot_signup_sheet_invalid'))],
                ...EPHEMERAL
            })
            return
        }

        await interaction.deferReply(EPHEMERAL)

        const guild = await api.guild(interaction.guildId)
        if (!guild) {
            await interaction.editReply({
                embeds: [reply(englishOnly).error(englishOnly.text('bot_signup_group_gone'))]
            })
            return
        }

        const l = voice(guild)

        const result = await api.signup(interaction.guildId, {
            slotId,
            eventId: target.eventId,
            occurrence: target.occurrence,
            discordUserId: interaction.user.id,
            discordUsername: interaction.user.displayName || interaction.user.username
        })

        if (!result) {
            await interaction.editReply({ embeds: [reply(l).error(l.text('bot_signup_no_answer'))] })
            return
        }

        const sheet = guild.sheets.find((candidate) => candidate.signupId === target.signupId)
        const colour = colorOf(sheet?.color ?? '#4287f5')

        const outcome = l.text(OUTCOME[result.status], {
            slot: result.slotName,
            previous: result.previousSlotName ?? ''
        })

        const failed = result.status === 'FULL' || result.status === 'GONE'

        await interaction.editReply({
            embeds: [
                failed
                    ? reply(l).error(outcome)
                    : new EmbedBuilder()
                          .setColor(colour)
                          .setTitle(
                              clamp(
                                  l.line(
                                      result.status === 'RELEASED' ? 'bot_signup_signed_off' : 'bot_signup_signed_up'
                                  ),
                                  LIMIT.embedTitle
                              )
                          )
                          .setDescription(clamp(outcome, LIMIT.embedDescription))
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
