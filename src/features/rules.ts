import type { Guild } from '../api'

/**
 * The decisions a group's Discord settings make, kept apart from the code that
 * acts on them.
 *
 * Every one of these is a small conditional that fails silently when it is
 * backwards — a code published that should not have been, a channel cleared
 * that should have been left — so they are worth testing on their own. They
 * live here rather than beside the senders because importing a sender pulls in
 * discord.js and the environment it validates at import time, which a unit
 * test has no business needing.
 *
 * Each setting is optional: the bot deploys independently of the API and may
 * be a version behind one that does not send the field at all. What "absent"
 * means differs per setting, and is the point of each comment below.
 */

/**
 * Whether the public start announcement prints the join code as text.
 *
 * The button carries the code either way, so this locks nobody out — it stops
 * the code living on as copyable text in a public channel after the shift.
 * Absent means yes, which is how it always behaved.
 */
export function showsJoinCode(code: string | null | undefined, guild: Guild): boolean {
    return Boolean(code) && guild.config.announceJoinCode !== false
}

/**
 * Whether the "a shift is coming up" notice pings the shift role.
 *
 * Absent means no — the opposite default to the above. That notice goes out
 * well ahead of the shift, where a ping is noise rather than news, and a group
 * that pings on both ends up training people to mute the one that matters.
 */
export function pingsUpcoming(guild: Guild): boolean {
    return guild.config.pingUpcoming === true
}

/**
 * Whether the end-of-shift cleanup should take down a given recorded message.
 *
 * The Redis field name is the only record of what a message was, and it maps
 * onto the channel it lives in — which is how a group reasons about clearing:
 * "clear the sign-up channels, leave the announcements". `state.ts` owns these
 * names. Absent means clear, which is what cleanup did before the settings
 * existed.
 */
export function wantsClearing(field: string, guild: Guild): boolean {
    if (field.startsWith('sheet:') || field.startsWith('staff:')) {
        return guild.config.clearSignups !== false
    }

    if (field === 'host') return guild.config.clearHostReminders !== false

    // The upcoming notice, the start announcement and the board posted under
    // it all live in the announcement channel.
    return guild.config.clearAnnouncements !== false
}
