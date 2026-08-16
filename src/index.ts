import type { Interaction } from 'discord.js'
import { Events } from 'discord.js'
import { api } from './api'
import { commands } from './commands'
import { createClient } from './discord/client'
import { EPHEMERAL, reply } from './discord/registry'
import { startAutomation } from './features/automation'
import { startSignupSync } from './features/sync'
import { handler as editShiftHandler } from './interactions/edit-shift'
import { handler as signupHandler } from './interactions/signup'
import { env } from './env'
import { log } from './log'
import { redis } from './state'

const client = createClient()

for (const command of commands) client.commands.set(command.data.name, command)
client.components.push(signupHandler, editShiftHandler)

/**
 * Answers an interaction that failed, whatever state it is in.
 *
 * Discord shows "the application did not respond" for three seconds of
 * silence, which is a far worse thing for a user to see than an error — so
 * every failure path ends in a message, deferred or not.
 */
async function fail(interaction: Interaction, message: string) {
    if (!interaction.isRepliable()) return

    const payload = { embeds: [reply.error(message)], ...EPHEMERAL }

    try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds: payload.embeds })
        else await interaction.reply(payload)
    } catch (error) {
        log.error('interaction', 'could not deliver the failure message', error)
    }
}

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName)
            if (!command) return

            if (!interaction.guildId) {
                await fail(interaction, 'This command only works inside a server.')
                return
            }

            // Every command but /ping needs to know which group it is acting
            // for, and resolving it once here keeps that check out of each.
            if (command.needsGuild === false) {
                await command.execute({ interaction, client, guild: undefined as never })
                return
            }

            const guild = await api.guild(interaction.guildId)
            if (!guild) {
                await fail(
                    interaction,
                    'This server is not connected to a TrP Tools group yet. A group manager can add the bot from ' +
                        'the Bot page in the dashboard.'
                )
                return
            }

            await command.execute({ interaction, client, guild })
            return
        }

        const customId =
            interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()
                ? interaction.customId
                : null

        if (!customId) return

        const handler = client.components.find((candidate) => candidate.matches(customId))
        if (handler) await handler.execute(interaction, client)
    } catch (error) {
        log.error('interaction', 'handler threw', error)
        await fail(interaction, 'Something went wrong handling that. It has been logged.')
    }
})

client.once(Events.ClientReady, async (ready) => {
    log.info('bot', `signed in as ${ready.user.tag}`)

    const guilds = await api.guilds()
    log.info('bot', `${guilds.length} connected group${guilds.length === 1 ? '' : 's'}, in ${ready.guilds.cache.size} server${ready.guilds.cache.size === 1 ? '' : 's'}`)

    startSignupSync(client)
    startAutomation(client)
})

/**
 * Shuts down cleanly.
 *
 * Discord keeps a session alive for a while after the socket drops, so a bot
 * that is killed without destroying its client shows as online for minutes
 * afterwards — which makes a restart look like a hang.
 */
async function shutdown(signal: string) {
    log.info('bot', `${signal} — shutting down`)

    await client.destroy().catch(() => undefined)
    await redis?.quit().catch(() => undefined)

    process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

await client.login(env.DISCORD_BOT_TOKEN)
