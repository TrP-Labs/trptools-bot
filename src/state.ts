import { Redis } from '@upstash/redis/cloudflare'
import { env } from './env'
import { log } from './log'
import { redisHash } from './redisHash'

/**
 * Where the bot remembers which Discord message is which.
 *
 * A sign-up sheet posted in Discord has to be findable again — to edit it when
 * somebody signs up on the website, and to clear it when the shift closes out.
 * That mapping lives in Redis rather than in the database because it is
 * bookkeeping about messages, not part of the schedule, and it stops mattering
 * the moment the shift is over.
 *
 * Redis is optional for the Docker bot. The Worker requires Upstash, and
 * storage failures surface so queued work can be retried.
 */

export class StateUnavailableError extends Error {
    constructor(cause: unknown) {
        super('Bot state store unavailable', { cause })
    }
}

function unavailable<T>(error: unknown, fallback: T): T {
    // Docker may run without Redis. The Worker requires Upstash: a failed read
    // or write must fail its Queue job so Cloudflare retries the operation.
    if (typeof Bun === 'undefined') throw new StateUnavailableError(error)
    return fallback
}

type Store = Pick<Redis, 'hset' | 'expire' | 'hget' | 'hkeys' | 'set' | 'get' | 'mget' | 'hgetall' | 'del'>

let client: Store | null = null
let clientUrl = ''
let legacy: Promise<Store> | null = null

async function redis(): Promise<Store | null> {
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        if (!client || clientUrl !== env.UPSTASH_REDIS_REST_URL) {
            client = new Redis({
                url: env.UPSTASH_REDIS_REST_URL,
                token: env.UPSTASH_REDIS_REST_TOKEN,
                automaticDeserialization: false
            })
            clientUrl = env.UPSTASH_REDIS_REST_URL
        }
        return client
    }

    // The Docker/Bun bot can still use the compose Valkey connection. This
    // module is loaded by Workers too, so the socket client is imported only
    // when Bun actually selects that deployment mode.
    if (!env.REDIS_URL || typeof Bun === 'undefined') return null
    legacy ??= import('ioredis').then(({ Redis: SocketRedis }) => {
        const socket = new SocketRedis(env.REDIS_URL, { maxRetriesPerRequest: null })
        socket.on('error', (error) => log.error('redis', 'connection error', error))
        return {
            hset: (key: string, map: Record<string, string>) => socket.hset(key, map),
            expire: (key: string, seconds: number) => socket.expire(key, seconds),
            hget: (key: string, field: string) => socket.hget(key, field),
            hkeys: (key: string) => socket.hkeys(key),
            set: (key: string, value: unknown, options: { ex: number }) =>
                socket.set(key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', options.ex),
            get: (key: string) => socket.get(key),
            mget: (...keys: string[]) => socket.mget(...keys),
            hgetall: (key: string) => socket.hgetall(key),
            del: (...keys: string[]) => socket.del(...keys)
        } as Store
    })
    return legacy
}

/** Long enough to outlive any shift, short enough to clean itself up. */
const TTL = 60 * 60 * 24 * 14

export type PostedMessage = { channelId: string; messageId: string }

/** A posted message alongside the hash field that identifies what it is. */
export type RecordedMessage = PostedMessage & { field: string }

const occurrenceKey = (eventId: string, occurrence: string) =>
    `botmsg:${eventId}:${new Date(occurrence).getTime()}`

const sheetField = (sheetId: string) => `sheet:${sheetId}`

/** The "come on in" post for one sheet, so closing the shift out clears it. */
const staffField = (sheetId: string) => `staff:${sheetId}`

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

const pollKey = (eventId: string, occurrence: string) =>
    `botpoll:${eventId}:${new Date(occurrence).getTime()}`

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
    const store = await redis()
    if (!store) return

    const key = occurrenceKey(eventId, occurrence)
    try {
        await store.hset(key, { [field]: `${value.channelId}:${value.messageId}` })
        await store.expire(key, TTL)
    } catch (error) {
        log.error('state', 'could not record a message', error)
        unavailable(error, undefined)
    }
}

async function get(eventId: string, occurrence: string, field: string): Promise<PostedMessage | null> {
    const store = await redis()
    if (!store) return null

    try {
        const raw = await store.hget<string>(occurrenceKey(eventId, occurrence), field)
        if (!raw) return null

        const [channelId, messageId] = raw.split(':')
        return channelId && messageId ? { channelId, messageId } : null
    } catch (error) {
        return unavailable(error, null)
    }
}

