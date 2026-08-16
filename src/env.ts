/**
 * A missing variable is a configuration mistake, not a crash.
 *
 * The bot cannot do anything useful without any of these, so it stops — but a
 * bare "Missing BOT_SERVICE_TOKEN" tells whoever is deploying nothing about
 * what the value is or where it comes from, which is exactly when they need
 * it. Each one explains itself and the process exits without a stack trace.
 */
function required(name: string, hint: string): string {
    const value = process.env[name]

    if (!value) {
        console.error(`\ntrptools-bot cannot start: ${name} is not set.\n\n  ${hint}\n`)
        process.exit(1)
    }

    return value
}

function optional(name: string, fallback: string): string {
    return process.env[name] || fallback
}

function stripTrailingSlash(value: string) {
    return value.endsWith('/') ? value.slice(0, -1) : value
}

export const env = {
    NODE_ENV: optional('NODE_ENV', 'development'),

    DISCORD_APP_ID: required(
        'DISCORD_APP_ID',
        'The application id from https://discord.com/developers/applications — the same one the API uses.'
    ),
    DISCORD_BOT_TOKEN: required(
        'DISCORD_BOT_TOKEN',
        'The bot token from that application\'s Bot tab. It is not the client secret, and cannot be derived from it.'
    ),

    /**
     * Where the API lives from the bot's point of view.
     *
     * On a container network this is the service name, not the public URL —
     * the same distinction the frontend draws between its two API URLs.
     */
    API_URL: stripTrailingSlash(optional('API_URL', 'http://localhost:3001')),

    /** The shared secret the API's `/bot/internal/*` routes expect. */
    BOT_SERVICE_TOKEN: required(
        'BOT_SERVICE_TOKEN',
        'A secret you invent, shared with the API — not a Discord credential. The bot acts for every group\n' +
            '  at once, which no per-user API key can express, so it authenticates as a service.\n' +
            '  Generate one with: openssl rand -hex 32\n' +
            '  Then set the same value on both this process and the API.'
    ),

    /**
     * Only needed for live sign-up sync. Without it the bot still works; its
     * Discord sheets simply do not update until the next time it edits them.
     */
    REDIS_URL: optional('REDIS_URL', ''),

    /**
     * Registering commands to one guild takes effect instantly, where global
     * commands can take an hour to propagate. Set this while developing.
     */
    DEV_GUILD_ID: optional('DEV_GUILD_ID', ''),

    /** How often to ask the API what automated actions are due. */
    SCHEDULER_INTERVAL_SECONDS: Number(optional('SCHEDULER_INTERVAL_SECONDS', '30'))
}
