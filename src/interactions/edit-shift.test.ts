import { expect, test } from 'bun:test'
import type { Client, Interaction } from 'discord.js'
import { handler } from './edit-shift'
import { api } from '../api'
import { encodeEditShift } from '../discord/ids'

test('a saved live shift edit reports success and forwards a modal attachment',async()=>{
 const originals={guild:api.guild,setNote:api.setNote,occurrenceStrict:api.occurrenceStrict}
 const saved:any[]=[];const replies:any[]=[]
 api.guild=async()=>null
 api.setNote=async(_guild,body)=>{saved.push(body);return 'Success'}
 api.occurrenceStrict=async()=>null
 const interaction={guildId:'guild',customId:encodeEditShift('event','2026-09-27T12:00:00.000Z'),isModalSubmit:()=>true,deferReply:async()=>{},editReply:async(payload:any)=>replies.push(payload),fields:{getTextInputValue:(name:string)=>name==='note'?'Updated note':'123',getUploadedFiles:()=>({first:()=>({url:'https://cdn.discordapp.com/attachments/channel/message/shift.png'})})}} as unknown as Interaction
 try{
  await handler.execute(interaction,{} as Client)
  expect(saved[0].imageUrl).toContain('/attachments/')
  expect(saved[0].ownerRobloxId).toBe('123')
  expect(replies).toHaveLength(1)
  expect(replies[0].embeds[0].toJSON().title).toBe('Shift updated')
 }finally{Object.assign(api,originals)}
})
