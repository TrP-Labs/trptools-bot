import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const key = Buffer.from(
    publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
).toString('hex')
const port = 25000 + Math.floor(Math.random() * 15000),
    origin = `http://127.0.0.1:${port}`
const worker = Bun.spawn(
    [
        './node_modules/.bin/wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        String(port + 10000),
        '--var',
        `DISCORD_PUBLIC_KEY:${key}`,
        '--var',
        'DISCORD_APP_ID:123',
        '--var',
        'DISCORD_BOT_TOKEN:local-smoke-only',
        '--var',
        'API_URL:http://127.0.0.1:9',
        '--var',
        'BOT_SERVICE_TOKEN:local-smoke-only',
        '--var',
        'UPSTASH_REDIS_REST_URL:http://127.0.0.1:9',
        '--var',
        'UPSTASH_REDIS_REST_TOKEN:local-smoke-only',
        '--var',
        'SYNC_TOKEN:local-smoke-only',
    ],
    {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: {
            ...process.env,
            CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
            WRANGLER_LOG_PATH: '/tmp/trptools-bot-worker-smoke.log',
        },
        stdout: 'ignore',
        stderr: 'inherit',
    },
)
try {
    const body = JSON.stringify({ type: 1 }),
        timestamp = String(Math.floor(Date.now() / 1000)),
        signature = sign(
            null,
            Buffer.from(timestamp + body),
            privateKey,
        ).toString('hex')
    const deadline = Date.now() + 30000
    let ready = false
    while (Date.now() < deadline) {
        try {
            const response = await fetch(origin + '/interactions', {
                method: 'POST',
                headers: {
                    'x-signature-timestamp': timestamp,
                    'x-signature-ed25519': signature,
                },
                body,
            })
            assert.equal(response.status, 200)
            assert.deepEqual(await response.json(), { type: 1 })
            ready = true
            break
        } catch {
            if (worker.exitCode !== null)
                throw new Error('Worker exited before readiness')
            await Bun.sleep(100)
        }
    }
    assert.ok(ready, 'Local bot Worker did not answer its signed PING')
    const invalid = await fetch(origin + '/interactions', {
        method: 'POST',
        headers: {
            'x-signature-timestamp': timestamp,
            'x-signature-ed25519': '00'.repeat(64),
        },
        body,
    })
    assert.equal(invalid.status, 401)
    console.log(
        'Bot workerd smoke passed: valid signed Discord PING accepted; forged signature refused; no messages sent',
    )
} finally {
    worker.kill()
    await worker.exited
}
