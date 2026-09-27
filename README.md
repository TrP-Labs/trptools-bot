# trptools-bot

The optional Discord bot for TrPTools: shift announcements, sign-up sheets, and live dispatch images. Groups configure it from their dashboard; it talks to the API through a shared service token.

## Development

1. Run `cp .env.example .env && bun install --frozen-lockfile`.
2. Set `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `API_URL`, and `BOT_SERVICE_TOKEN`.
3. Set `DEV_GUILD_ID` for instant command updates in a test server.
4. Run `bun run dev`.

The bot registers slash commands at startup; `bun run deploy-commands` refreshes them manually. Redis keeps message IDs and receives website sign-up updates.

## Docker

1. Follow [trptools-deploy](https://github.com/TrP-Labs/trptools-deploy) and fill in its Discord settings.
2. Run `docker compose --profile bot up -d` when ready.

The API and bot must share `BOT_SERVICE_TOKEN` and Discord app credentials. Register `<BASE_URL>/bot/callback` and `<BASE_URL>/auth/discord/callback` as Discord OAuth redirects.

## Cloudflare Workers

1. Run `bun install --frozen-lockfile` and update the Worker name and domain in `wrangler.jsonc`.
2. Create queues with `bunx wrangler queues create NAME` for `trptools-bot-jobs`, `trptools-bot-interactions`, and `trptools-bot-dead`.
3. Add Worker secrets `DISCORD_APP_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `API_URL`, `BOT_SERVICE_TOKEN`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `SYNC_TOKEN`.
4. Disable cron initially with `triggers.crons: []`, then run `bun run worker:check`.
5. Run `bun run worker:deploy` when ready and register `<Worker origin>/interactions` in Discord.
6. Stop the Gateway/Docker bot, then run `bun run deploy-commands` with your Discord credentials.
7. Set the API's `BOT_WORKER_URL` and `BOT_WORKER_SYNC_TOKEN` (matching `SYNC_TOKEN`), then enable the one-minute cron.

Use `bunx wrangler secret put NAME` for each secret; `.dev.vars` supplies local Worker secrets. Keep all Discord credentials from the same application, and keep `BOT_SERVICE_TOKEN` identical on the API and bot.

The **Deploy Cloudflare Worker** GitHub workflow is manual and uses Cloudflare credentials from its `production` environment. For Cloudflare Builds, use `bun install --frozen-lockfile` as the build command and `bun run worker:deploy` as the deploy command; create queues and configure Worker secrets first.

## Checks

1. Run `bun run typecheck && bun run test && bun run worker:check`.
2. Use `/ping` in Discord to check the running bot and API connection.

Worker jobs use separate queues for maintenance and interactions; Upstash stores their shared state. MIT — see [LICENSE](./LICENSE).
