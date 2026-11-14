# syntax=docker/dockerfile:1
# One file, two images:
#   docker build --target server -t shellter-server .   # API + built client + admin panel
#   docker build --target bot    -t shellter-bot .      # Telegram bot (may live on another host)
# Base image is pinned by digest; bump the tag and the digest together.
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Public build-time settings of the client (not secrets): bot username for links, AdsGram block id.
ARG VITE_BOT_USERNAME=""
ARG VITE_ADSGRAM_BLOCK_ID=""
ENV VITE_BOT_USERNAME=$VITE_BOT_USERNAME VITE_ADSGRAM_BLOCK_ID=$VITE_ADSGRAM_BLOCK_ID
RUN pnpm art \
 && pnpm --filter @shellter/client build \
 && pnpm --filter @shellter/admin build \
 && pnpm --filter @shellter/server build \
 && pnpm --filter @shellter/bot build
RUN pnpm --filter @shellter/server deploy --prod --legacy /out/server \
 && pnpm --filter @shellter/bot deploy --prod --legacy /out/bot

FROM base AS server
ENV NODE_ENV=production CLIENT_DIST=/app/client ADMIN_DIST=/app/admin PORT=3000
COPY --from=build /out/server/package.json ./package.json
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/client/dist ./client
COPY --from=build /app/apps/admin/dist ./admin
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM base AS bot
ENV NODE_ENV=production
COPY --from=build /out/bot/package.json ./package.json
COPY --from=build /out/bot/node_modules ./node_modules
COPY --from=build /app/apps/bot/dist ./dist
USER node
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "-e", "fetch('http://127.0.0.1:8082/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
