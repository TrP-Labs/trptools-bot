import { REST, Routes } from 'discord.js'
import { commands } from './commands'
import { env } from './env'
import { log } from './log'

/**
 * Registers the slash commands with Discord.
 *
 * Run this after adding or renaming a command; Discord does not learn about
 * them from the gateway connection.
 *
 * **Both scopes are always written**, one with the commands and the other
 * emptied. Discord keeps guild and global commands as separate sets and shows
 * the union of them, so writing only one leaves whatever was in the other
 * still listed — which is how this application ended up offering the 2023
 * bot's `/staff-anounce` and `/staff-begin` alongside the current set, with
 * nothing on the other end to handle them. Clearing the unused scope makes the
 * list in Discord always match the code.
 */
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)

const body = commands.map((command) => command.data.toJSON())

const globalRoute = Routes.applicationCommands(env.DISCORD_APP_ID)
const guildRoute = env.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DEV_GUILD_ID)
    : null

if (guildRoute) {
    // Guild commands appear at once, where global ones take up to an hour to
    // propagate — which is exactly long enough to convince you it is broken.
    await rest.put(guildRoute, { body })
    await rest.put(globalRoute, { body: [] })

    log.info(
        'deploy',
        `registered ${body.length} commands to guild ${env.DEV_GUILD_ID} and cleared the global set: ` +
            body.map((command) => `/${command.name}`).join(', ')
    )
} else {
    await rest.put(globalRoute, { body })

    log.info(
        'deploy',
        `registered ${body.length} commands globally: ` + body.map((command) => `/${command.name}`).join(', ')
    )
    log.info(
        'deploy',
        'Guild-scoped commands are left alone here. If a server still shows stale commands, ' +
            'set DEV_GUILD_ID to that server and run this again to clear them.'
    )
}

// discord.js keeps its REST agent alive, which would hold this one-shot script
// open forever. The work is done by here, so leave deliberately.
process.exit(0)
