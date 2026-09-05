# trptools-bot

The Discord half of [TrP Tools 2.0](https://github.com/TrP-Labs). It announces shifts,
collects staff sign-ups, runs the post-shift poll and posts a live picture of
the dispatch board.

Every group configures it **from the TrP Tools dashboard**, not from a file.
The 2025 bot read a per-server TOML file it shipped with, which meant adding a
group needed a code change and a deploy; nothing here is configured on disk.

## How it fits together

```
   trptools-frontend ──┐
                       ├── trptools-backend ──┬── Postgres
   trptools-bot ───────┘      (the API)       └── Redis ──┐
        │                                                 │
        └────────── subscribes for live sign-ups ─────────┘
```

The bot never touches the database. It reads and writes through
`/bot/internal/*` on the API, authenticating with a **service token** rather
than a user's API key — it acts for every group at once, which no per-user
credential can express.

Two things are deliberately *not* the bot's job:

- **Deciding what is due.** The API owns the recurrence rules and the
  automation settings, so it works out which actions should fire and hands each
  one out exactly once. A restarted bot cannot replay yesterday's
  announcements, and two bots cannot double-post.
- **Drawing the dispatch board.** The API already holds the room state, the
  routes and their colours. It renders the picture; the bot attaches it.

## Commands

| Command | What it does |
| --- | --- |
| `/ping` | Latency to Discord, and whether TrP Tools is reachable. The only command that works on an unconfigured server. |
| `/status` | What this server is set up to do, and what is coming up. |
| `/announce` | Announce the next scheduled shift. |
| `/signups` | Post the staff sign-up sheets for the next shift. |
| `/staff-begin` | Give the staff who signed up the join code, ahead of the public announcement. |
| `/begin` | Announce publicly that the shift is starting, and post the dispatch board. |
| `/complete` | Clear the sheets this shift posted and ask how it went. |
| `/edit-shift` | Set the note and private-server owner for the next shift. |

Each of these can also run on its own — see **Automation** below. Turning
automation on never removes the command.

## Sign-up sheets

Sheets belong to **Roblox ranks**, not to individual shifts. A group defines one
per rank on the dashboard's Ranks page, and it applies to every shift they run.

A sheet is posted into its rank's own channel with a select menu. Picking a slot
takes it, picking it again gives it up, and picking a different one moves you.
Sign-ups made on the website appear in the Discord message within seconds, and
the other way round — both halves are the same rows in the same table.

Signing up earns **early access**: `/staff-begin` sends the join code to the
people who claimed a slot, in their own sheet's channel, before `/begin`
announces the shift to everyone. That is the point of the sheet — dispatchers
and maintenance are meant to be in position before the public arrives — so the
public announcement never pings sign-ups.

Somebody who signs up from Discord **does not need a TrP Tools account**. The
sheet already lives in a channel their Discord role gates, so demanding they
register first would make the Discord half useless. If they later link a Discord
account to their TrP Tools one, both halves show them as one person.

## Languages

A group picks an **ordered list of languages** on the dashboard's Bot page, and
every message the bot sends is rendered in all of them at once — a title comes
out as `Upcoming shift / Наступна зміна`, a description as one stanza per
language. One message rather than one per language: several would double the
pings, double the end-of-shift cleanup, and put the same sign-up sheet in a
channel twice, while a reader would still have to find their own copy.

Three things are deliberately not rendered that way:

- **Slash-command descriptions.** Discord shows these in each reader's own
  client language and knows nothing about a server's list, so the translations
  are handed to Discord instead (`src/i18n/command.ts`) and everybody gets one
  language — theirs. The command *names* stay English: they are what people
  type, and a translated `/begin` would make every guide to the bot wrong.
- **The `/edit-shift` form and the satisfaction poll.** Discord caps a modal
  label at 45 characters and a poll answer at 55. Four languages in one label
  leaves all four cut off, which serves nobody better than the group's first
  language does.
- **Anything the group wrote themselves** — shift names, notes, sheet
  descriptions. Those are their words in their language, and the bot has no
  business restating them.

Strings live in [TrP-Labs/Locales](https://github.com/TrP-Labs/Locales) as
`locales/<lang>/bot.jsonc`, alongside the website's. Bring translations in and
ship a language with:

```bash
./scripts/pull-locales.sh          # writes messages/<lang>.json
# then import the new locale in src/i18n/catalog.ts and commit both
```

That second step is the switch: a language is pulled whenever Crowdin has
anything for it, and *shipped* only once somebody decides the translation is
complete enough. A key nobody has translated falls back to English on its own,
so a partial language is safe — and a language that renders identically to one
already in the list is collapsed rather than printed twice.

## Automation

Every action can fire on its own, with its own lead time, set per group in the
dashboard:

| Action | Measured from |
| --- | --- |
| Announce upcoming | before the start |
| Post sign-up sheets | before the start |
| Remind the host | before the start |
| Let staff in | before the start |
| Announce the start | before the start |
| Close the shift out | after the end |

An action that Discord refuses is handed back to the API, so the next poll
retries it rather than the shift silently losing its announcement. An action
more than ten minutes late is dropped — a bot that was down for two minutes
should still announce a shift, one that was down for a day should not.

## Running it

```bash
bun install
cp .env.example .env        # fill in the Discord and service credentials
bun run dev
```

The bot **registers its slash commands on every start**, so a deployment needs
no second step. `bun run deploy-commands` does the same thing without a restart.

`DEV_GUILD_ID` registers the commands to one server, where they appear at once.
Without it they register globally and can take an hour to propagate — long
enough to convince you the bot is broken. Whichever scope is used, the other is
cleared: Discord shows the union of both, so a command left in the unused scope
would still be offered with nothing to answer it.

The API needs `DISCORD_APP_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` and
the same `BOT_SERVICE_TOKEN`, and the Discord application needs
`<BASE_URL>/bot/callback` in its OAuth2 redirect URIs — without that, the
dashboard's "Add to Discord" button is refused by Discord.

## Intents

Only `Guilds`. The bot never reads message content, tracks members or watches
presence; everything it acts on arrives as an interaction, which needs no
privileged intent at all.

## Redis

Optional, strongly recommended. It holds the mapping from a shift occurrence to
the messages posted for it, which is what lets a sheet be edited later and
cleared at the end. Without it the bot still posts sheets and still handles
clicks; it just cannot find its own messages again.

It is also how live sign-up sync arrives — the API publishes on `bot.signup`
and the bot redraws the one sheet that changed.

## Tests

```bash
bun test src
```

Covers custom-id encoding, which carries a component's entire state in the 100
characters Discord allows and has no other safety net; the settings rules that
decide what gets cleared and what gets pinged; and the multi-language renderer,
where every rule is one that fails quietly when it is backwards.

Nothing in the test tree imports `src/env.ts`, which validates the environment
at import time and exits — tests would pass locally and take CI down with it.

## Deploying

Images are published to `ghcr.io/trp-labs/trptools-bot` for `linux/amd64` and
`linux/arm64` on every push to `main` and every release tag.

[trptools-deploy](https://github.com/TrP-Labs/trptools-deploy) runs it alongside
the rest of a TrP Tools instance:

```bash
docker compose --profile bot up -d
```

The bot is optional — nothing else depends on it, and an instance without one
simply has no server to connect.

## License

MIT — see [LICENSE](./LICENSE).
