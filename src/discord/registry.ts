import type {
    ChatInputCommandInteraction,
    Client,
    Interaction,
    SlashCommandOptionsOnlyBuilder,
    SlashCommandSubcommandsOnlyBuilder
} from 'discord.js'
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js'
import type { Guild } from '../api'

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

/** Consistent embeds for the three things every command needs to say. */
export const reply = {
    error: (description: string) =>
        new EmbedBuilder().setColor(0xa83232).setTitle('Cannot do that').setDescription(description),

    success: (title: string, description?: string) => {
        const embed = new EmbedBuilder().setColor(0x3fb950).setTitle(title)
        return description ? embed.setDescription(description) : embed
    },

    info: (title: string, description?: string) => {
        const embed = new EmbedBuilder().setColor(0x4287f5).setTitle(title)
        return description ? embed.setDescription(description) : embed
    }
}

export const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const
