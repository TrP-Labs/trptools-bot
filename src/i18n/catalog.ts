import en from '../../messages/en.json'
import cs from '../../messages/cs.json'
import de from '../../messages/de.json'
import pl from '../../messages/pl.json'
import fr from '../../messages/fr.json'
import ru from '../../messages/ru.json'
import uk from '../../messages/uk.json'

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
 * `messages/*.json` are vendored from `TrP-Labs/Locales`, never edited here.
 * English is the source: it is what typing is derived from, and what every
 * other language falls back to key by key if a catalog ever drifts.
 *
 * Catalogs are translated directly in the Locales repository. Its validation
 * checks full coverage and placeholder parity before vendoring, independently
 * of Crowdin and without a network dependency at runtime.
 */
export const CATALOGS = {
    en,
    cs,
    de,
    fr,
    pl,
    ru,
    uk
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
