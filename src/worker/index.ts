import { verifyKey } from 'discord-interactions'
import { api, ApiError, type DueAction } from '../api'
import { commands } from '../commands'
import { assertEnv, configureEnv, env, type BotEnv } from '../env'
import { processDueAction, refreshBoard } from '../features/automation'
import { boardRefreshDue } from '../features/rules'
import { refreshSheets } from '../features/signups'
import { handler as signup } from '../interactions/signup'
import { handler as editShift } from '../interactions/edit-shift'
import { englishOnly, reply } from '../discord/registry'
import { createInteraction, type InlineCallback } from './interaction'
import { createRestClient } from './restClient'
import { JobBusyError, state } from '../state'
import { timed } from '../timing'
import { coalesceJobs } from './jobs'

type SignupChange = { groupId: string; eventId: string; occurrence: string; sheetId: string }
type BotJob = (
    | { kind: 'signup'; change: SignupChange }
    | { kind: 'due'; action: DueAction }
    | { kind: 'board'; guildId: string }
    | { kind: 'interaction'; payload: any }
) & { enqueuedAt?: number }

type WorkerEnv = BotEnv & { JOBS: Queue<BotJob>; INTERACTIONS: Queue<BotJob> }

async function sendJobs(queue: Queue<BotJob>, jobs: BotJob[]) {
    for (let start = 0; start < jobs.length; start += 100) {
        await queue.sendBatch(jobs.slice(start, start + 100).map((body) => ({ body })))
    }
}

async function runInteraction(raw: any, initiallyDeferred = false, inline?: InlineCallback) {
    const client = createRestClient()
    const { interaction, acknowledged, isAcknowledged, isAcknowledging } = createInteraction(raw, undefined, initiallyDeferred, inline)
    const command = commands.find((candidate) => candidate.data.name === raw.data?.name)

    const run = (async () => {
        try {
            if (interaction.isChatInputCommand()) {
                if (!command) {
                    await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 })
                    return
                }
                if (!interaction.guildId) {
                    await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_server_only'))], flags: 64 })
                    return
                }
                if (command.data.name !== 'ping' && command.data.name !== 'edit-shift') {
                    await interaction.deferReply(command.data.name === 'status' ? { flags: 64 } : undefined)
                }
                if (command.needsGuild === false) {
                    await command.execute({ interaction, client })
                    return
                }
                const guild = await api.guildStrict(interaction.guildId)
                if (!guild) {
                    await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_not_connected'))], flags: 64 })
                    return
                }
                await command.execute({ interaction, client, guild })
                return
            }
            if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
                const handler = [signup, editShift].find((candidate) => candidate.matches(interaction.customId))
                if (handler) await handler.execute(interaction, client)
                else await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 })
            }
        } catch (error) {
            console.error('interaction failed', {
                guildId: interaction.guildId,
                command: raw.data?.name ?? raw.data?.custom_id ?? 'unknown',
                error
            })
            if (interaction.isRepliable()) {
                try { await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 }) }
                catch (replyError) {
                    console.error('failure reply failed', {
                        guildId: interaction.guildId,
                        command: raw.data?.name ?? raw.data?.custom_id ?? 'unknown',
                        error: replyError
                    })
                }
            }
        }
    })()

    return { run, acknowledged, isAcknowledged, isAcknowledging, interaction }
}

async function sync(changes: SignupChange[], client: ReturnType<typeof createRestClient>) {
    const change = changes[0]!
    const guild = await api.guildForGroup(change.groupId)
    if (!guild) return
    await state.withGuildLock(guild.guildId, () => refreshSheets(client, guild.guildId, change.eventId,
        change.occurrence, [...new Set(changes.map((item) => item.sheetId))], guild))
}

function configured(bindings: BotEnv) {
    configureEnv(bindings)
    // The Bun process has a localhost default for development. A Worker needs
    // an explicit, publicly reachable API origin instead.
    if (!bindings.API_URL) throw new Error('Missing API_URL Worker binding')
    assertEnv([
        'DISCORD_APP_ID', 'DISCORD_BOT_TOKEN', 'API_URL', 'BOT_SERVICE_TOKEN',
        'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SYNC_TOKEN'
    ])
}

