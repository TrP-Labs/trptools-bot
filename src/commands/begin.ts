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
                embeds: [
                    reply.error(
                        'There is no shift running or coming up, so there is nothing to start. Add one at ' +
                            `${guild.siteUrl}/dashboard/${guild.groupSlug}/shifts.`
                    )
                ]
            })
            return
        }

        if (!guild.config.announcementsEnabled) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        'Shift announcements are switched off for this group, so nothing was posted. Turn ' +
                            `them on at ${guild.siteUrl}/dashboard/${guild.groupSlug}/bot.`
                    )
                ]
            })
            return
        }

        const announced = await announceStart(client, guild, shift, code)

        // The public announcement is the whole point of the command. If it did
        // not go out, saying "the shift has started" would be a lie.
        if (!announced.ok) {
            await interaction.editReply({
                embeds: [
                    reply.error(
                        `Could not announce the start: ${announced.reason}.\n\n` +
                            `Set the announcement channel at ${guild.siteUrl}/dashboard/${guild.groupSlug}/bot, ` +
                            'and check the bot can send messages and embed links there.'
                    )
                ]
            })
            return
        }

        const results = [`Announced in <#${announced.channelId}>.`]

        const occurrence = await api.occurrence(guild.guildId, shift.eventId, shift.start)

        if (!occurrence) {
            results.push('Could not read the sign-ups for this shift, so nobody was pinged.')
        } else if (!guild.config.signupsEnabled) {
            results.push('Sign-up sheets are switched off, so nobody was pinged.')
        } else if (occurrence.sheets.length === 0) {
            results.push('No rank has a sign-up sheet, so there was nobody to ping.')
        } else {
            const staff = await announceToStaff(client, guild, occurrence, code)

            if (staff.notified.length > 0) results.push(`Pinged sign-ups in: ${staff.notified.join(', ')}.`)
            if (staff.skipped.length > 0) results.push(`Skipped: ${staff.skipped.join(', ')}.`)
        }

        // The board is genuinely optional: most shifts start before anybody
        // opens a dispatch room, and the refresh loop posts one when they do.
        if (guild.config.manifestEnabled) {
            const posted = await postManifest(client, guild, shift)

            results.push(
                posted
                    ? 'Posted the live dispatch board.'
                    : 'No dispatch room is open yet — the board will appear once one is.'
            )
        }

        await interaction.editReply({
            embeds: [reply.success(`${shift.name} has started`, results.join('\n'))]
        })
    }
}
