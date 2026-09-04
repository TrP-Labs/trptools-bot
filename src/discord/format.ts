import type { ColorResolvable } from 'discord.js'
import type { Guild, Shift, SignupPerson } from '../api'
import type { Localizer } from '../i18n'

/** Discord renders these in each reader's own timezone, so never format dates. */
export function timestamp(value: string | Date, style: 'F' | 'f' | 'R' | 't' = 'F'): string {
    return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`
}

export function colorOf(hex: string): ColorResolvable {
    const parsed = Number.parseInt(hex.replace('#', ''), 16)
    return (Number.isFinite(parsed) ? parsed : 0x4287f5) as ColorResolvable
}

export function mentionRole(roleId: string | null): string {
    return roleId ? `<@&${roleId}>` : ''
}

/**
 * How to name someone in a sheet.
 *
 * Discord sign-ups render as a real mention so the person is notified when the
 * shift starts. Website sign-ups have no Discord id to mention, so they show
 * their TrPTools display name instead — a sheet that silently omitted them
 * would make the two halves disagree about who is on shift.
 */
export function mentionPerson(person: SignupPerson, l: Localizer): string {
    if (person.discordId) return `<@${person.discordId}>`
    return person.displayName ?? l.line('bot_common_someone_on_the_website')
}

/**
 * The Roblox deep link a shift announcement offers.
 *
 * `launchData` is what the game reads to drop the player into the right
 * private server, and matches the format the 2023 bot used — changing it would
 * break every existing player's join flow.
 */
export function joinLink(guild: Guild, shift: Shift, code?: string | null): string {
    const owner = shift.ownerRobloxId ?? guild.config.ownerRobloxId
    const payload: Record<string, string | number> = {}

    if (owner) payload.Server = Number(owner)
    if (code) payload.Code = code

    const launchData = encodeURIComponent(JSON.stringify(payload))

    return `https://www.roblox.com/games/start?placeId=${guild.config.placeId}&launchData=${launchData}`
}

/** A shift's own page on the website. */
export function shiftUrl(guild: Guild, shift: Shift): string {
    return `${guild.siteUrl}/g/${guild.groupSlug}/shift/${shift.slug}`
}
