import { env } from './env'
import { log } from './log'

/**
 * The bot's view of the TrPTools API.
 *
 * Shapes are declared here rather than imported from the backend on purpose.
 * The bot deploys independently and may be a version behind, so a compile-time
 * link would turn every API change into a coordinated release. What it does
 * depend on is small and stable, and every field it reads is optional-safe.
 */

export type BotConfig = {
    groupId: string
    guildId: string

    announcementChannel: string | null
    pollChannel: string | null
    hostChannel: string | null

    shiftPingRole: string | null
    hostPingRole: string | null

    placeId: string
    ownerRobloxId: string | null

    announcementsEnabled: boolean
    signupsEnabled: boolean
    pollsEnabled: boolean
    remindersEnabled: boolean
    manifestEnabled: boolean

    autoAnnounce: boolean
    autoAnnounceLead: number
    autoSignups: boolean
    autoSignupsLead: number
    autoHostReminder: boolean
    autoHostReminderLead: number
    autoBegin: boolean
    autoBeginLead: number
    autoComplete: boolean
    autoCompleteDelay: number

    manifestRefreshSeconds: number
}

export type SignupPerson = {
    userId: string
    displayName: string | null
    discordId: string | null
}

export type SignupSlot = {
    id: string
    name: string
    description: string
    capacity: number
    order: number
    signups: SignupPerson[]
}

export type Sheet = {
    signupId: string
    rankId: string
    rankName: string
    robloxRank: number
    name: string
    description: string
    color: string
    discordChannel: string | null
    discordPingRole: string | null
    slots: SignupSlot[]
}

export type Shift = {
    eventId: string
    name: string
    slug: string
    description: string
    color: string
    start: string
    end: string
    note: string
    ownerRobloxId: string | null
}

export type Guild = {
    guildId: string
    groupId: string
    groupSlug: string
    groupName: string
    siteUrl: string
    config: BotConfig
    sheets: Sheet[]
}

export type Occurrence = {
    shift: Shift
    sheets: Sheet[]
}

export type SignupResult = {
    status: 'TAKEN' | 'RELEASED' | 'MOVED' | 'FULL' | 'GONE'
    slotName: string
    previousSlotName: string | null
}

export type DueAction = {
    guildId: string
    groupId: string
    action: 'ANNOUNCE' | 'SIGNUPS' | 'HOST_REMINDER' | 'BEGIN' | 'COMPLETE'
    eventId: string
    occurrence: string
}

class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly path: string
    ) {
        super(`API ${path} → ${status}`)
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${env.API_URL}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${env.BOT_SERVICE_TOKEN}`,
            'Content-Type': 'application/json',
            ...init.headers
        }
    })

    if (!response.ok) throw new ApiError(response.status, path)
    if (response.status === 204) return undefined as T

    return (await response.json()) as T
}

/** Returns null rather than throwing, for reads that are allowed to be empty. */
async function optional<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
        return await request<T>(path, init)
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        log.error('api', `read failed: ${path}`, error)
        return null
    }
}

const guildPath = (guildId: string) => `/bot/internal/guilds/${encodeURIComponent(guildId)}`

export const api = {
    guilds: () => optional<Guild[]>('/bot/internal/guilds').then((value) => value ?? []),

    guild: (guildId: string) => optional<Guild>(guildPath(guildId)),

    shift: (guildId: string, when: 'next' | 'current') =>
        optional<Shift | null>(`${guildPath(guildId)}/shift?when=${when}`).then((value) => value ?? null),

    occurrence: (guildId: string, eventId: string, occurrence: string) =>
        optional<Occurrence>(
            `${guildPath(guildId)}/occurrence?eventId=${encodeURIComponent(eventId)}` +
                `&occurrence=${encodeURIComponent(occurrence)}`
        ),

    signup: (
        guildId: string,
        body: {
            slotId: string
            eventId: string
            occurrence: string
            discordUserId: string
            discordUsername: string
        }
    ) => optional<SignupResult>(`${guildPath(guildId)}/signup`, { method: 'POST', body: JSON.stringify(body) }),

    setNote: (
        guildId: string,
        body: { eventId: string; occurrence: string; note: string; ownerRobloxId: string | null }
    ) => optional<string>(`${guildPath(guildId)}/note`, { method: 'PUT', body: JSON.stringify(body) }),

    due: () => optional<DueAction[]>('/bot/internal/due').then((value) => value ?? []),

    /**
     * Hands an action back when Discord refused it, so the next poll retries
     * rather than the shift silently losing its announcement.
     */
    releaseDue: (action: DueAction) =>
        optional<string>('/bot/internal/due/release', {
            method: 'POST',
            body: JSON.stringify({
                action: action.action,
                eventId: action.eventId,
                occurrence: action.occurrence
            })
        }),

    manifest: async (guildId: string): Promise<Buffer | null> => {
        try {
            const response = await fetch(`${env.API_URL}${guildPath(guildId)}/manifest`, {
                headers: { Authorization: `Bearer ${env.BOT_SERVICE_TOKEN}` }
            })

            if (!response.ok) return null
            return Buffer.from(await response.arrayBuffer())
        } catch (error) {
            log.error('api', 'manifest render failed', error)
            return null
        }
    }
}
