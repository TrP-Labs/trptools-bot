import { verifyKey } from 'discord-interactions'
import { api, type DueAction } from '../api'
import { commands } from '../commands'
import { assertEnv, configureEnv, env, type BotEnv } from '../env'
import { processDueAction, refreshBoard } from '../features/automation'
import { refreshSheet } from '../features/signups'
import { handler as signup } from '../interactions/signup'
import { handler as editShift } from '../interactions/edit-shift'
import { englishOnly, reply } from '../discord/registry'
import { createInteraction } from './interaction'
import { createRestClient } from './restClient'

type SignupChange = { groupId: string; eventId: string; occurrence: string; sheetId: string }
type BotJob =
    | { kind: 'signup'; change: SignupChange }
    | { kind: 'due'; action: DueAction }
    | { kind: 'board'; guildId: string }
    | { kind: 'interaction'; payload: any }

type WorkerEnv = BotEnv & { JOBS: Queue<BotJob> }

async function sendJobs(queue: Queue<BotJob>, jobs: BotJob[]) {
    for (let start = 0; start < jobs.length; start += 100) {
        await queue.sendBatch(jobs.slice(start, start + 100).map((body) => ({ body })))
    }
}

async function runInteraction(raw: any, initiallyDeferred = false) {
    const client = createRestClient()
    const { interaction, acknowledged, isAcknowledged, isAcknowledging } = createInteraction(raw, undefined, initiallyDeferred)
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
                const guild = await api.guild(interaction.guildId)
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
            console.error('interaction failed', error)
            if (interaction.isRepliable()) {
                try { await interaction.reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 }) }
                catch (replyError) { console.error('failure reply failed', replyError) }
            }
        }
    })()

    return { run, acknowledged, isAcknowledged, isAcknowledging, interaction }
}

async function sync(change: SignupChange) {
    const guilds = await api.guildsStrict()
    const guild = guilds.find((candidate) => candidate.groupId === change.groupId)
    if (!guild) return
    await refreshSheet(createRestClient(), guild.guildId, change.eventId, change.occurrence, change.sheetId)
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
                const { interaction } = createInteraction(payload)
                if (!interaction.isChatInputCommand()) throw new Error('Expected slash command')
                await interaction.deferReply(payload.data.name === 'status' ? { flags: 64 } : undefined)
                try {
                    await bindings.JOBS.send({ kind: 'interaction', payload })
                } catch (error) {
                    console.error('could not queue interaction', error)
                    await interaction.editReply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))] })
                }
                return new Response(null, { status: 202 })
            }
            const { run, acknowledged, isAcknowledged, isAcknowledging, interaction } = await runInteraction(payload)
            ctx.waitUntil(run)
            await Promise.race([acknowledged, run, new Promise((resolve) => setTimeout(resolve, 2400))])
            if (!isAcknowledged() && !isAcknowledging()) {
                await (interaction as any).reply({ embeds: [reply(englishOnly).error(englishOnly.text('bot_common_unhandled'))], flags: 64 })
            }
            return new Response(null, { status: 202 })
        }

        if (path === '/signup-change' && request.method === 'POST') {
            if (!env.SYNC_TOKEN || request.headers.get('authorization') !== `Bearer ${env.SYNC_TOKEN}`) {
                return new Response('Unauthorized', { status: 401 })
            }
            const change = await request.json() as SignupChange
            if (!change.groupId || !change.eventId || !change.occurrence || !change.sheetId) {
                return new Response('Invalid change', { status: 400 })
            }
            await bindings.JOBS.send({ kind: 'signup', change })
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
                    await bindings.JOBS.sendBatch(batch.map((action) => ({ body: { kind: 'due', action } })))
                    enqueued += batch.length
                }
            } catch (error) {
                await Promise.allSettled(due.slice(enqueued).map((action) => api.releaseDue(action)))
                throw error
            }
            const guilds = await api.guildsStrict()
            await sendJobs(bindings.JOBS, guilds
                .filter((guild) => guild.config.manifestEnabled)
                .map((guild) => ({ kind: 'board', guildId: guild.guildId })))
        })())
    },

    async queue(batch: MessageBatch<BotJob>, bindings: WorkerEnv) {
        configured(bindings)
        const client = createRestClient()
        for (const message of batch.messages) {
            try {
                const job = message.body
                if (job.kind === 'signup') await sync(job.change)
                else if (job.kind === 'due') await processDueAction(client, job.action)
                else if (job.kind === 'interaction') {
                    const { run } = await runInteraction(job.payload, true)
                    await run
                }
                else {
                    const guild = await api.guildStrict(job.guildId)
                    if (guild) await refreshBoard(client, guild)
                }
                message.ack()
            } catch (error) {
                console.error('bot job failed', message.body.kind, error)
                message.retry({ delaySeconds: 20 })
            }
        }
    }
} satisfies ExportedHandler<WorkerEnv, BotJob>
