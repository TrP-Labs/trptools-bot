# syntax=docker/dockerfile:1

# Dependencies are installed in their own stage so a source-only change does
# not invalidate the install layer.
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Never run as root.
USER bun

# No port and no healthcheck: the bot listens on nothing. It holds an outbound
# gateway connection, so "is it up" is a question only Discord can answer —
# `/ping` in the server is the check that means anything.
CMD ["bun", "run", "src/index.ts"]
