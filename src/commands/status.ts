import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { EPHEMERAL, reply } from '../discord/registry'

const yesNo = (value: boolean) => (value ? '✅' : '❌')

const channel = (id: string | null) => (id ? `<#${id}>` : '*not set*')
const role = (id: string | null) => (id ? `<@&${id}>` : '*not set*')

/**
 * What the bot thinks it is configured to do, from inside Discord.
 *
 * The legacy `/inspect-configuration` dumped a TOML file. This reports the
 * live configuration instead, and is mostly useful for answering "why did
 * nothing happen?" without leaving the server.
 */
export const command: Command = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show what this server is configured to do, and what is coming up.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute({ interaction, guild }) {
        await interaction.deferReply(EPHEMERAL)

        const shift = await api.shift(guild.guildId, 'next')
        const live = await api.shift(guild.guildId, 'current')
        const config = guild.config

        const automation = [
            ['Announce upcoming', config.autoAnnounce, `${config.autoAnnounceLead} min before`],
            ['Post sign-ups', config.autoSignups, `${config.autoSignupsLead} min before`],
            ['Remind the host', config.autoHostReminder, `${config.autoHostReminderLead} min before`],
            ['Announce the start', config.autoBegin, `${config.autoBeginLead} min before`],
            ['Close out', config.autoComplete, `${config.autoCompleteDelay} min after the end`]
        ] as const

        const embed = reply
            .info(`Connected to ${guild.groupName}`, `[Open the dashboard](${guild.siteUrl}/dashboard/${guild.groupSlug}/bot)`)
            .addFields(
                {
                    name: 'Channels',
                    value: [
                        `Announcements: ${channel(config.announcementChannel)}`,
                        `Polls: ${channel(config.pollChannel)}`,
                        `Host: ${channel(config.hostChannel)}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: 'Roles',
                    value: [`Shift ping: ${role(config.shiftPingRole)}`, `Host ping: ${role(config.hostPingRole)}`].join(
                        '\n'
                    ),
                    inline: true
                },
                {
                    name: 'Features',
                    value: [
                        `${yesNo(config.announcementsEnabled)} Announcements`,
                        `${yesNo(config.signupsEnabled)} Sign-up sheets`,
                        `${yesNo(config.pollsEnabled)} Polls`,
                        `${yesNo(config.remindersEnabled)} Reminders`,
                        `${yesNo(config.manifestEnabled)} Live manifest`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: 'Automation',
                    value: automation
                        .map(([label, on, when]) => `${yesNo(on)} ${label}${on ? ` — ${when}` : ''}`)
                        .join('\n'),
                    inline: false
                },
                {
                    name: 'Sign-up sheets',
                    value:
                        guild.sheets.length > 0
                            ? guild.sheets
                                  .map(
                                      (sheet) =>
                                          `**${sheet.name}** (${sheet.rankName}+) → ${channel(sheet.discordChannel)}` +
                                          ` · ${sheet.slots.length} slot${sheet.slots.length === 1 ? '' : 's'}`
                                  )
                                  .join('\n')
                            : '*None set up. Add one per rank on the Ranks page.*',
                    inline: false
                },
                {
                    name: 'Shifts',
                    value: [
                        live ? `Running now: **${live.name}**, ends ${timestamp(live.end, 'R')}` : 'Nothing running now',
                        shift ? `Next: **${shift.name}** ${timestamp(shift.start, 'R')}` : 'Nothing scheduled'
                    ].join('\n'),
                    inline: false
                }
            )

        await interaction.editReply({ embeds: [embed] })
    }
}
