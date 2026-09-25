import { afterEach, expect, test } from 'bun:test'
import { api, ApiError, retryAfterSeconds } from './api'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

test('Retry-After accepts seconds and HTTP dates', () => {
    expect(retryAfterSeconds('3.1')).toBe(4)
    expect(retryAfterSeconds('Wed, 24 Sep 2026 00:01:00 GMT', Date.parse('2026-09-24T00:00:00Z'))).toBe(60)
    expect(retryAfterSeconds(null)).toBeNull()
})

test('a rate-limited guild read is an error, not a missing guild', async () => {
    globalThis.fetch = (async () => new Response('Too Many Requests', {
        status: 429, headers: { 'Retry-After': '42' }
    })) as unknown as typeof fetch
    try {
        await api.guild('test')
        throw new Error('expected API failure')
    } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(429)
        expect((error as ApiError).retryAfterSeconds).toBe(42)
    }
})

test('a 404 guild read still means the guild is missing', async () => {
    globalThis.fetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch
    expect(await api.guild('test')).toBeNull()
})

test('due completion parses Elysia plain-text booleans', async () => {
    const action = {
        guildId: 'guild', groupId: 'group', action: 'HOST_REMINDER' as const,
        eventId: 'event', occurrence: '2026-09-25T12:00:00.000Z'
    }
    globalThis.fetch = (async () => new Response('false', {
        headers: { 'content-type': 'text/plain' }
    })) as unknown as typeof fetch
    expect(await api.dueCompleted(action)).toBe(false)

    globalThis.fetch = (async () => new Response('true', {
        headers: { 'content-type': 'text/plain' }
    })) as unknown as typeof fetch
    expect(await api.dueCompleted(action)).toBe(true)
})
