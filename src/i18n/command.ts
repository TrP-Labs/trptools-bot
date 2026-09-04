import type { SlashCommandStringOption } from 'discord.js'
import type { Guild } from '../api'
import { CATALOGS } from './catalog'
import { localizer, type MessageKey } from './index'

/**
 * Slash-command metadata, which Discord localizes for itself.
 *
 * This is the one part of the bot that does **not** say everything in every
 * language the group picked. Discord shows a command's description in the
 * reader's own client language and has no notion of a server's list, so a
 * joined "Announce the next shift / Оголосити наступну зміну" would be what
 * every reader saw regardless of which half they could read. Sending the
 * translations to Discord instead means each person gets one language, theirs.
 *
 * The command *names* stay English on purpose. They are what somebody types,
 * Discord requires them to be lowercase and unpunctuated, and a translated
 * `/begin` would make every guide to the bot wrong for the people reading it.
 */

/**
 * Our language tags, in Discord's spelling.
 *
 * Discord's list is fixed and finite: a tag it does not recognise is rejected
 * for the whole registration, not ignored, so an unmapped language must be
 * left out rather than passed through hopefully.
 *
 * English is registered twice. Discord has no bare `en`, and a reader whose
 * client is set to British English would otherwise fall through to the default
 * — which is the same words, but only by luck.
 */
const DISCORD_LOCALES: Record<string, string[]> = {
    en: ['en-US', 'en-GB'],
    cs: ['cs'],
    de: ['de'],
    fr: ['fr'],
    pl: ['pl'],
    ru: ['ru'],
    uk: ['uk']
}

/** Every shipped language's rendering of one key, keyed by Discord's tag. */
function localizations(key: MessageKey): Record<string, string> {
    const map: Record<string, string> = {}

    for (const locale of Object.keys(CATALOGS)) {
        const rendered = localizer([locale]).first(key)

        for (const tag of DISCORD_LOCALES[locale] ?? []) map[tag] = rendered
    }

    return map
}

/**
 * Sets a command's description in English and in every language that has one.
 *
 * Typed loosely because discord.js gives each builder stage its own type and
 * the chain differs per command; every builder that reaches here has these two
 * methods, and the return value is handed straight back to the caller so the
 * command's own type survives.
 */
export function describeCommand<T>(builder: T, key: MessageKey): T {
    const target = builder as unknown as {
        setDescription(value: string): unknown
        setDescriptionLocalizations(value: Record<string, string>): unknown
    }

    target.setDescription(localizer(['en']).first(key))
    target.setDescriptionLocalizations(localizations(key))

    return builder
}

/** The same, for one option on a command. */
export function describeOption(option: SlashCommandStringOption, key: MessageKey): SlashCommandStringOption {
    return option.setDescription(localizer(['en']).first(key)).setDescriptionLocalizations(localizations(key))
}

/**
 * A page on the group's dashboard.
 *
 * Every "turn it on at …" message points at one, and building the address by
 * hand at each call site is how one of them ends up pointing at a group slug
 * that has since changed.
 */
export function dashboardLink(guild: Guild, page: 'bot' | 'shifts' | 'ranks'): string {
    return `${guild.siteUrl}/dashboard/${guild.groupSlug}/${page}`
}
