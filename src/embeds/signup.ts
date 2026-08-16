import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js'
import type { Guild, Sheet, Shift } from '../api'
import { colorOf, mentionPerson, shiftUrl, timestamp } from '../discord/format'
import { encodeSignup } from '../discord/ids'

/**
 * One rank's sign-up sheet, as a Discord message.
 *
 * Built from scratch every time rather than patched, so the same function
 * produces the first post and every later edit. That is what keeps a sheet
 * edited by the realtime sync identical to one posted by a command.
 */

export function sheetEmbed(guild: Guild, shift: Shift, sheet: Sheet): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(colorOf(sheet.color))
        .setTitle(`${sheet.name} — sign-ups`)
        .setDescription(
            [
                sheet.description,
                `**${shift.name}** starts ${timestamp(shift.start, 'F')} (${timestamp(shift.start, 'R')})`,
                'Pick a slot below, or sign up on the website. Both stay in step.'
            ]
                .filter(Boolean)
                .join('\n\n')
        )

    for (const slot of sheet.slots) {
        const taken = slot.signups.map(mentionPerson)

        // Capacity is stated on the field name so a full sheet reads as full
        // at a glance rather than needing the names counted.
        const heading = slot.capacity > 1 ? `${slot.name} (${taken.length}/${slot.capacity})` : slot.name

        embed.addFields({
            name: heading,
            value: taken.length > 0 ? taken.join('\n') : '*Empty*',
            inline: false
        })
    }

    embed.setFooter({ text: `${guild.groupName} · sign-ups update live` })

    return embed
}

/**
 * The select menu and the link out to the website.
 *
 * Every slot is offered, full ones included, because selecting a slot you
 * already hold is how you give it up — hiding a full slot would trap the last
 * person to take it.
 */
export function sheetComponents(guild: Guild, shift: Shift, sheet: Sheet) {
    const customId = encodeSignup({
        eventId: shift.eventId,
        occurrence: shift.start,
        signupId: sheet.signupId
    })

    const options = sheet.slots.slice(0, 25).map((slot) => {
        const full = slot.signups.length >= slot.capacity

        return new StringSelectMenuOptionBuilder()
            .setLabel(full ? `${slot.name} (full)` : slot.name)
            .setDescription((slot.description || `${slot.signups.length}/${slot.capacity} taken`).slice(0, 100))
            .setValue(slot.id)
    })

    const select = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder('Choose a slot, or pick yours again to drop it')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options)

    const link = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open on the website')
        .setURL(shiftUrl(guild, shift))

    return [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(link)
    ]
}

/** Everything needed to send or edit a sheet's message. */
export function sheetMessage(guild: Guild, shift: Shift, sheet: Sheet) {
    return {
        embeds: [sheetEmbed(guild, shift, sheet)],
        components: sheetComponents(guild, shift, sheet)
    }
}
