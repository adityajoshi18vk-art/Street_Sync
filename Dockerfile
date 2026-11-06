# StreetSync: Next.js app + Fastify backend in one container.
# The backend's SQLite database (World ID nullifiers, indexed bounties, report cache)
# lives at DB_PATH; mount a persistent volume at /data.
FROM node:24-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Install workspace dependencies first for layer caching. Install scripts are skipped:
# every native dependency in use ships prebuilt binaries via optional packages.
COPY package.json package-lock.json ./
COPY contracts/package.json contracts/
COPY packages/evidence/package.json packages/evidence/
COPY packages/arkiv-client/package.json packages/arkiv-client/
COPY backend/package.json backend/
COPY app/package.json app/
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

# BACKEND_API_URL is baked into the Next.js /api rewrite at build time.
ENV BACKEND_PORT=3001 \
    BACKEND_API_URL=http://127.0.0.1:3001
RUN npm run build && npm run build --workspace=streetsync-app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/streetsync.db
EXPOSE 3000
CMD ["node", "scripts/start-production.mjs"]
