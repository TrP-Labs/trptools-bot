import { describe, expect, test } from 'bun:test'
import type { BotConfig, Guild } from '../api'
import { pingsUpcoming, showsJoinCode } from './announcements'

/**
 * Both settings are read from a config the bot may be a version behind on, so
 * "absent" has to mean something deliberate in each case — and they differ.
 */
function guildWith(config: Partial<BotConfig>): Guild {
    return { config: config as BotConfig } as Guild
}

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
