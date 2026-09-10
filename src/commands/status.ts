import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js'
import { api } from '../api'
import { timestamp } from '../discord/format'
import type { Command } from '../discord/registry'
import { EPHEMERAL, reply, voice } from '../discord/registry'
import { clamp, LIMIT, type MessageKey, type Translate } from '../i18n'
import { describeCommand } from '../i18n/command'

const yesNo = (value: boolean) => (value ? '✅' : '❌')

/**
 * What the bot thinks it is configured to do, from inside Discord.
 *
 * The legacy `/inspect-configuration` dumped a TOML file. This reports the
 * live configuration instead, and is mostly useful for answering "why did
 * nothing happen?" without leaving the server.
 *
 * Every field is built inside `l.block`, so a group running two languages gets
 * two readable stanzas rather than each individual line spliced with a slash.
 */
export const command: Command = {
    data: describeCommand(
        new SlashCommandBuilder().setName('status').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
        'bot_command_status_description'
    ),

    async execute({ interaction, guild }) {
        await interaction.deferReply(EPHEMERAL)

        const l = voice(guild)
        const shift = await api.shift(guild.guildId, 'next')
        const live = await api.shift(guild.guildId, 'current')
        const config = guild.config

        const channel = (t: Translate, id: string | null) => (id ? `<#${id}>` : `*${t('bot_common_not_set')}*`)
        const role = (t: Translate, id: string | null) => (id ? `<@&${id}>` : `*${t('bot_common_not_set')}*`)

        /** Each automated action: its name, whether it runs, and how far out. */
        const automation: Array<[MessageKey, boolean, number, 'before' | 'after']> = [
            ['bot_status_auto_announce', config.autoAnnounce, config.autoAnnounceLead, 'before'],
            ['bot_status_auto_signups', config.autoSignups, config.autoSignupsLead, 'before'],
            ['bot_status_auto_host_reminder', config.autoHostReminder, config.autoHostReminderLead, 'before'],
            ['bot_status_auto_staff_start', config.autoStaffStart, config.autoStaffStartLead, 'before'],
            ['bot_status_auto_begin', config.autoBegin, config.autoBeginLead, 'before'],
            ['bot_status_auto_complete', config.autoComplete, config.autoCompleteDelay, 'after']
        ]

        const field = (name: MessageKey, value: string, inline = false) => ({
            name: clamp(l.line(name), LIMIT.embedFieldName),
            value: clamp(value, LIMIT.embedFieldValue),
            inline
        })

        const embed = reply(l)
            .info(
                l.line('bot_status_title', { group: guild.groupName }),
                l.text('bot_status_open_dashboard', {
                    link: `${guild.siteUrl}/dashboard/${guild.groupSlug}/bot`
                })
            )
            .addFields(
                field(
                    'bot_status_channels',
                    l.block((t) => [
                        `${t('bot_status_announcements')}: ${channel(t, config.announcementChannel)}`,
                        `${t('bot_status_polls')}: ${channel(t, config.pollChannel)}`,
                        `${t('bot_status_host')}: ${channel(t, config.hostChannel)}`
                    ]),
                    true
                ),
                field(
                    'bot_status_roles',
                    l.block((t) => [
                        `${t('bot_status_shift_ping')}: ${role(t, config.shiftPingRole)}`,
                        `${t('bot_status_host_ping')}: ${role(t, config.hostPingRole)}`
                    ]),
                    true
                ),
                field(
                    'bot_status_features',
                    l.block((t) => [
                        `${yesNo(config.announcementsEnabled)} ${t('bot_status_feature_announcements')}`,
                        `${yesNo(config.signupsEnabled)} ${t('bot_status_feature_signups')}`,
                        `${yesNo(config.pollsEnabled)} ${t('bot_status_feature_polls')}`,
                        `${yesNo(config.remindersEnabled)} ${t('bot_status_feature_reminders')}`,
                        `${yesNo(config.manifestEnabled)} ${t('bot_status_feature_manifest')}`
                    ])
                ),
                field(
                    'bot_status_automation',
                    l.block((t) =>
                        automation.map(([label, on, minutes, side]) => {
                            const when = t(
                                side === 'before' ? 'bot_status_minutes_before' : 'bot_status_minutes_after_end',
                                { minutes }
                            )

                            return `${yesNo(on)} ${
                                on ? t('bot_status_automation_on', { label: t(label), when }) : t(label)
                            }`
                        })
                    )
                ),
                field(
                    'bot_status_sheets',
                    guild.sheets.length > 0
                        ? l.block((t) =>
                              guild.sheets.map((sheet) =>
                                  t(
                                      sheet.slots.length === 1
                                          ? 'bot_status_sheet_ranks_one'
                                          : 'bot_status_sheet_ranks',
                                      {
                                          sheet: sheet.name,
                                          // Empty means the whole group, which
                                          // is a sentence rather than a list.
                                          ranks:
                                              sheet.rankNames.length > 0
                                                  ? sheet.rankNames.join(', ')
                                                  : t('bot_status_sheet_everyone'),
                                          channel: channel(t, sheet.discordChannel),
                                          slots: sheet.slots.length
                                      }
                                  )
                              )
                          )
                        : l.text('bot_status_no_sheets')
                ),
                field(
                    'bot_status_shifts',
                    l.block((t) => [
                        live
                            ? t('bot_status_running_now', { name: live.name, relative: timestamp(live.end, 'R') })
                            : t('bot_status_nothing_running'),
                        shift
                            ? t('bot_status_next', { name: shift.name, relative: timestamp(shift.start, 'R') })
                            : t('bot_status_nothing_scheduled')
                    ])
                )
            )

        await interaction.editReply({ embeds: [embed] })
    }
}
