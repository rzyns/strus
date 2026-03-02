# syntax=docker/dockerfile:1

# ─── Stage 1: pnpm install (Node) + web frontend build ───────────────────────
FROM node:22-slim AS web-build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm

WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api/package.json     packages/api/
COPY packages/cli/package.json     packages/cli/
COPY packages/config/package.json  packages/config/
COPY packages/core/package.json    packages/core/
COPY packages/db/package.json      packages/db/
COPY packages/morph/package.json   packages/morph/
COPY packages/web/package.json     packages/web/

# --ignore-scripts defers Panda CSS prepare until source files are present
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod=false --ignore-scripts

# tsconfig.base.json must be present at root for packages/web/tsconfig.json to extend it
COPY tsconfig.base.json  ./
COPY packages/web/       packages/web/
COPY packages/config/    packages/config/

# Panda CSS codegen then Vite build
RUN pnpm --filter @strus/web run prepare && \
    pnpm --filter @strus/web run build

# ─── Stage 2: Bun runtime ────────────────────────────────────────────────────
FROM oven/bun:1 AS runtime

# Install morfeusz2 (Polish morphological analyser — required by @strus/morph)
RUN <<-'EOF'
	set -euo pipefail
	apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates \
		wget

	mkdir -p /etc/apt/keyrings
	wget -O /etc/apt/keyrings/sgjp.asc http://download.sgjp.pl/apt/sgjp.gpg.key
	echo 'deb [trusted=yes] http://download.sgjp.pl/apt/ubuntu noble main' > /etc/apt/sources.list.d/sgjp.list
	apt-get -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowUnsigned=true update
	apt-get install -y --no-install-recommends \
		morfeusz2 \
		morfeusz2-dictionary-polimorf
	apt-get clean && rm -rf /var/lib/apt/lists/*
EOF

WORKDIR /app

# Copy all package manifests and workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/api/package.json     packages/api/
COPY packages/cli/package.json     packages/cli/
COPY packages/config/package.json  packages/config/
COPY packages/core/package.json    packages/core/
COPY packages/db/package.json      packages/db/
COPY packages/morph/package.json   packages/morph/
COPY packages/web/package.json     packages/web/

# Copy source for all packages the API depends on at runtime
COPY packages/api/    packages/api/
COPY packages/config/ packages/config/
COPY packages/core/   packages/core/
COPY packages/db/     packages/db/
COPY packages/morph/  packages/morph/

# Let Bun install its own node_modules — pnpm's symlink store is not
# compatible with Bun's module resolution when copied across stages
RUN --mount=type=cache,id=bun,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Copy compiled web frontend; API serves it statically when present
COPY --from=web-build /app/packages/web/dist ./packages/web/dist

# Data directory — mount a volume here to persist the SQLite DB
RUN mkdir -p /data
ENV STRUS_DB_PATH=/data/strus.db

EXPOSE 3457

CMD ["bun", "run", "packages/api/src/index.ts"]
