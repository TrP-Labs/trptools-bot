import type { Client } from 'discord.js'
import { Redis } from 'ioredis'
import { env } from '../env'
import { log } from '../log'
import { refreshSheet } from './signups'

/**
 * Keeps Discord sheets in step with the website.
 *
 * When somebody signs up on a shift page the API publishes on a Redis channel;
 * this listens and redraws the one sheet that changed. Pub/sub rather than
 * polling because the change has to show up while the person who made it is
 * still looking at it, and because the API already fans dispatch out this way.
 *
 * ioredis puts a connection into subscriber mode permanently, so this takes
 * its own socket rather than sharing the one message bookkeeping uses.
 */

const CHANNEL = 'bot.signup'

type SignupChange = {
    groupId: string
    eventId: string
    occurrence: string
    signupId: string
}

/**
 * Guild ids by group id, so a change can be routed without a lookup per event.
 * Rebuilt lazily — a group added while the bot is running is resolved on its
 * first change rather than needing a restart.
 */
const guildByGroup = new Map<string, string>()

export function startSignupSync(client: Client) {
    if (!env.REDIS_URL) {
        log.warn('sync', 'REDIS_URL is unset — Discord sheets will not follow website sign-ups')
        return
    }

    const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

    subscriber.on('error', (error) => log.error('sync', 'subscriber error', error))

    subscriber.subscribe(CHANNEL, (error) => {
        if (error) log.error('sync', 'could not subscribe', error)
        else log.info('sync', 'following website sign-ups')
    })

    subscriber.on('message', async (_channel, payload) => {
        let change: SignupChange

        try {
            change = JSON.parse(payload) as SignupChange
        } catch {
            return
        }

        const guildId = guildByGroup.get(change.groupId) ?? (await resolveGuild(change.groupId))
        if (!guildId) return

        try {
            await refreshSheet(client, guildId, change.eventId, change.occurrence, change.signupId)
        } catch (error) {
            log.error('sync', 'could not redraw a sheet', error)
        }
    })

    return subscriber
}

/** Fills the routing table on demand, so a new group needs no restart. */
async function resolveGuild(groupId: string): Promise<string | null> {
    const { api } = await import('../api')
    const guilds = await api.guilds()

    for (const guild of guilds) guildByGroup.set(guild.groupId, guild.guildId)

    return guildByGroup.get(groupId) ?? null
}
