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
import { voice } from '../discord/registry'
import { clamp, LIMIT } from '../i18n'

/**
 * One rank's sign-up sheet, as a Discord message.
 *
 * Built from scratch every time rather than patched, so the same function
 * produces the first post and every later edit. That is what keeps a sheet
 * edited by the realtime sync identical to one posted by a command.
 */

export function sheetEmbed(guild: Guild, shift: Shift, sheet: Sheet): EmbedBuilder {
    const l = voice(guild)

    const embed = new EmbedBuilder()
        .setColor(colorOf(sheet.color))
        .setTitle(clamp(l.line('bot_sheet_title', { sheet: sheet.name }), LIMIT.embedTitle))
        .setDescription(
            clamp(
                [
                    // The group's own words, in whichever language they wrote
                    // them. Only the bot's half is rendered per language.
                    sheet.description,
                    l.text('bot_sheet_starts', {
                        name: shift.name,
                        at: timestamp(shift.start, 'F'),
                        relative: timestamp(shift.start, 'R')
                    }),
                    l.text('bot_sheet_how_to')
                ]
                    .filter(Boolean)
                    .join('\n\n'),
                LIMIT.embedDescription
            )
        )

    for (const slot of sheet.slots) {
        const taken = slot.signups.map((person) => mentionPerson(person, l))

        // Capacity is stated on the field name so a full sheet reads as full
        // at a glance rather than needing the names counted. A single-capacity
        // slot says nothing, since "1/1" is the same information as a name.
        const heading =
            slot.capacity > 1
                ? l.line('bot_sheet_slot_heading', {
                      slot: slot.name,
                      taken: taken.length,
                      capacity: slot.capacity
                  })
                : slot.name

        embed.addFields({
            name: clamp(heading, LIMIT.embedFieldName),
            value: clamp(taken.length > 0 ? taken.join('\n') : l.line('bot_sheet_empty'), LIMIT.embedFieldValue),
            inline: false
        })
    }

    embed.setFooter({
        text: clamp(l.line('bot_sheet_footer', { group: guild.groupName }), LIMIT.embedFooter)
    })

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
    const l = voice(guild)

    const customId = encodeSignup({
        eventId: shift.eventId,
        occurrence: shift.start,
        signupId: sheet.signupId
    })

    const options = sheet.slots.slice(0, 25).map((slot) => {
        const full = slot.signups.length >= slot.capacity

        return new StringSelectMenuOptionBuilder()
            .setLabel(
                clamp(
                    full ? l.line('bot_sheet_slot_full', { slot: slot.name }) : slot.name,
                    LIMIT.selectOptionLabel
                )
            )
            .setDescription(
                clamp(
                    slot.description ||
                        l.line('bot_sheet_slot_taken_count', {
                            taken: slot.signups.length,
                            capacity: slot.capacity
                        }),
                    LIMIT.selectOptionDescription
                )
            )
            .setValue(slot.id)
    })

    const select = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(clamp(l.line('bot_sheet_placeholder'), LIMIT.selectPlaceholder))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options)

    const link = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(clamp(l.line('bot_sheet_sign_up_on_website'), LIMIT.buttonLabel))
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
