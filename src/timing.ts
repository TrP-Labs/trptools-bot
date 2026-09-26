export async function timed<T>(scope: string, detail: Record<string, unknown>, run: () => Promise<T>): Promise<T> {
    const start = performance.now()
    let ok = false
    try {
        const result = await run()
        ok = true
        return result
    } finally {
        console.log(JSON.stringify({ scope, ...detail, durationMs: Math.round(performance.now() - start), ok }))
    }
}
