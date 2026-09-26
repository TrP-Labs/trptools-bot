type RefreshJob = { kind: string; change?: { groupId: string; eventId: string; occurrence: string }; guildId?: string }

/** Changes in one delivery batch read the latest occurrence once. */
export function coalesceJobs<T extends { body: RefreshJob }>(messages: readonly T[]): T[][] {
    const groups: T[][] = []
    const refreshes = new Map<string, T[]>()
    for (const message of messages) {
        const job = message.body
        const key = job.kind === 'signup' && job.change
            ? JSON.stringify(['signup', job.change.groupId, job.change.eventId, job.change.occurrence])
            : job.kind === 'board' ? JSON.stringify(['board', job.guildId]) : null
        if (!key) {
            // A scheduled action is an ordering barrier: don't combine a
            // redraw before /complete with one that arrived after it.
            refreshes.clear()
            groups.push([message])
            continue
        }
        const existing = refreshes.get(key)
        if (existing) existing.push(message)
        else {
            const group = [message]
            refreshes.set(key, group)
            groups.push(group)
        }
    }
    return groups
}
