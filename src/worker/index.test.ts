import { expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import worker from './index'
import type { BotEnv } from '../env'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const bindings: BotEnv & { JOBS: Queue<any> } = {
    DISCORD_APP_ID: '123',
    DISCORD_BOT_TOKEN: 'test-token',
    DISCORD_PUBLIC_KEY: Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('hex'),
    API_URL: 'https://example.invalid',
    BOT_SERVICE_TOKEN: 'test-service-token',
    UPSTASH_REDIS_REST_URL: 'https://example.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
    SYNC_TOKEN: 'test-sync-token',
    JOBS: {} as Queue<any>
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
    expect(jobs).toEqual([{ kind: 'signup', change: JSON.parse(body) }])
})
