import { expect, test } from 'bun:test'
import { redisHash } from './redisHash'

test('decodes raw Upstash HGETALL entries for message cleanup', () => {
    expect(redisHash(['sheet:one', 'channel:message', 'announcement', 'other:post'])).toEqual({
        'sheet:one': 'channel:message', announcement: 'other:post'
    })
})
