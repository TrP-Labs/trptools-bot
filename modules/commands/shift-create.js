import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js'

export async function shiftcreate(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('createshift')
    .setTitle('Schedule a new shift');

  const dow = new TextInputBuilder()
    .setCustomId('dayofweek')
    .setLabel("Day of the week")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('sunday, monday, tue, wed, etc')
    .setMinLength(3)
    .setMaxLength(9);

  const time = new TextInputBuilder()
    .setCustomId('time')
    .setLabel("Time (UTC)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('17:00')
    .setMinLength(5)
    .setMaxLength(5);

  const shiftname = new TextInputBuilder()
    .setCustomId('name')
    .setLabel("Shift name")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(dow);
  const secondActionRow = new ActionRowBuilder().addComponents(time);
  const thirdActionRow = new ActionRowBuilder().addComponents(shiftname);

  modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
  
  await interaction.showModal(modal);
}