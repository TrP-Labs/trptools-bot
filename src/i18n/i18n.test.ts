import { describe, expect, test } from 'bun:test'
import en from '../../messages/en.json'
import { clamp, localizer, resolveLocales } from './index'

/**
 * The multi-language renderer.
 *
 * Pinned because every one of these is a small rule that fails quietly when it
 * is backwards: a group reading its own announcements twice, a title Discord
 * refuses for being one character too long, a placeholder blanked instead of
 * filled. Nothing here imports `env.ts`, so `bun test` runs it in CI with no
 * `.env` present — see trap 16 in AGENTS.md.
 */

describe('resolveLocales', () => {
    test('an unset or empty list is English', () => {
        expect(resolveLocales(null)).toEqual(['en'])
        expect(resolveLocales(undefined)).toEqual(['en'])
        expect(resolveLocales([])).toEqual(['en'])
    })

    test('keeps the order the group chose', () => {
        expect(resolveLocales(['uk', 'en'])).toEqual(['uk', 'en'])
    })

    test('drops repeats, keeping the first', () => {
        expect(resolveLocales(['en', 'uk', 'en'])).toEqual(['en', 'uk'])
    })
})

describe('rendering', () => {
    test('fills placeholders', () => {
        expect(localizer(['en']).line('bot_announce_start_title', { name: 'Evening service' })).toBe(
            'Evening service is starting'
        )
    })

    test('leaves a placeholder nobody supplied alone', () => {
        // Blanking it would read as a bug in the shift rather than a mistake
        // in the catalogue, which is exactly the wrong way round.
        expect(localizer(['en']).line('bot_announce_start_title')).toBe('{name} is starting')
    })

    test('an unknown language falls back to English rather than to the key', () => {
        expect(localizer(['zz']).line('bot_announce_upcoming_title')).toBe('Upcoming shift')
    })

    test('a regional tag falls back to its base language', () => {
        expect(localizer(['en-GB']).line('bot_announce_upcoming_title')).toBe('Upcoming shift')
    })
})

describe('several languages at once', () => {
    test('does not say the same thing twice', () => {
        // A language the bot does not ship renders as English, so a group
        // running it alongside English would otherwise read "Upcoming shift /
        // Upcoming shift" on every announcement. Deliberately an unshipped
        // tag rather than a real one: this is about the collapsing, and
        // pinning it to whichever language happens to be untranslated today
        // makes the test fail the moment somebody finishes translating it.
        expect(localizer(['en', 'zz']).line('bot_announce_upcoming_title')).toBe(
            localizer(['en']).line('bot_announce_upcoming_title')
        )
    })

    test('two languages that differ are both said', () => {
        const en = localizer(['en']).line('bot_announce_upcoming_title')
        const uk = localizer(['uk']).line('bot_announce_upcoming_title')

        // Guards the catalogue as well as the join: if Ukrainian ever comes
        // back as English, this says so rather than quietly passing.
        expect(uk).not.toBe(en)
        expect(localizer(['en', 'uk']).line('bot_announce_upcoming_title')).toBe(`${en} / ${uk}`)
    })

    test('a block composes inside each language, never across them', () => {
        const l = localizer(['en'])

        expect(
            l.block((t) => [t('bot_status_nothing_running'), t('bot_status_nothing_scheduled')])
        ).toBe('Nothing running now\nNothing scheduled')
    })

    test('a block drops falsy lines', () => {
        const l = localizer(['en'])

        expect(l.block((t) => [t('bot_status_nothing_running'), false, null, undefined])).toBe(
            'Nothing running now'
        )
    })

    test('the first language is the one Discord allows only one of', () => {
        expect(localizer(['uk', 'en']).first.locale).toBe('uk')
    })
})

describe('clamp', () => {
    test('leaves anything that fits alone', () => {
        expect(clamp('Upcoming shift', 256)).toBe('Upcoming shift')
    })

    test('cuts to the limit, ellipsis included', () => {
        const cut = clamp('abcdefghij', 5)

        expect(cut).toBe('abcd…')
        expect(cut.length).toBe(5)
    })
})

describe('the catalogue', () => {
    test('carries no empty strings', () => {
        const empty = Object.entries(en).filter(([, value]) => value.trim().length === 0)
        expect(empty).toEqual([])
    })

    test('every key is prefixed, so the two catalogues cannot collide', () => {
        const stray = Object.keys(en).filter((key) => !key.startsWith('bot_'))
        expect(stray).toEqual([])
    })
})
