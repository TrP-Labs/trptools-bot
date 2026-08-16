function required(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`Missing required environment variable: ${name}`)
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

    DISCORD_APP_ID: required('DISCORD_APP_ID'),
    DISCORD_BOT_TOKEN: required('DISCORD_BOT_TOKEN'),

    /**
     * Where the API lives from the bot's point of view.
     *
     * On a container network this is the service name, not the public URL —
     * the same distinction the frontend draws between its two API URLs.
     */
    API_URL: stripTrailingSlash(optional('API_URL', 'http://localhost:3001')),

    /** The shared secret the API's `/bot/internal/*` routes expect. */
    BOT_SERVICE_TOKEN: required('BOT_SERVICE_TOKEN'),

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
