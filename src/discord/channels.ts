import type { Client, SendableChannels } from 'discord.js'
import { log } from '../log'

/**
 * Resolves a configured channel id to something the bot can actually post in.
 *
 * Returns null rather than throwing for every way this goes wrong — deleted,
 * never set, or visible but not writable. Every caller's honest answer to all
 * three is the same: say which channel failed and carry on with the others,
 * because one misconfigured sheet must not stop the rest of a shift going out.
 */
export async function sendable(client: Client, channelId: string | null): Promise<SendableChannels | null> {
    if (!channelId) return null

    try {
        const channel = await client.channels.fetch(channelId)
        if (!channel?.isSendable()) return null

        return channel
    } catch (error) {
        log.warn('channels', `channel ${channelId} is unreachable`, error)
        return null
    }
}
