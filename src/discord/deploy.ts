import { REST, Routes } from 'discord.js'
import { commands } from '../commands'
import { env } from '../env'
import { log } from '../log'

/**
 * Registers the slash commands with Discord.
 *
 * Discord does not learn about commands from the gateway connection, so this
 * has to be a separate write — it runs at startup and from `bun run
 * deploy-commands` for a one-off.
 *
 * **Both scopes are always written**, one with the commands and the other
 * emptied. Discord keeps guild and global commands as separate sets and shows
 * the union of them, so writing only one leaves whatever was in the other still
 * listed — which is how this application ended up offering the 2023 bot's
 * `/staff-anounce` and `/staff-begin` alongside the current set, with nothing on
 * the other end to handle them. Clearing the unused scope makes the list in
 * Discord always match the code.
 */
export async function deployCommands(): Promise<{ scope: 'guild' | 'global'; names: string[] }> {
    const rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)

    const body = commands.map((command) => command.data.toJSON())
    const names = body.map((command) => `/${command.name}`)

    const globalRoute = Routes.applicationCommands(env.DISCORD_APP_ID)

    if (env.DEV_GUILD_ID) {
        // Guild commands appear at once, where global ones take up to an hour
        // to propagate — which is exactly long enough to convince you it is
        // broken.
        await rest.put(Routes.applicationGuildCommands(env.DISCORD_APP_ID, env.DEV_GUILD_ID), { body })
        await rest.put(globalRoute, { body: [] })

        return { scope: 'guild', names }
    }

    await rest.put(globalRoute, { body })

    return { scope: 'global', names }
}

/**
 * Registers at startup, and carries on if Discord says no.
 *
 * A deployment should not need a second manual step to have working commands,
 * and the write is idempotent, so the container does it for itself. It is
 * deliberately not fatal: a rate-limited or briefly unreachable Discord would
 * otherwise take the whole bot down over a set of commands that is, in all
 * likelihood, already registered from the last boot.
 */
export async function deployCommandsAtStartup() {
    try {
        const { scope, names } = await deployCommands()

        log.info(
            'deploy',
            scope === 'guild'
                ? `registered ${names.length} commands to guild ${env.DEV_GUILD_ID}: ${names.join(', ')}`
                : `registered ${names.length} commands globally: ${names.join(', ')}`
        )

        if (scope === 'global') {
            log.info('deploy', 'New commands can take up to an hour to appear in every server.')
        }
    } catch (error) {
        log.error('deploy', 'could not register slash commands — carrying on with whatever Discord has', error)
    }
}
