# Runback self-host image. Builds the web workspace from the monorepo and runs it.
# Paired with docker-compose.yml, which bundles a Supabase-compatible data layer
# (Postgres + PostgREST + a path proxy) so `docker compose up` is self-contained.
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Copy the whole monorepo and install once (workspaces). Simpler and correct;
# layer caching is secondary to a build that actually works.
COPY . .
RUN npm install --no-audit --no-fund
RUN npm run build --workspace @runback/web

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Run as non-root — required by bank/enterprise container security scanners.
RUN addgroup -S runback && adduser -S runback -G runback
COPY --from=build /app ./
RUN chown -R runback:runback /app
USER runback

EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@runback/web"]
