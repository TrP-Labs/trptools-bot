import { deployCommands } from './discord/deploy'
import { env } from './env'
import { log } from './log'

/**
 * Registers the slash commands by hand.
 *
 * The bot does this for itself on every start, so this is for the times you do
 * not want to restart it — or want to clear a server's stale guild-scoped
 * commands by pointing `DEV_GUILD_ID` at it.
 */
const { scope, names } = await deployCommands()

if (scope === 'guild') {
    log.info(
        'deploy',
        `registered ${names.length} commands to guild ${env.DEV_GUILD_ID} and cleared the global set: ` +
            names.join(', ')
    )
} else {
    log.info('deploy', `registered ${names.length} commands globally: ${names.join(', ')}`)
    log.info(
        'deploy',
        'Guild-scoped commands are left alone here. If a server still shows stale commands, ' +
            'set DEV_GUILD_ID to that server and run this again to clear them.'
    )
}

// discord.js keeps its REST agent alive, which would hold this one-shot script
// open forever. The work is done by here, so leave deliberately.
process.exit(0)