export const state = {
    rememberSheet: (eventId: string, occurrence: string, sheetId: string, message: PostedMessage) =>
        put(eventId, occurrence, sheetField(sheetId), message),

    findSheet: (eventId: string, occurrence: string, sheetId: string) =>
        get(eventId, occurrence, sheetField(sheetId)),

    rememberStaffPing: (eventId: string, occurrence: string, sheetId: string, message: PostedMessage) =>
        put(eventId, occurrence, staffField(sheetId), message),

    findStaffPing: (eventId: string, occurrence: string, sheetId: string) =>
        get(eventId, occurrence, staffField(sheetId)),

    /** Whether any sheet's staff have already been let in for this occurrence. */
    async staffPinged(eventId: string, occurrence: string): Promise<boolean> {
        const store = await redis()
        if (!store) return false

        try {
            const fields = await store.hkeys(occurrenceKey(eventId, occurrence))
            return fields.some((field) => field.startsWith('staff:'))
        } catch (error) {
            return unavailable(error, false)
        }
    },

    rememberAnnouncement: (eventId: string, occurrence: string, message: PostedMessage) =>
        put(eventId, occurrence, ANNOUNCEMENT_FIELD, message),

    /** Remembers the join code a host gave, for the rest of the occurrence. */
    async rememberCode(eventId: string, occurrence: string, code: string) {
        const store = await redis()
        if (!store) return
        await store.set(codeKey(eventId, occurrence), code, { ex: TTL })
            .catch((error) => unavailable(error, undefined))
    },

    async findCode(eventId: string, occurrence: string): Promise<string | null> {
        const store = await redis()
        if (!store) return null

        try {
            return await store.get<string>(codeKey(eventId, occurrence))
        } catch (error) {
            return unavailable(error, null)
        }
    },

    rememberNotice: (eventId: string, occurrence: string, kind: NoticeKind, message: PostedMessage) =>
        put(eventId, occurrence, NOTICE_FIELDS[kind], message),

    findNotice: (eventId: string, occurrence: string, kind: NoticeKind) =>
        get(eventId, occurrence, NOTICE_FIELDS[kind]),

    findAnnouncement: (eventId: string, occurrence: string) => get(eventId, occurrence, ANNOUNCEMENT_FIELD),

    rememberManifest: (eventId: string, occurrence: string, message: PostedMessage) =>
        put(eventId, occurrence, MANIFEST_FIELD, message),

    findManifest: (eventId: string, occurrence: string) => get(eventId, occurrence, MANIFEST_FIELD),

    async pollPosted(eventId: string, occurrence: string) {
        const store = await redis()
        return store ? Boolean(await store.get(pollKey(eventId, occurrence))) : false
    },

    async rememberPoll(eventId: string, occurrence: string) {
        const store = await redis()
        if (store) await store.set(pollKey(eventId, occurrence), '1', { ex: TTL })
    },

    /**
     * Everything posted for one occurrence, for the end-of-shift cleanup.
     *
     * The field name comes back with each entry because it is the only record
     * of *what* a message was — a sheet, a staff ping, the announcement — and
     * a group can now choose which of those the cleanup takes down.
     */
    async allFor(eventId: string, occurrence: string): Promise<RecordedMessage[]> {
        const store = await redis()
        if (!store) return []

        try {
            const all = redisHash(await store.hgetall(occurrenceKey(eventId, occurrence)))

            return Object.entries(all)
                .map(([field, raw]) => {
                    const [channelId, messageId] = raw.split(':')
                    return channelId && messageId ? { field, channelId, messageId } : null
                })
                .filter((value): value is RecordedMessage => value !== null)
        } catch (error) {
            return unavailable(error, [])
        }
    },

    async forget(eventId: string, occurrence: string) {
        const store = await redis()
        if (!store) return
        await store
            .del(occurrenceKey(eventId, occurrence), codeKey(eventId, occurrence))
            .catch((error) => unavailable(error, undefined))
    },

    /**
     * Occurrences with a live manifest, so the refresh loop knows what to
     * redraw without holding the list in memory across restarts.
     */
    async trackManifest(guildId: string, eventId: string, occurrence: string) {
        const store = await redis()
        if (!store) return
        await store
            .set(`botmanifest:${guildId}`, JSON.stringify({ eventId, occurrence }), { ex: TTL })
            .catch((error) => unavailable(error, undefined))
    },

    async trackedManifest(guildId: string): Promise<{ eventId: string; occurrence: string } | null> {
        const store = await redis()
        if (!store) return null

        try {
            const raw = await store.get<string>(`botmanifest:${guildId}`)
            return raw ? JSON.parse(raw) as { eventId: string; occurrence: string } : null
        } catch (error) {
            return unavailable(error, null)
        }
    },

    /** One Redis command for the whole refresh tick, including idle guilds. */
    async trackedManifests(guildIds: string[]): Promise<Map<string, { eventId: string; occurrence: string }>> {
        const active = new Map<string, { eventId: string; occurrence: string }>()
        if (guildIds.length === 0) return active
        const store = await redis()
        if (!store) return active

        try {
            const values = await store.mget<Array<string | null>>(...guildIds.map((id) => `botmanifest:${id}`))
            values.forEach((raw, index) => {
                if (!raw) return
                try {
                    active.set(guildIds[index]!, JSON.parse(raw))
                } catch (error) {
                    log.warn('state', `invalid board pointer for guild ${guildIds[index]}: ${String(error)}`)
                }
            })
            return active
        } catch (error) {
            return unavailable(error, active)
        }
    },

    async untrackManifest(guildId: string) {
        const store = await redis()
        if (!store) return
        await store.del(`botmanifest:${guildId}`).catch((error) => unavailable(error, undefined))
    }
}
