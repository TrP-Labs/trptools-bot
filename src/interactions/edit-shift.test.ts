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
 const interaction={guildId:'guild',customId:encodeEditShift('event','2026-09-27T12:00:00.000Z'),isModalSubmit:()=>true,deferReply:async()=>{},editReply:async(payload:any)=>replies.push(payload),fields:{getTextInputValue:(name:string)=>{if(name==='note')return 'Updated note';if(name==='owner')return '123';throw new Error('Old modal has no field')},getUploadedFiles:()=>({first:()=>({url:'https://cdn.discordapp.com/attachments/channel/message/shift.png'})})}} as unknown as Interaction
 try{
  await handler.execute(interaction,{} as Client)
  expect(saved[0].imageUrl).toContain('/attachments/')
  expect(saved[0].ownerRobloxId).toBe('123')
  expect(saved[0].joinCode).toBeUndefined()
  expect(saved[0].announceJoinCode).toBeUndefined()
  expect(replies).toHaveLength(1)
  expect(replies[0].embeds[0].toJSON().title).toBe('Shift updated')
 }finally{Object.assign(api,originals)}
})

test('code controls validate before writing and allow clearing an occurrence override',async()=>{
 const originals={guild:api.guild,setNote:api.setNote,occurrenceStrict:api.occurrenceStrict}
 const saved:any[]=[];const replies:any[]=[]
 api.guild=async()=>null
 api.setNote=async(_guild,body)=>{saved.push(body);return 'Success'}
 api.occurrenceStrict=async()=>null
 try{
  for(const [code,visibility,valid] of [['ab','no',false],['AB CD','no',false],['CODE123','maybe',false],[' CODE123 ',' NO ',true],['','default',true]] as const){
   const interaction={guildId:'guild',customId:encodeEditShift('event','2026-09-27T12:00:00.000Z'),isModalSubmit:()=>true,deferReply:async()=>{},editReply:async(payload:any)=>replies.push(payload),fields:{getTextInputValue:(name:string)=>({note:'Note',owner:'',code,codeVisibility:visibility} as Record<string,string>)[name],getUploadedFiles:()=>null}} as unknown as Interaction
   const writes=saved.length
   await handler.execute(interaction,{} as Client)
   expect(saved.length).toBe(writes+(valid?1:0))
  }
  expect(saved[0].joinCode).toBe('CODE123')
  expect(saved[0].announceJoinCode).toBe(false)
  expect(saved[1].joinCode).toBeNull()
  expect(saved[1].announceJoinCode).toBeNull()
  expect(replies).toHaveLength(5)
 }finally{Object.assign(api,originals)}
})
