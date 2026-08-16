/**
 * Custom ids for components.
 *
 * Discord gives a component 100 characters of state and nothing else, so what
 * a sheet's select menu refers to has to be encoded into its id. Everything a
 * sign-up needs is there — shift, occurrence and sheet — which means a sheet
 * posted before a restart keeps working afterwards with no in-memory index to
 * rebuild.
 *
 *   signup:<eventId>:<occurrenceMs>:<signupId>
 *   36 + 13 + 36 + separators = 92 characters, inside the limit.
 */

const SEPARATOR = ':'

export type SignupTarget = {
    eventId: string
    /** ISO 8601, milliseconds preserved. */
    occurrence: string
    signupId: string
}

export const SIGNUP_PREFIX = 'signup'
export const EDIT_SHIFT_MODAL = 'edit-shift-submit'

export function encodeSignup(target: SignupTarget): string {
    return [SIGNUP_PREFIX, target.eventId, new Date(target.occurrence).getTime(), target.signupId].join(SEPARATOR)
}

export function decodeSignup(customId: string): SignupTarget | null {
    const parts = customId.split(SEPARATOR)
    if (parts.length !== 4 || parts[0] !== SIGNUP_PREFIX) return null

    const [, eventId, millis, signupId] = parts
    if (!eventId || !millis || !signupId) return null

    const time = Number(millis)
    if (!Number.isFinite(time)) return null

    return { eventId, occurrence: new Date(time).toISOString(), signupId }
}

/** The modal that edits a shift note carries its target the same way. */
export function encodeEditShift(eventId: string, occurrence: string): string {
    return [EDIT_SHIFT_MODAL, eventId, new Date(occurrence).getTime()].join(SEPARATOR)
}

export function decodeEditShift(customId: string): { eventId: string; occurrence: string } | null {
    const parts = customId.split(SEPARATOR)
    if (parts.length !== 3 || parts[0] !== EDIT_SHIFT_MODAL) return null

    const [, eventId, millis] = parts
    if (!eventId || !millis) return null

    const time = Number(millis)
    if (!Number.isFinite(time)) return null

    return { eventId, occurrence: new Date(time).toISOString() }
}
