import { Redis } from 'ioredis'
import { env } from './env'
import { log } from './log'

/**
 * Where the bot remembers which Discord message is which.
 *
 * A sign-up sheet posted in Discord has to be findable again — to edit it when
 * somebody signs up on the website, and to clear it when the shift closes out.
 * That mapping lives in Redis rather than in the database because it is
 * bookkeeping about messages, not part of the schedule, and it stops mattering
 * the moment the shift is over.
 *
 * Redis is optional. Without it the bot still posts sheets and still handles
 * clicks on them; it simply cannot find a message again later, which is why
 * every read here tolerates being unavailable.
 */

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null

redis?.on('error', (error) => log.error('redis', 'connection error', error))

/** Long enough to outlive any shift, short enough to clean itself up. */
const TTL = 60 * 60 * 24 * 14

export type PostedMessage = { channelId: string; messageId: string }

/** A posted message alongside the hash field that identifies what it is. */
export type RecordedMessage = PostedMessage & { field: string }

const occurrenceKey = (eventId: string, occurrence: string) =>
    `botmsg:${eventId}:${new Date(occurrence).getTime()}`

const sheetField = (signupId: string) => `sheet:${signupId}`

/** The "come on in" post for one sheet, so closing the shift out clears it. */
const staffField = (signupId: string) => `staff:${signupId}`

/**
 * The private server code a host typed, remembered for the occurrence.
 *
 * Staff are let in before the public announcement goes out, so the code is
 * given once and then wanted again minutes later by a different command. Asking
 * the host to retype it is how it ends up mistyped. It lives under its own key
 * rather than in the message hash, which holds only `channel:message` pairs.
 */
const codeKey = (eventId: string, occurrence: string) =>
    `botcode:${eventId}:${new Date(occurrence).getTime()}`

/** The start announcement, so the manifest can be posted under it and edited. */
const ANNOUNCEMENT_FIELD = 'announcement'
const MANIFEST_FIELD = 'manifest'

/**
 * The upcoming notice and the host reminder.
 *
 * These get their own fields rather than sharing the announcement's, because
 * the manifest replies to whatever `findAnnouncement` returns — but they are
 * still recorded, so closing the shift out clears them. A "this shift is
 * coming up" post left behind after the shift has run is exactly the clutter
 * `/complete` exists to remove.
 */
const NOTICE_FIELDS = { upcoming: 'upcoming', host: 'host' } as const
export type NoticeKind = keyof typeof NOTICE_FIELDS

async function put(eventId: string, occurrence: string, field: string, value: PostedMessage) {
    if (!redis) return

    const key = occurrenceKey(eventId, occurrence)
    try {
        await redis.hset(key, field, `${value.channelId}:${value.messageId}`)
        await redis.expire(key, TTL)
    } catch (error) {
        log.error('state', 'could not record a message', error)
    }
}

async function get(eventId: string, occurrence: string, field: string): Promise<PostedMessage | null> {
    if (!redis) return null

    try {
        const raw = await redis.hget(occurrenceKey(eventId, occurrence), field)
        if (!raw) return null

        const [channelId, messageId] = raw.split(':')
        return channelId && messageId ? { channelId, messageId } : null
    } catch {
        return null
    }
}

export const state = {
    rememberSheet: (eventId: string, occurrence: string, signupId: string, message: PostedMessage) =>
        put(eventId, occurrence, sheetField(signupId), message),

    findSheet: (eventId: string, occurrence: string, signupId: string) =>
        get(eventId, occurrence, sheetField(signupId)),

    rememberStaffPing: (eventId: string, occurrence: string, signupId: string, message: PostedMessage) =>
        put(eventId, occurrence, staffField(signupId), message),

    /** Whether any sheet's staff have already been let in for this occurrence. */
    async staffPinged(eventId: string, occurrence: string): Promise<boolean> {
        if (!redis) return false

        try {
            const fields = await redis.hkeys(occurrenceKey(eventId, occurrence))
            return fields.some((field) => field.startsWith('staff:'))
        } catch {
            return false
        }
    },

    rememberAnnouncement: (eventId: string, occurrence: string, message: PostedMessage) =>
        put(eventId, occurrence, ANNOUNCEMENT_FIELD, message),

    /** Remembers the join code a host gave, for the rest of the occurrence. */
    async rememberCode(eventId: string, occurrence: string, code: string) {
        if (!redis) return
        await redis.set(codeKey(eventId, occurrence), code, 'EX', TTL).catch(() => undefined)
    },

    async findCode(eventId: string, occurrence: string): Promise<string | null> {
        if (!redis) return null

        try {
            return await redis.get(codeKey(eventId, occurrence))
        } catch {
            return null
        }
    },

    rememberNotice: (eventId: string, occurrence: string, kind: NoticeKind, message: PostedMessage) =>
        put(eventId, occurrence, NOTICE_FIELDS[kind], message),

    findAnnouncement: (eventId: string, occurrence: string) => get(eventId, occurrence, ANNOUNCEMENT_FIELD),

    rememberManifest: (eventId: string, occurrence: string, message: PostedMessage) =>
        put(eventId, occurrence, MANIFEST_FIELD, message),

    findManifest: (eventId: string, occurrence: string) => get(eventId, occurrence, MANIFEST_FIELD),

    /**
     * Everything posted for one occurrence, for the end-of-shift cleanup.
     *
     * The field name comes back with each entry because it is the only record
     * of *what* a message was — a sheet, a staff ping, the announcement — and
     * a group can now choose which of those the cleanup takes down.
     */
    async allFor(eventId: string, occurrence: string): Promise<RecordedMessage[]> {
        if (!redis) return []

        try {
            const all = await redis.hgetall(occurrenceKey(eventId, occurrence))

            return Object.entries(all)
                .map(([field, raw]) => {
                    const [channelId, messageId] = raw.split(':')
                    return channelId && messageId ? { field, channelId, messageId } : null
                })
                .filter((value): value is RecordedMessage => value !== null)
        } catch {
            return []
        }
    },

    async forget(eventId: string, occurrence: string) {
        if (!redis) return
        await redis
            .del(occurrenceKey(eventId, occurrence), codeKey(eventId, occurrence))
            .catch(() => undefined)
    },

    /**
     * Occurrences with a live manifest, so the refresh loop knows what to
     * redraw without holding the list in memory across restarts.
     */
    async trackManifest(guildId: string, eventId: string, occurrence: string) {
        if (!redis) return
        await redis
            .set(`botmanifest:${guildId}`, JSON.stringify({ eventId, occurrence }), 'EX', TTL)
            .catch(() => undefined)
    },

    async trackedManifest(guildId: string): Promise<{ eventId: string; occurrence: string } | null> {
        if (!redis) return null

        try {
            const raw = await redis.get(`botmanifest:${guildId}`)
            return raw ? (JSON.parse(raw) as { eventId: string; occurrence: string }) : null
        } catch {
            return null
        }
    },

    async untrackManifest(guildId: string) {
        if (!redis) return
        await redis.del(`botmanifest:${guildId}`).catch(() => undefined)
    }
}
