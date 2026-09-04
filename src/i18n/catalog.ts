import en from '../../messages/en.json'

/**
 * Every language the bot ships, imported by name.
 *
 * Listed explicitly for the same reason the command list is (`commands/index.ts`):
 * a directory scan makes the shipped set depend on what happens to be on disk
 * and rules out ever bundling the bot into one file. Adding a language is
 * `./scripts/pull-locales.sh`, then a line here — and that second step is the
 * decision that a translation is complete enough to put in front of people,
 * exactly as `project.inlang/settings.json` is on the website.
 *
 * `messages/en.json` is vendored from `TrP-Labs/Locales`, never edited here.
 * English is the source: it is what typing is derived from, and what every
 * other language falls back to key by key, so a half-translated language is
 * useful rather than full of holes.
 */
export const CATALOGS = {
    en
} satisfies Record<string, Partial<Record<string, string>>>

/** The language every other one falls back to. */
export const SOURCE_LOCALE = 'en'

export type Locale = keyof typeof CATALOGS

/**
 * The key of a message.
 *
 * Derived from the English catalogue, so a key that is not in it is a compile
 * error rather than a message that silently renders as its own key.
 */
export type MessageKey = keyof typeof en

const catalogs: Record<string, Partial<Record<string, string>>> = CATALOGS

export function isShipped(locale: string): boolean {
    return locale in catalogs
}

/**
 * One message in one language, or undefined if that language has not
 * translated it.
 *
 * A regional tag falls back to its base language, so a group that asks for
 * `pt-BR` on an instance shipping `pt` gets Portuguese rather than English.
 */
export function lookup(locale: string, key: MessageKey): string | undefined {
    return catalogs[locale]?.[key] ?? catalogs[locale.split('-')[0] ?? '']?.[key]
}
