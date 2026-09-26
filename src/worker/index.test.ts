import { expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import worker from './index'
import type { BotEnv } from '../env'
import { api, ApiError, type Guild } from '../api'
import { state } from '../state'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const bindings: BotEnv & { JOBS: Queue<any>; INTERACTIONS: Queue<any> } = {
    DISCORD_APP_ID: '123',
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_PUBLIC_KEY: Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('hex'),
    API_URL: 'https://example.invalid',
    BOT_SERVICE_TOKEN: 'test-service-token',
    UPSTASH_REDIS_REST_URL: 'https://example.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
    SYNC_TOKEN: 'test-sync-token',
    JOBS: {} as Queue<any>,
    INTERACTIONS: {} as Queue<any>
}
const context = { waitUntil() {} } as unknown as ExecutionContext

test('Discord PING is answered only after raw-body signature verification', async () => {
    const body = JSON.stringify({ type: 1 })
    const timestamp = '1780000000'
    const signature = Buffer.from(sign(null, Buffer.from(timestamp + body), privateKey)).toString('hex')
    const request = (value: string) => new Request('https://bot.example/interactions', {
        method: 'POST',
        headers: {
            'x-signature-timestamp': timestamp,
            'x-signature-ed25519': value
        },
        body
    })

    const valid = await worker.fetch(request(signature), bindings, context)
    expect(valid.status).toBe(200)
    expect(await valid.text()).toBe('{"type":1}')

    const invalid = await worker.fetch(request('00'.repeat(64)), bindings, context)
    expect(invalid.status).toBe(401)
})

function signedCommand(name: string) {
    const body = JSON.stringify({ type: 2, id: '123456789012345678', token: 'test-interaction', guild_id: 'g', data: { name } })
    const timestamp = '1780000000'
    return new Request('https://bot.example/interactions', {
        method: 'POST', body,
        headers: { 'x-signature-timestamp': timestamp,
            'x-signature-ed25519': Buffer.from(sign(null, Buffer.from(timestamp + body), privateKey)).toString('hex') }
    })
}

test('slash commands enter the interactive queue and defer directly over HTTP', async () => {
    const jobs: unknown[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => { throw new Error('Deferral made an outbound request') }) as unknown as typeof fetch
    bindings.INTERACTIONS = { send: async (job: unknown) => { jobs.push(job) } } as unknown as Queue<any>
    try {
        const response = await worker.fetch(signedCommand('status'), bindings, context)
        expect(response.status).toBe(200)
        expect(await response.json() as { type: number; data: { flags: number } }).toEqual({ type: 5, data: { flags: 64 } })
        expect(jobs).toEqual([expect.objectContaining({ kind: 'interaction', enqueuedAt: expect.any(Number) })])
    } finally { globalThis.fetch = originalFetch }
})

test('a failed queue submission returns an immediate error instead of an orphaned deferral', async () => {
    bindings.INTERACTIONS = { send: async () => { throw new Error('Queue unavailable') } } as unknown as Queue<any>
    const response = await worker.fetch(signedCommand('announce'), bindings, context)
    expect(await response.json()).toMatchObject({ type: 4, data: { flags: 64 } })
})

test('maintenance batches share the targeted guild and retry every coalesced change on failure', async () => {
    const originalApi = { ...api }
    const originalState = { ...state }
    let guildReads = 0
    let occurrenceReads = 0
    const outcomes: string[] = []
    let fail = false
    api.guildForGroup = async () => { guildReads++; return { guildId: 'g' } as Guild }
    api.guildStrict = async () => { throw new Error('Repeated guild read') }
    api.occurrenceStrict = async () => {
        occurrenceReads++
        if (fail) throw new ApiError(429, '/occurrence', 42)
        return { shift: {} as any, sheets: [] }
    }
    state.withGuildLock = async (_id, run) => run()
    state.allFor = async () => []
    const messages = [1, 2, 3].map((id) => ({
        body: { kind: 'signup' as const, change: { groupId: 'group', eventId: 'event', occurrence: '2026-09-26T00:00:00.123Z', sheetId: 'sheet' } },
        ack: () => { outcomes.push(`ack:${id}`) }, retry: (options: { delaySeconds: number }) => { outcomes.push(`retry:${id}:${options.delaySeconds}`) }
    }))
    try {
        await worker.queue({ messages } as unknown as MessageBatch<any>, bindings)
        expect(guildReads).toBe(1)
        expect(occurrenceReads).toBe(1)
        expect(outcomes).toEqual(['ack:1', 'ack:2', 'ack:3'])
        outcomes.length = 0
        fail = true
        await worker.queue({ messages } as unknown as MessageBatch<any>, bindings)
        expect(outcomes).toEqual(['retry:1:42', 'retry:2:42', 'retry:3:42'])
    } finally { Object.assign(api, originalApi); Object.assign(state, originalState) }
})

test('cron skips enabled boards until their configured refresh interval', async () => {
    const originalApi = { ...api }
    const originalState = { ...state }
    const pending: Promise<unknown>[] = []
    const queued: unknown[] = []
    api.dueStrict = async () => []
    api.boardGuilds = async () => [{ guildId: 'g', manifestRefreshSeconds: 300 }, { guildId: 'idle', manifestRefreshSeconds: 60 }]
    api.guildsStrict = async () => { throw new Error('Cron loaded full guild descriptions') }
    state.trackedManifests = async () => new Map([['g', { eventId: 'e', occurrence: '2026-09-26T00:00:00Z', checkedAt: Date.now() }]])
    bindings.JOBS = { sendBatch: async (jobs: unknown[]) => { queued.push(...jobs) } } as unknown as Queue<any>
    try {
        await worker.scheduled({} as ScheduledController, bindings, { waitUntil: (promise: Promise<unknown>) => { pending.push(promise) } } as ExecutionContext)
        await Promise.all(pending)
        expect(queued).toHaveLength(0)
    } finally { Object.assign(api, originalApi); Object.assign(state, originalState) }
})

test('website sign-up changes require the sync secret and enter the queue', async () => {
    const jobs: unknown[] = []
    bindings.JOBS = { send: async (job: unknown) => { jobs.push(job) } } as unknown as Queue<any>
    const body = JSON.stringify({ groupId: 'g', eventId: 'e', occurrence: '2026-09-22T00:00:00.000Z', sheetId: 's' })
    const request = (token: string) => new Request('https://bot.example/signup-change', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body
    })

    expect((await worker.fetch(request('wrong'), bindings, context)).status).toBe(401)
    expect(jobs).toHaveLength(0)
    expect((await worker.fetch(request('test-sync-token'), bindings, context)).status).toBe(202)
    expect(jobs).toEqual([{ kind: 'signup', change: JSON.parse(body), enqueuedAt: expect.any(Number) }])
})
