import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { announceStart, announceToStaff } from '../features/announcements'
import { postManifest } from '../features/manifest'

export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('begin')
        .setDescription('Announce that the shift is starting, and tell the staff who signed up.')
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

        const code = interaction.options.getString('code')

        // The shift that is running now, falling back to the next one so a
        // host starting a few minutes early is not told there is nothing on.
        const shift = (await api.shift(guild.guildId, 'current')) ?? (await api.shift(guild.guildId, 'next'))

        if (!shift) {
            await interaction.editReply({
                embeds: [reply.error('There is no shift running or coming up.')]
            })
            return
        }

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)

        const results: string[] = []

        if (guild.config.announcementsEnabled) {
            const announced = await announceStart(client, guild, shift, code)
            results.push(
                announced.ok
                    ? `Announced in <#${announced.channelId}>.`
                    : `Public announcement failed: ${announced.reason}.`
            )
        } else {
            results.push('Public announcements are switched off.')
        }

        if (occurrence && guild.config.signupsEnabled) {
            const staff = await announceToStaff(client, guild, occurrence, code)

            if (staff.notified.length > 0) results.push(`Pinged sign-ups in: ${staff.notified.join(', ')}.`)
            if (staff.skipped.length > 0) results.push(`Skipped: ${staff.skipped.join(', ')}.`)
        }

        // The manifest goes under the announcement once a room is open. It is
        // best effort: a shift with no dispatch room simply has no board yet,
        // and the refresh loop will post one when a room appears.
        if (guild.config.manifestEnabled) {
            const posted = await postManifest(client, guild, shift)
            if (posted) results.push('Posted the live dispatch board.')
        }

        await interaction.editReply({
            embeds: [reply.success(`${shift.name} has started`, results.join('\n'))]
        })
    }
}
