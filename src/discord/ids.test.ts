import { describe, expect, test } from 'bun:test'
import { decodeEditShift, decodeSignup, encodeEditShift, encodeSignup } from './ids'

/**
 * A component's custom id is the only state Discord hands back, and it is
 * capped at 100 characters. If encoding ever outgrows that, Discord rejects
 * the message at send time with a validation error that says nothing useful
 * about which field was too long — so the budget is checked here instead.
 */

const target = {
    eventId: '9f8b0c1e-5d3a-4f2b-8c7d-1a2b3c4d5e6f',
    occurrence: '2026-08-16T18:00:00.000Z',
    sheetId: 'b00638fe-2282-4617-853f-0afeb00496d9'
}

describe('signup custom ids', () => {
    test('round-trips a target', () => {
        expect(decodeSignup(encodeSignup(target))).toEqual(target)
    })

    test('preserves milliseconds', () => {
        // A signup is keyed on the exact occurrence timestamp. Losing the
        // milliseconds would silently match nothing.
        const precise = { ...target, occurrence: '2026-08-16T18:00:00.123Z' }
        expect(decodeSignup(encodeSignup(precise))?.occurrence).toBe('2026-08-16T18:00:00.123Z')
    })

    test('fits inside Discord\'s 100 character limit', () => {
        expect(encodeSignup(target).length).toBeLessThanOrEqual(100)
    })

    test('rejects ids belonging to something else', () => {
        expect(decodeSignup('someothercomponent')).toBeNull()
        expect(decodeSignup('signup:only:three')).toBeNull()
        expect(decodeSignup(`signup:${target.eventId}:notanumber:${target.sheetId}`)).toBeNull()
    })
})

describe('edit-shift custom ids', () => {
    test('round-trips', () => {
        const encoded = encodeEditShift(target.eventId, target.occurrence)
        expect(decodeEditShift(encoded)).toEqual({
            eventId: target.eventId,
            occurrence: target.occurrence
        })
    })

    test('fits inside the limit', () => {
        expect(encodeEditShift(target.eventId, target.occurrence).length).toBeLessThanOrEqual(100)
    })

    test('does not match a signup id', () => {
        expect(decodeEditShift(encodeSignup(target))).toBeNull()
        expect(decodeSignup(encodeEditShift(target.eventId, target.occurrence))).toBeNull()
    })
})

test('public vote ids preserve the occurrence and withdrawal action within Discord limits', async () => {
    const { encodeVote, decodeVote } = await import('./ids')
    const eventId = '12345678-1234-1234-1234-123456789012', occurrence = '2026-10-10T18:00:00.123Z'
    for (const attending of [true, false]) {
        const id = encodeVote(eventId, occurrence, attending)
        expect(id.length).toBeLessThanOrEqual(100)
        expect(decodeVote(id)).toEqual({ eventId, occurrence, attending })
    }
    expect(decodeVote('shift-vote:bad:1:yes')).toBeNull()
    expect(decodeVote(`shift-vote:${eventId}:1e100:yes`)).toBeNull()
})
