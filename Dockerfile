FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY src ./src
# The catalogue snapshot lives here; mount a volume so restarts don't re-crawl.
VOLUME /app/data
EXPOSE 3001
# The index takes ~700 MB once loaded; give V8 room for a re-crawl on top.
CMD ["node", "--max-old-space-size=2048", "--import", "tsx", "src/server/index.ts"]
