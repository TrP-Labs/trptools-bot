import { Client, Collection, GatewayIntentBits } from 'discord.js'
import type { Command, ComponentHandler } from './registry'

/**
 * The gateway client.
 *
 * Only the Guilds intent is requested. The bot never reads message content,
 * never tracks members and never needs presence — everything it acts on
 * arrives as an interaction, which needs no privileged intent at all. Asking
 * for less is both faster to start and one fewer thing to justify to Discord.
 */
export type BotClient = Client & {
    commands: Collection<string, Command>
    components: ComponentHandler[]
}

export function createClient(): BotClient {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] }) as BotClient

    client.commands = new Collection()
    client.components = []

    return client
}
