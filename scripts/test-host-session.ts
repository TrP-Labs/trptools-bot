import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import type { Client,Interaction,ChatInputCommandInteraction } from 'discord.js'
import { configureEnv } from '../src/env'
import { api } from '../src/api'
import { state } from '../src/state'
import { command as begin } from '../src/commands/begin'
import { command as staffBegin } from '../src/commands/staff-begin'
import { command as editShift } from '../src/commands/edit-shift'
import { handler as editModal } from '../src/interactions/edit-shift'
import { announceUpcoming } from '../src/features/announcements'
import { encodeEditShift } from '../src/discord/ids'
import { processDueAction } from '../src/features/automation'
import Redis from 'ioredis'

const fixture = JSON.parse(await readFile('/tmp/trptools-hostfix-fixture.json','utf8'))
const results:unknown[]=[]
for(const origin of ['http://localhost:53001','http://localhost:53004']) {
    configureEnv({API_URL:origin,BOT_SERVICE_TOKEN:'local-host-verification-only',DISCORD_APP_ID:'111111111111111111',DISCORD_BOT_TOKEN:'test-only',REDIS_URL:'redis://127.0.0.1:56379'})
    const messages=new Map<string,{channel:string;payload:any}>()
    const sends:any[]=[];const edits:any[]=[];const replies:any[]=[];let modal:any
    const serialize=(value:any):any=>value?.toJSON?value.toJSON():Array.isArray(value)?value.map(serialize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,serialize(item)])):value
    const client={channels:{fetch:async(channel:string)=>({id:channel,isSendable:()=>true,messages:{fetch:async(id:string)=>({edit:async(payload:any)=>{edits.push({channel,id,payload:serialize(payload)});if(messages.has(id))messages.get(id)!.payload=serialize(payload)}})},send:async(payload:any)=>{const id=String(sends.length+100);const sent={channel,payload:serialize(payload)};sends.push(sent);messages.set(id,sent);return {id}}})}} as unknown as Client
    const interaction={guildId:'111111111111111111',options:{getString:()=>null},deferReply:async()=>{},editReply:async(payload:any)=>replies.push(serialize(payload)),reply:async(payload:any)=>replies.push(serialize(payload)),showModal:async(payload:any)=>{modal=serialize(payload)}} as unknown as ChatInputCommandInteraction
    async function host(path='',body?:unknown,method='GET') {
        const response=await fetch(origin+'/host/'+fixture.roomId+path,{method,headers:{cookie:`access_token=${fixture.token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
        assert.equal(response.status,200,await response.clone().text());return response.json() as Promise<any>
    }
    const guild=await api.guildStrict('111111111111111111');assert(guild)
    guild.config.manifestEnabled=false
    const redis=new Redis('redis://127.0.0.1:56379')
    // Exercise the panel's queue -> bot consumer -> completion path, using the
    // real API and Redis, before exercising the Discord command path.
    const timeline=(await host()).timeline
    for(const item of timeline){
        item.dueAt=Date.now()+60000
        if(item.action==='BEGIN'||item.action==='STAFF_START'){
            item.status='WAITING';delete item.leaseUntil;delete item.source
            await redis.del(`bot:done:${item.action}:${fixture.eventId}:${Date.parse(fixture.start)}`)
        }
    }
    await redis.hset('room:'+fixture.roomId,'timeline',JSON.stringify(timeline))
    await state.forget(fixture.eventId,fixture.start)
    await host('/note',{note:'Panel begin',ownerRobloxId:'123',joinCode:'PANEL123',announceJoinCode:false},'PUT')
    for(const id of ['staff','public'])await host('/events/'+id,{operation:'ACTIVATE'},'POST')
    const due=(await api.due()).filter(item=>item.eventId===fixture.eventId&&item.roomId===fixture.roomId)
    assert(due.some(item=>item.action==='STAFF_START'));assert(due.some(item=>item.action==='BEGIN'))
    for(const action of due)await processDueAction(client,action)
    const board=await api.manifest(guild.guildId)
    assert.equal(board.status,'changed')
    if(board.status==='changed'){
        assert.deepEqual(Array.from(board.image.subarray(0,8)),[137,80,78,71,13,10,26,10])
        assert.equal((await api.manifest(guild.guildId,board.etag)).status,'unchanged')
        await writeFile('/tmp/trptools-hostfix-manifest.png',board.image)
    }
    const finished=await host()
    assert.equal(finished.timeline.find((item:any)=>item.action==='BEGIN').status,'ACTIVATED')
    assert.equal(finished.timeline.find((item:any)=>item.action==='STAFF_START').status,'ACTIVATED')
    assert(sends.some(item=>item.channel==='333333333333333333'&&JSON.stringify(item.payload).includes('**PANEL123**')))
    assert(sends.some(item=>item.channel==='222222222222222222'&&item.payload.embeds[0].title.includes('is starting')))
    assert(sends.filter(item=>item.channel==='222222222222222222').every(item=>!JSON.stringify(item.payload).includes('**PANEL123**')))
    const sendCount=sends.length
    for(const action of due)await processDueAction(client,action)
    assert.equal(sends.length,sendCount,'retrying a completed action must not repost')
    results.push({origin,flow:'panel activation -> due action consumer -> completion',sends:sendCount,result:'passed'})
    for(const item of timeline)if(item.action==='BEGIN'||item.action==='STAFF_START')item.status='WAITING'
    await redis.hset('room:'+fixture.roomId,'timeline',JSON.stringify(timeline))
    redis.disconnect();sends.length=0;edits.length=0;messages.clear()
    // Reset only the bot's fixture bookkeeping, never any production messages.
    await state.forget(fixture.eventId,fixture.start)
    await host('/note',{note:'Before editing',ownerRobloxId:null,joinCode:'STAFF123',announceJoinCode:false},'PUT')
    const shift=await api.shift(guild.guildId,'current');assert(shift)
    assert.equal(shift.joinCode,'STAFF123')
    await announceUpcoming(client,guild,shift)
    const upcoming=JSON.stringify(sends[0])
    await staffBegin.execute({interaction,client,guild})
    assert(sends.some(item=>item.channel==='333333333333333333'&&JSON.stringify(item.payload).includes('**STAFF123**')))
    const staff=(await host()).timeline.find((item:any)=>item.action==='STAFF_START')
    assert.equal(staff.status,'ACTIVATED')
    await begin.execute({interaction,client,guild})
    const publicMessage=sends.find(item=>item.channel==='222222222222222222'&&item.payload.embeds[0].title.includes('is starting'))
    assert(publicMessage)
    assert(!JSON.stringify(publicMessage).includes('**STAFF123**'))
    assert.equal((await host()).timeline.find((item:any)=>item.action==='BEGIN').status,'ACTIVATED')
    await editShift.execute({interaction,client,guild})
    assert(modal);assert.equal(modal.components.length,5)
    const fields=modal.components.flatMap((row:any)=>row.component?[row.component]:row.components??[])
    assert.equal(fields.find((field:any)=>field.custom_id==='code').value,'STAFF123')
    const submitted={guildId:guild.guildId,customId:encodeEditShift(fixture.eventId,fixture.start),isModalSubmit:()=>true,deferReply:async()=>{},editReply:async(payload:any)=>replies.push(serialize(payload)),fields:{getTextInputValue:(name:string)=>({note:'Edited through Discord',owner:'456',code:'NEWCODE',codeVisibility:'no'} as Record<string,string>)[name]!,getUploadedFiles:()=>null}} as unknown as Interaction
    const priorSends=sends.length
    await editModal.execute(submitted,client)
    assert.equal(replies.at(-1).embeds[0].title,'Shift updated')
    const saved=await host()
    assert.equal(saved.note,'Edited through Discord');assert.equal(saved.joinCode,'NEWCODE');assert.equal(saved.announceJoinCode,false)
    assert.equal(sends.length,priorSends)
    assert.equal(JSON.stringify(sends[0]),upcoming)
    assert(!edits.some(item=>item.id==='100'))
    assert(edits.some(item=>item.channel==='333333333333333333'&&JSON.stringify(item.payload).includes('**NEWCODE**')))
    assert(edits.every(item=>item.payload.allowedMentions.parse.length===0))
    assert(edits.filter(item=>item.channel==='222222222222222222').every(item=>!JSON.stringify(item.payload).includes('**NEWCODE**')))
    results.push({origin,commands:['staff-begin','begin','edit-shift','modal-submit'],sends:sends.length,edits:edits.length,result:'passed'})
    console.log(origin,'actual command/modal handlers and API passed; Discord delivery captured locally')
}
await writeFile('/tmp/trptools-hostfix-bot-results.json',JSON.stringify(results,null,2))
process.exit(0)