export default {
    async fetch(request: Request, bindings: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
        configured(bindings)
        const path = new URL(request.url).pathname

        if (request.method === 'GET' && (path === '/' || path === '/health')) {
            return Response.json({ status: 'ok' })
        }

        if (path === '/interactions' && request.method === 'POST') {
            assertEnv(['DISCORD_PUBLIC_KEY'])
            const signature = request.headers.get('x-signature-ed25519') ?? ''
            const timestamp = request.headers.get('x-signature-timestamp') ?? ''
            const body = await request.text()
            if (!await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
                return new Response('Bad signature', { status: 401 })
            }
            const payload = JSON.parse(body)
            if (payload.type === 1) return Response.json({ type: 1 })
            // Most slash commands can involve several Discord sends. Defer
            // within Discord's deadline, then let the Queue own the work.
            // Ping needs its immediate latency response; edit-shift needs to
            // open a modal as its first response.
            if (payload.type === 2 && commands.some((command) => command.data.name === payload.data?.name)
                && payload.data?.name !== 'ping' && payload.data?.name !== 'edit-shift') {
                try {
                    await bindings.INTERACTIONS.send({ kind: 'interaction', payload, enqueuedAt: Date.now() })
                    return Response.json({ type: 5, data: payload.data.name === 'status' ? { flags: 64 } : {} })
                } catch (error) {
                    console.error('could not queue interaction', error)
                    return Response.json({ type: 4, data: { flags: 64,
                        embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled')).toJSON()] } })
                }
            }
            let response: { type: number; data?: any } | undefined
            const inline: InlineCallback | undefined = payload.data?.name === 'ping' ? undefined : (value) => { response = value }
            const { run, acknowledged, isAcknowledged, isAcknowledging, interaction } = await runInteraction(payload, false, inline)
            ctx.waitUntil(run)
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
                await Promise.race([acknowledged, run, new Promise((resolve) => { timer = setTimeout(resolve, 2400) })])
            } finally { clearTimeout(timer) }
            if (!isAcknowledged() && !isAcknowledging()) {
                await (interaction as any).reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 })
            }
            return response ? Response.json(response) : new Response(null, { status: 202 })
        }

        if (path === '/signup-change' && request.method === 'POST') {
            if (!env.SYNC_TOKEN || request.headers.get('authorization') !== `Bearer ${env.SYNC_TOKEN}`) {
                return new Response('Unauthorized', { status: 401 })
            }
            const change = await request.json() as SignupChange
            if (!change.groupId || !change.eventId || !change.occurrence || !change.sheetId) {
                return new Response('Invalid change', { status: 400 })
            }
            await bindings.JOBS.send({ kind: 'signup', change, enqueuedAt: Date.now() })
            return new Response(null, { status: 202 })
        }

        return new Response('Not found', { status: 404 })
    },

    async scheduled(_event: ScheduledController, bindings: WorkerEnv, ctx: ExecutionContext) {
        configured(bindings)
        ctx.waitUntil((async () => {
            const due = await api.dueStrict()
            let enqueued = 0
            try {
                for (let start = 0; start < due.length; start += 100) {
                    const batch = due.slice(start, start + 100)
                    await bindings.JOBS.sendBatch(batch.map((action) => ({ body: { kind: 'due', action, enqueuedAt: Date.now() } })))
                    enqueued += batch.length
                }
            } catch (error) {
                await Promise.allSettled(due.slice(enqueued).map((action) => api.releaseDue(action)))
                throw error
            }
            const enabled = await api.boardGuilds()
            const active = await state.trackedManifests(enabled.map((guild) => guild.guildId))
            await sendJobs(bindings.JOBS, enabled
                .filter((guild) => active.has(guild.guildId) &&
                    boardRefreshDue(active.get(guild.guildId)?.checkedAt, guild.manifestRefreshSeconds))
                .map((guild) => ({ kind: 'board', guildId: guild.guildId, enqueuedAt: Date.now() })))
        })())
    },

    async queue(batch: MessageBatch<BotJob>, bindings: WorkerEnv) {
        configured(bindings)
        const client = createRestClient()
        for (const group of coalesceJobs(batch.messages)) {
            const message = group[0]!
            const job = message.body
            try {
                await timed('job', { kind: job.kind, count: group.length,
                    command: job.kind === 'interaction' ? job.payload.data?.name : undefined,
                    queueWaitMs: job.enqueuedAt ? Date.now() - job.enqueuedAt : undefined }, async () => {
                    if (job.kind === 'signup') {
                        await sync(group.map((item) => (item.body as Extract<BotJob, { kind: 'signup' }>).change), client)
                    } else if (job.kind === 'due') {
                        await state.withGuildLock(job.action.guildId, () => processDueAction(client, job.action))
                    } else if (job.kind === 'interaction') {
                        const run = async () => {
                            const { run } = await runInteraction(job.payload, true)
                            await run
                        }
                        if (job.payload.guild_id) await state.withGuildLock(job.payload.guild_id, run)
                        else await run()
                    } else {
                        await state.withGuildLock(job.guildId, async () => {
                            const guild = await api.guildStrict(job.guildId)
                            if (guild) await refreshBoard(client, guild)
                        })
                    }
                })
                for (const item of group) item.ack()
            } catch (error) {
                if (error instanceof JobBusyError && (!job.enqueuedAt || Date.now() - job.enqueuedAt < 900_000)) {
                    const queue = job.kind === 'interaction' ? bindings.INTERACTIONS : bindings.JOBS
                    try {
                        await queue.send(job, { delaySeconds: error.retryAfterSeconds })
                        for (const item of group.slice(1)) await queue.send(item.body, { delaySeconds: error.retryAfterSeconds })
                        for (const item of group) item.ack()
                        continue
                    } catch (enqueueError) { console.error('could not reschedule busy job', enqueueError) }
                }
                console.error('bot job failed', job.kind, error)
                const delaySeconds = error instanceof JobBusyError ? error.retryAfterSeconds
                    : error instanceof ApiError && error.status === 429
                        ? Math.max(20, Math.min(error.retryAfterSeconds ?? 60, 900)) : 20
                for (const item of group) item.retry({ delaySeconds })
            }
        }
    }
} satisfies ExportedHandler<WorkerEnv, BotJob>
