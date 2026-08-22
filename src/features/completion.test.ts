import { describe, expect, test } from 'bun:test'
import type { BotConfig, Guild } from '../api'
import { wantsClearing } from './completion'

/**
 * The cleanup settings are keyed off the Redis field name a message was
 * recorded under, which is the only record of what that message was. Get the
 * mapping wrong and a group either keeps clutter it asked to be rid of or
 * loses posts it asked to keep — neither of which shows up until a shift has
 * already closed out. `state.ts` owns the field names; this pins them.
 */
function guildWith(config: Partial<BotConfig>): Guild {
    return { config: config as BotConfig } as Guild
}

const ALL_FIELDS = [
    'sheet:abc',
    'staff:abc',
    'announcement',
    'upcoming',
    'manifest',
    'host'
]

describe('wantsClearing', () => {
    test('clears everything when a group has said nothing', () => {
        const guild = guildWith({})
        for (const field of ALL_FIELDS) expect(wantsClearing(field, guild)).toBe(true)
    })

    test('an older API that omits the settings still clears everything', () => {
        // The bot deploys independently and may run ahead of the API, so the
        // fields are optional. Absent has to mean "as it always behaved".
        const guild = guildWith({ placeId: '1' })
        for (const field of ALL_FIELDS) expect(wantsClearing(field, guild)).toBe(true)
    })

    test('clearSignups covers both the sheet and its staff ping', () => {
        const guild = guildWith({ clearSignups: false })

        expect(wantsClearing('sheet:abc', guild)).toBe(false)
        expect(wantsClearing('staff:abc', guild)).toBe(false)

        // Everything else is in a different channel and unaffected.
        expect(wantsClearing('announcement', guild)).toBe(true)
        expect(wantsClearing('host', guild)).toBe(true)
    })

    test('clearAnnouncements covers the notice, the start post and the board', () => {
        const guild = guildWith({ clearAnnouncements: false })

        expect(wantsClearing('upcoming', guild)).toBe(false)
        expect(wantsClearing('announcement', guild)).toBe(false)
        expect(wantsClearing('manifest', guild)).toBe(false)

        expect(wantsClearing('sheet:abc', guild)).toBe(true)
        expect(wantsClearing('host', guild)).toBe(true)
    })

    test('clearHostReminders covers only the host reminder', () => {
        const guild = guildWith({ clearHostReminders: false })

        expect(wantsClearing('host', guild)).toBe(false)
        expect(wantsClearing('announcement', guild)).toBe(true)
        expect(wantsClearing('sheet:abc', guild)).toBe(true)
    })

    test('every setting off means nothing is touched', () => {
        const guild = guildWith({
            clearSignups: false,
            clearAnnouncements: false,
            clearHostReminders: false
        })

        for (const field of ALL_FIELDS) expect(wantsClearing(field, guild)).toBe(false)
    })
})
