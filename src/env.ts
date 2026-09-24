/** Runtime configuration shared by Bun and request-driven Worker handlers. */
export interface BotEnv {
    DISCORD_APP_ID: string
    DISCORD_BOT_TOKEN: string
    DISCORD_PUBLIC_KEY?: string
    API_URL: string
    BOT_SERVICE_TOKEN: string
    UPSTASH_REDIS_REST_URL?: string
    UPSTASH_REDIS_REST_TOKEN?: string
    REDIS_URL?: string
    DEV_GUILD_ID?: string
    NODE_ENV?: string
    SCHEDULER_INTERVAL_SECONDS?: string
    SYNC_TOKEN?: string
}

let bindings: BotEnv | null = null

export function configureEnv(value: BotEnv) {
    bindings = value
}

function read(name: keyof BotEnv, fallback = ''): string {
    return bindings?.[name] ?? process.env[name] ?? fallback
}

export const env = {
    get NODE_ENV() { return read('NODE_ENV', 'development') },
    get DISCORD_APP_ID() { return read('DISCORD_APP_ID') },
    get DISCORD_BOT_TOKEN() { return read('DISCORD_BOT_TOKEN') },
    get DISCORD_PUBLIC_KEY() { return read('DISCORD_PUBLIC_KEY') },
    get API_URL() { return read('API_URL', 'http://localhost:3001').replace(/\/$/, '') },
    get BOT_SERVICE_TOKEN() { return read('BOT_SERVICE_TOKEN') },
    get UPSTASH_REDIS_REST_URL() { return read('UPSTASH_REDIS_REST_URL') },
    get UPSTASH_REDIS_REST_TOKEN() { return read('UPSTASH_REDIS_REST_TOKEN') },
    get REDIS_URL() { return read('REDIS_URL') },
    get DEV_GUILD_ID() { return read('DEV_GUILD_ID') },
    get SYNC_TOKEN() { return read('SYNC_TOKEN') },
    get SCHEDULER_INTERVAL_SECONDS() { return Number(read('SCHEDULER_INTERVAL_SECONDS', '30')) }
}

export function assertEnv(keys: Array<keyof BotEnv>) {
    for (const key of keys) if (!read(key)) throw new Error(`Missing ${key}`)
}
