import type { Client } from 'discord.js'
import { api, type DueAction, type Guild } from '../api'
import { env } from '../env'
import { log } from '../log'
import { state } from '../state'
import { announceStart, announceToStaff, announceUpcoming, remindHost } from './announcements'
import { clearShiftMessages, postPoll } from './completion'
import { postManifest, refreshManifest } from './manifest'
import { postSheets } from './signups'

/**
 * The scheduler.
 *
 * The API decides what is due — it owns the recurrence rules and the settings
 * — and hands each action out exactly once, so this loop is free to poll as
 * often as it likes and a restart cannot replay yesterday's announcements.
 * All this does is carry them out, and give one back if Discord refuses.
 */

async function carryOut(client: Client, action: DueAction, guild: Guild): Promise<boolean> {
    const shift = await api.shift(guild.guildId, action.action === 'COMPLETE' ? 'current' : 'next')

    // The occurrence is named in the action, so the shift the API happens to
    // consider "next" right now is only a starting point — the real subject is
    // fetched by id below.
    const occurrence = await api.occurrence(guild.guildId, action.eventId, action.occurrence)
    if (!occurrence) {
        log.warn('automation', `${action.action}: occurrence has gone away`)
        return true
    }

    const target = occurrence.shift

    switch (action.action) {
        case 'ANNOUNCE': {
            const result = await announceUpcoming(client, guild, target)
            if (!result.ok) log.warn('automation', `announce failed: ${result.reason}`)
            return result.ok
        }

        case 'SIGNUPS': {
            const outcome = await postSheets(client, guild, target, occurrence.sheets)
            if (outcome.posted.length === 0) {
                log.warn('automation', 'no sheet could be posted')
                return false
            }
            return true
        }

        case 'HOST_REMINDER': {
            const result = await remindHost(client, guild, target)
            if (!result.ok) log.warn('automation', `host reminder failed: ${result.reason}`)
            return result.ok
        }

        case 'BEGIN': {
            const announced = await announceStart(client, guild, target)
            if (!announced.ok) {
                log.warn('automation', `start announcement failed: ${announced.reason}`)
                return false
            }

            if (guild.config.signupsEnabled) await announceToStaff(client, guild, occurrence)
            if (guild.config.manifestEnabled) await postManifest(client, guild, target)

            return true
        }

        case 'COMPLETE': {
            await clearShiftMessages(client, target)
            await postPoll(client, guild, target)
            await state.untrackManifest(guild.guildId)
            return true
        }

        default:
            return true
    }

    // `shift` is read above only so a failure log can name what is running.
    void shift
}

async function tick(client: Client) {
    const due = await api.due()
    if (due.length === 0) return

    // Guilds are fetched once per tick rather than once per action, since a
    // busy minute is usually several actions for the same group.
    const guilds = new Map((await api.guilds()).map((guild) => [guild.guildId, guild]))

    for (const action of due) {
        const guild = guilds.get(action.guildId)

        if (!guild) {
            log.warn('automation', `no configuration for guild ${action.guildId}`)
            continue
        }

        try {
            const done = await carryOut(client, action, guild)

            if (done) {
                log.info('automation', `${action.action} for ${guild.groupName}`)
            } else {
                // Give it back so the next tick tries again, rather than the
                // shift silently losing its only announcement.
                await api.releaseDue(action)
            }
        } catch (error) {
            log.error('automation', `${action.action} threw`, error)
            await api.releaseDue(action)
        }
    }
}

/** Redraws any dispatch board that is currently up. */
async function refreshBoards(client: Client) {
    const guilds = await api.guilds()

    for (const guild of guilds) {
        if (!guild.config.manifestEnabled) continue

        const tracked = await state.trackedManifest(guild.guildId)
        if (!tracked) continue

        const occurrence = await api.occurrence(guild.guildId, tracked.eventId, tracked.occurrence)
        if (!occurrence) {
            await state.untrackManifest(guild.guildId)
            continue
        }

        const alive = await refreshManifest(client, guild, occurrence.shift)

        // A board that cannot be drawn any more means the room closed, so stop
        // asking. The next /begin will start a new one.
        if (!alive) await state.untrackManifest(guild.guildId)
    }
}

export function startAutomation(client: Client) {
    const interval = Math.max(env.SCHEDULER_INTERVAL_SECONDS, 10) * 1000

    log.info('automation', `checking for due actions every ${interval / 1000}s`)

    const run = async () => {
        try {
            await tick(client)
        } catch (error) {
            log.error('automation', 'tick failed', error)
        }
    }

    void run()
    const timer = setInterval(() => void run(), interval)

    // Boards redraw on their own clock, which groups set per guild; the
    // shortest configured refresh is a reasonable common tick.
    const boardTimer = setInterval(() => {
        void refreshBoards(client).catch((error) => log.error('automation', 'board refresh failed', error))
    }, 60_000)

    return () => {
        clearInterval(timer)
        clearInterval(boardTimer)
    }
}
