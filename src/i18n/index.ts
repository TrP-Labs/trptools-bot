import { lookup, SOURCE_LOCALE, type MessageKey } from './catalog'

export type { MessageKey } from './catalog'

/**
 * Saying the same thing in several languages at once.
 *
 * A group picks an ordered list of languages on the dashboard and the bot
 * renders every message in all of them — one Discord message, not one per
 * language. Posting a message per language would double the pings, double the
 * cleanup and put the same sign-up sheet in a channel twice, and a reader
 * would still have to find their own copy.
 *
 * Two shapes, because a title and a paragraph want different joins:
 *
 *   `line`  — "Upcoming shift / Наступна зміна". Titles, field names, button
 *             labels: short things that read as one label.
 *   `block` — each language as its own stanza, separated by a blank line.
 *             Descriptions, and anything with a sentence in it, where " / "
 *             would produce an unreadable run-on.
 *
 * Everything here is pure — no discord.js, no environment — so it can be
 * tested without one. See trap 16 in AGENTS.md.
 */

export type Params = Record<string, string | number>

/**
 * The key naming why something did not happen.
 *
 * Failures travel as one of these rather than as an English sentence. A reason
 * is always shown inside a longer message, so it has to be rendered in the
 * same language as its surroundings — a sender that returned "Discord refused
 * the message" would hand the command a fragment it could not translate, and
 * every apology would come out half English.
 */
export type ReasonKey = Extract<MessageKey, `bot_reason_${string}`>

/** One language's renderer. */
export interface Translate {
    (key: MessageKey, params?: Params): string
    readonly locale: string
}

export interface Localizer {
    /** The languages this group asked for, in the order it asked for them. */
    readonly locales: string[]
    /** The first language, for the rare place Discord allows only one. */
    readonly first: Translate
    /** Every language on one line, joined with " / ". */
    line(key: MessageKey, params?: Params): string
    /** Every language as its own stanza. */
    text(key: MessageKey, params?: Params): string
    /**
     * A message built from several strings, rendered once per language.
     *
     * Composing has to happen *inside* a language rather than across them, or
     * a sentence ends up half English and half not. Everything that joins
     * strings together — a list of results, a reason inside an apology —
     * takes a single-language renderer and is called once per language.
     *
     * Falsy lines are dropped, so a conditional line is `condition && t(...)`
     * rather than a filter at every call site.
     */
    block(build: (t: Translate) => string | (string | false | null | undefined)[]): string
}

const INLINE_SEPARATOR = ' / '
const BLOCK_SEPARATOR = '\n\n'

/**
 * Fills `{name}` placeholders.
 *
 * A placeholder with no value is left as it was written rather than blanked:
 * `{code}` in the middle of a sentence is a translator's mistake worth seeing,
 * where an empty gap reads as a bug in the shift.
 */
function interpolate(template: string, params?: Params): string {
    if (!params) return template

    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole
    )
}

function renderer(locale: string): Translate {
    const translate = ((key: MessageKey, params?: Params) =>
        interpolate(lookup(locale, key) ?? lookup(SOURCE_LOCALE, key) ?? key, params)) as {
        (key: MessageKey, params?: Params): string
        locale: string
    }

    translate.locale = locale

    return translate
}

/**
 * Drops repeats, keeping the first.
 *
 * A language with no translation for a key falls back to English, so a group
 * running English and Ukrainian before the Ukrainian bot strings exist would
 * otherwise read "Upcoming shift / Upcoming shift" on every announcement.
 * Saying it twice is worse than saying it once in the wrong language.
 */
function distinct(values: string[]): string[] {
    return [...new Set(values.filter((value) => value.length > 0))]
}

/**
 * The languages a group actually gets.
 *
 * An empty or absent list is English: the API defaults the column, but the bot
 * deploys independently and may be talking to one that predates it, and a bot
 * that says nothing is worse than a bot that says it in English.
 */
export function resolveLocales(languages: readonly string[] | null | undefined): string[] {
    const asked = distinct((languages ?? []).map((language) => language.trim()))
    return asked.length > 0 ? asked : [SOURCE_LOCALE]
}

export function localizer(languages: readonly string[] | null | undefined): Localizer {
    const locales = resolveLocales(languages)
    const translators = locales.map(renderer)

    const join = (separator: string, build: (t: Translate) => string) =>
        distinct(translators.map((translate) => build(translate).trim())).join(separator)

    return {
        locales,
        first: translators[0]!,
        line: (key, params) => join(INLINE_SEPARATOR, (t) => t(key, params)),
        text: (key, params) => join(BLOCK_SEPARATOR, (t) => t(key, params)),
        block: (build) =>
            join(BLOCK_SEPARATOR, (t) => {
                const result = build(t)
                return Array.isArray(result) ? result.filter(Boolean).join('\n') : result
            })
    }
}

/**
 * Cuts a rendered string to what Discord will accept.
 *
 * Every limit here is a hard one: Discord refuses the whole message rather
 * than truncating, so a group running four languages would find its
 * announcements silently failing instead of reading a little short. The
 * ellipsis is there so a cut is visibly a cut.
 */
export function clamp(value: string, limit: number): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`
}

/** Discord's own caps, named so a call site says which one it is obeying. */
export const LIMIT = {
    embedTitle: 256,
    embedDescription: 4096,
    embedFieldName: 256,
    embedFieldValue: 1024,
    embedFooter: 2048,
    buttonLabel: 80,
    selectPlaceholder: 150,
    selectOptionLabel: 100,
    selectOptionDescription: 100,
    modalTitle: 45,
    textInputLabel: 45,
    textInputPlaceholder: 100,
    pollQuestion: 300,
    pollAnswer: 55
} as const
