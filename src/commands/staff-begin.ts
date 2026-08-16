import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { letStaffIn } from '../features/announcements'
import { state } from '../state'

/**
 * Lets the staff who signed up into the server, ahead of everyone else.
 *
 * Separate from `/begin` on purpose. Signing up for a slot is what earns early
 * access — dispatchers and maintenance are meant to be in position before the
 * public announcement goes out — so the two are different moments and the host
 * decides when each happens.
 */
export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('staff-begin')
        .setDescription('Tell the staff who signed up that the server is open, before announcing it publicly.')
        .addStringOption((option) =>
            option
                .setName('code')
                .setDescription('The private server join code, if you have one.')
                .setMinLength(4)
                .setMaxLength(12)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute({ interaction, client, guild }) {
        await interaction.deferReply()

        if (!guild.config.signupsEnabled) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'Sign-up sheets are switched off for this group, so there is nobody to let in. ' +
                            `Turn them on at ${guild.siteUrl}/dashboard/${guild.groupSlug}/bot.`
                    )
                ]
            })
            return
        }

        // The shift running now, falling back to the next one — this command is
        // normally used before the start, so the next one is the usual case.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'There is no shift running or coming up, so there is nobody to let in. Add one at ' +
                            `${guild.siteUrl}/dashboard/${guild.groupSlug}/shifts.`
                    )
                ]
            })
            return
        }

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)

        if (!occurrence) {
            await interaction.editReply({
                embeds: [reply.error('Could not read the sign-ups for this shift. Try again in a moment.')]
            })
            return
        }

        if (occurrence.sheets.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'No rank has a sign-up sheet, so nobody could have signed up. Sign-ups are per ' +
                            `rank — add one at ${guild.siteUrl}/dashboard/${guild.groupSlug}/ranks.`
                    )
                ]
            })
            return
        }

        // A code given here is remembered, so `/begin` can reuse it minutes
        // later without the host retyping it — and mistyping it.
        const code = interaction.options.getString('code')
        if (code) await state.rememberCode(shift.eventId, shift.start, code)

        const result = await letStaffIn(client, guild, occurrence, code ?? undefined)

        if (result.notified.length === 0) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        ['Nobody was let in:', ...result.skipped.map((entry) => `• ${entry}`)].join('\n') +
                            '\n\nSheets post to the channel set on each rank at ' +
                            `${guild.siteUrl}/dashboard/${guild.groupSlug}/ranks.`
                    )
                ]
            })
            return
        }

        const lines = [`Told sign-ups in: ${result.notified.join(', ')}.`]

        if (result.skipped.length > 0) lines.push(`Skipped: ${result.skipped.join(', ')}.`)
        if (!code) lines.push('No join code was given, so the link points at the group’s default server.')

        lines.push(
            new Date(shift.start).getTime() > Date.now()
                ? `The public announcement is still to come — run \`/begin\` at ${timestamp(shift.start, 't')}.`
                : 'Run `/begin` when you are ready to announce it publicly.'
        )

        await interaction.editReply({
            embeds: [reply.success(`Staff are in for ${shift.name}`, lines.join('\n'))]
        })
    }
}
