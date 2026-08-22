import { describe, expect, test } from 'bun:test'
import type { BotConfig, Guild } from '../api'
import { pingsUpcoming, showsJoinCode, wantsClearing } from './rules'

/**
 * Every setting here is optional, because the bot deploys independently of the
 * API and may be a version behind one that does not send it. What "absent"
 * means is therefore load-bearing, and differs per setting.
 */
function guildWith(config: Partial<BotConfig>): Guild {
    return { config: config as BotConfig } as Guild
}

/** The field names `state.ts` records messages under. */
const ALL_FIELDS = ['sheet:abc', 'staff:abc', 'announcement', 'upcoming', 'manifest', 'host']

describe('showsJoinCode', () => {
    test('shows the code when the group has said nothing', () => {
        expect(showsJoinCode('ABC123', guildWith({}))).toBe(true)
    })

    test('hides it when the group turned it off', () => {
        expect(showsJoinCode('ABC123', guildWith({ announceJoinCode: false }))).toBe(false)
    })

    test('shows it when explicitly on', () => {
        expect(showsJoinCode('ABC123', guildWith({ announceJoinCode: true }))).toBe(true)
    })

    test('there is nothing to show without a code', () => {
        expect(showsJoinCode(null, guildWith({ announceJoinCode: true }))).toBe(false)
        expect(showsJoinCode(undefined, guildWith({}))).toBe(false)
        expect(showsJoinCode('', guildWith({}))).toBe(false)
    })
})

describe('pingsUpcoming', () => {
    test('stays quiet when the group has said nothing', () => {
        // The opposite default to the join code: silence is the safe one here.
        expect(pingsUpcoming(guildWith({}))).toBe(false)
    })

    test('stays quiet against an API that does not know the setting', () => {
        expect(pingsUpcoming(guildWith({ placeId: '1' }))).toBe(false)
    })

    test('pings only when explicitly asked to', () => {
        expect(pingsUpcoming(guildWith({ pingUpcoming: true }))).toBe(true)
        expect(pingsUpcoming(guildWith({ pingUpcoming: false }))).toBe(false)
    })
})

describe('wantsClearing', () => {
    test('clears everything when a group has said nothing', () => {
        const guild = guildWith({})
        for (const field of ALL_FIELDS) expect(wantsClearing(field, guild)).toBe(true)
    })

    test('an older API that omits the settings still clears everything', () => {
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
