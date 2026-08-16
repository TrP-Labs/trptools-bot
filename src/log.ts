/**
 * Logging, kept deliberately plain.
 *
 * The bot runs unattended and its failures are almost always "Discord said
 * no" or "the API was unreachable", so what matters is that the guild and the
 * action are always visible in the line.
 */
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, scope: string, message: string, detail?: unknown) {
    const line = `[${new Date().toISOString()}] [${scope}] ${message}`

    if (level === 'error') console.error(line, detail ?? '')
    else if (level === 'warn') console.warn(line, detail ?? '')
    else console.log(line, detail ?? '')
}

export const log = {
    info: (scope: string, message: string, detail?: unknown) => emit('info', scope, message, detail),
    warn: (scope: string, message: string, detail?: unknown) => emit('warn', scope, message, detail),
    error: (scope: string, message: string, detail?: unknown) => {
        emit('error', scope, message, detail instanceof Error ? detail.message : detail)
    }
}
