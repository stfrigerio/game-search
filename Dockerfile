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
COPY --from=build /app/dist-server ./dist-server
COPY package.json ./
EXPOSE 3001
# Needs DATABASE_URL. Rebuild the catalogue with:
#   docker run --rm -e DATABASE_URL=... <image> node dist-server/crawl-cli.js
CMD ["node", "--max-old-space-size=192", "dist-server/index.js"]
