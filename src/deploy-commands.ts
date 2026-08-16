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
 * With DEV_GUILD_ID set the commands go to that one server and appear at once.
 * Without it they are registered globally, which can take up to an hour to
 * propagate — which is exactly long enough to convince you the bot is broken.
 */
const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)

const body = commands.map((command) => command.data.toJSON())

const route = env.DEV_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DEV_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_APP_ID)

await rest.put(route, { body })

log.info(
    'deploy',
    `registered ${body.length} commands ${env.DEV_GUILD_ID ? `to guild ${env.DEV_GUILD_ID}` : 'globally'}: ` +
        body.map((command) => `/${command.name}`).join(', ')
)

// discord.js keeps its REST agent alive, which would hold this one-shot script
// open forever. The work is done by here, so leave deliberately.
process.exit(0)
