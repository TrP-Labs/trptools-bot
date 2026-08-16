import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import type { Command } from '../discord/registry'
import { reply } from '../discord/registry'
import { announceStart } from '../features/announcements'
import { postManifest } from '../features/manifest'
import { state } from '../state'

/**
 * The public "we are open" announcement.
 *
 * It does not touch sign-ups. Staff who claimed a slot are let in earlier, by
 * `/staff-begin`, which is the point of signing up in the first place.
 */
export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('begin')
        .setDescription('Announce publicly that the shift is starting.')
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

        // Falls back to whatever `/staff-begin` was given, so the host types
        // the code once per shift rather than once per command.
        const code =
            interaction.options.getString('code') ?? (await state.findCode(shift.eventId, shift.start))

        if (code) await state.rememberCode(shift.eventId, shift.start, code)

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

        // Staff are let in by `/staff-begin`, normally well before this. Say so
        // if that has not happened, since it is easy to reach for `/begin`
        // alone and leave the people who signed up waiting outside.
        if (guild.config.signupsEnabled && guild.sheets.length > 0) {
            const already = await state.staffPinged(shift.eventId, shift.start)

            results.push(
                already
                    ? 'Staff who signed up were already let in.'
                    : 'Staff who signed up have not been let in — run `/staff-begin` to do that.'
            )
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
