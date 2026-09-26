import { expect, test } from 'bun:test'
import { coalesceJobs } from './jobs'

const change = { groupId: 'g', eventId: 'e', occurrence: '2026-09-26T12:00:00.123Z' }
const signup = (sheetId: string, occurrence = change.occurrence) => ({ body: { kind: 'signup', change: { ...change, sheetId, occurrence } } })

test('a burst across sheets reads one occurrence without dropping acknowledgments', () => {
    const messages = [signup('a'), signup('b'), signup('a'), signup('c', '2026-09-26T12:00:00.124Z')]
    const groups = coalesceJobs(messages)
    expect(groups).toEqual([messages.slice(0, 3), [messages[3]]])
    expect(groups.flat()).toHaveLength(messages.length)
})

test('scheduled actions remain ordering barriers for refresh coalescing', () => {
    const messages = [signup('a'), { body: { kind: 'due' } }, signup('a')]
    expect(coalesceJobs(messages)).toEqual(messages.map((message) => [message]))
})
