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
    /**
     * Whether the upcoming notice pings the shift role as well as the start
     * announcement. Optional, and absent means no — matching the default, so a
     * bot running ahead of the API stays quiet rather than pinging.
     */
    pingUpcoming?: boolean
    hostPingRole: string | null

    placeId: string
    /**
     * The group owner's Roblox account, resolved by the API rather than set by
     * anyone. Null only when Roblox could not be reached and nothing was ever
     * cached — the link then opens the public game, so it is worth not
     * assuming this is always present.
     */
    ownerRobloxId: string | null

    /**
     * Whether the public start announcement prints the join code as text.
     * Optional so a bot running ahead of the API still behaves as it always
     * did — the code is shown unless the group has said not to.
     */
    announceJoinCode?: boolean

    /**
     * The languages this group's messages are said in, in the order it asked
     * for them. Every message is rendered in all of them at once.
     *
     * Optional and possibly empty, which both mean English — a bot running
     * ahead of an API that has never heard of the setting should still speak,
     * and `resolveLocales` is the one place that decision is made.
     */
    languages?: string[]

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
    autoStaffStart: boolean
    autoStaffStartLead: number
    autoBegin: boolean
    autoBeginLead: number
    autoComplete: boolean
    autoCompleteDelay: number

    manifestRefreshSeconds: number

    /**
     * Which of the bot's own posts the end-of-shift cleanup takes down,
     * grouped by the channel they live in. Optional for the same reason as
     * above: absent means clear everything, which is what it always did.
     */
    clearSignups?: boolean
    clearAnnouncements?: boolean
    clearHostReminders?: boolean
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
    sheetId: string
    /**
     * Who the sheet is for, in words.
     *
     * A list rather than a single rank: eligibility is a rank list per slot on
     * the site now, and empty means every member of the group. Nothing here is
     * gated on it — a sheet is gated by the channel it is posted in, as it
     * always has been — so it is a label and never a check.
     */
    rankNames: string[]
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
    /** When the group's sign-up window opens, and whether it is open now. */
    signupsOpenAt: string
    signupsOpen: boolean
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
    action: 'ANNOUNCE' | 'SIGNUPS' | 'HOST_REMINDER' | 'STAFF_START' | 'BEGIN' | 'COMPLETE'
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

    // Parsed by what the API actually sent, not by assumption. Its "this
    // worked" responses are the bare string `Success`, which Elysia serves as
    // `text/plain` — and `response.json()` on that throws, which `optional`
    // then swallowed into a null. `/edit-shift` saved the note every time and
    // then told the host it had not, because the only thing that failed was
    // reading the word "Success" as JSON.
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return (await response.text()) as T

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
