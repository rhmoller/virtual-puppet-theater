FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html showcase.html ./
COPY src ./src
COPY server ./server
RUN bun run build

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
COPY package.json bun.lock ./
# Only install production deps; then drop the two that are client-only
# (their bundled code already lives in dist/).
RUN bun install --production --frozen-lockfile \
 && rm -rf node_modules/three node_modules/@mediapipe
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["bun", "server/index.ts"]
