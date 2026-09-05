import type {
    ChatInputCommandInteraction,
    Client,
    Interaction,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from 'discord.js'
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js'
import type { Guild } from '../api'
import { clamp, LIMIT, localizer, type Localizer } from '../i18n'

export type CommandData =
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>

/**
 * A command that needs its server connected to a TrP Tools group, which is
 * nearly all of them. The dispatcher resolves the group once and refuses the
 * command with an explanation when there is none.
 */
export interface GuildCommand {
    data: CommandData
    needsGuild?: true
    execute: (context: CommandContext & { guild: Guild }) => Promise<void>
}

/**
 * A command that works on any server. Only `/ping`, which exists precisely so
 * somebody can tell a misconfigured bot from a dead one — and so must run
 * before there is anything to configure.
 */
export interface OpenCommand {
    data: CommandData
    needsGuild: false
    execute: (context: CommandContext) => Promise<void>
}

export type Command = GuildCommand | OpenCommand

export interface CommandContext {
    interaction: ChatInputCommandInteraction
    client: Client
}

export interface ComponentHandler {
    /** Matched against the interaction's custom id. */
    matches: (customId: string) => boolean
    execute: (interaction: Interaction, client: Client) => Promise<void>
}

/**
 * How a group's messages are worded, from the group itself.
 *
 * Every command reaches for this rather than calling `localizer` directly, so
 * there is one answer to "which languages does this server speak" and no
 * command can quietly disagree with the others about it.
 */
export function voice(guild: Guild): Localizer {
    return localizer(guild.config.languages)
}

/**
 * English, for the two answers given before a group is known.
 *
 * `/ping` on an unconfigured server and "this server is not connected" both
 * happen with nothing to read a language list from. English is not a good
 * answer, it is the only one available.
 */
export const englishOnly: Localizer = localizer(null)

/**
 * Consistent embeds for the three things every command needs to say.
 *
 * Bound to a group's languages rather than free functions, because the error
 * heading is itself a message: `reply(l).error(...)` cannot forget to render
 * "Cannot do that" in the same languages as the sentence underneath it.
 *
 * Titles and descriptions are clamped rather than trusted. A group running
 * four languages renders four copies of every string, and Discord refuses a
 * message whose title runs past 256 characters instead of trimming it — so
 * an overlong title would be an announcement that silently never posts.
 */
export function reply(l: Localizer) {
    return {
        error: (description: string) =>
            new EmbedBuilder()
                .setColor(0xa83232)
                .setTitle(clamp(l.line('bot_common_cannot_do_that'), LIMIT.embedTitle))
                .setDescription(clamp(description, LIMIT.embedDescription)),

        success: (title: string, description?: string) => {
            const embed = new EmbedBuilder().setColor(0x3fb950).setTitle(clamp(title, LIMIT.embedTitle))
            return description ? embed.setDescription(clamp(description, LIMIT.embedDescription)) : embed
        },

        info: (title: string, description?: string) => {
            const embed = new EmbedBuilder().setColor(0x4287f5).setTitle(clamp(title, LIMIT.embedTitle))
            return description ? embed.setDescription(clamp(description, LIMIT.embedDescription)) : embed
        }
    }
}

export const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const
