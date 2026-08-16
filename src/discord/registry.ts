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

export interface Command {
    data: CommandData
    /**
     * Whether the command needs a configured guild.
     *
     * Nearly everything does, and the one that does not — /ping — exists
     * precisely so somebody can tell a misconfigured bot from a dead one.
     */
    needsGuild?: false
    execute: (context: CommandContext) => Promise<void>
}

export interface CommandContext {
    interaction: ChatInputCommandInteraction
    client: Client
    /** Present unless the command declared `needsGuild: false`. */
    guild: Guild
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
