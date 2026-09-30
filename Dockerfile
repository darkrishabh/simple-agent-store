FROM node:26-bookworm-slim AS build
WORKDIR /app
# Native SQLite bindings may need compilation on architectures without a prebuild.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build && npm prune --omit=dev

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production AGENTSTORE_DB_PATH=/data/agentstore.sqlite
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json LICENSE ./
COPY web ./web
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4310 4311
CMD ["node", "dist/src/mcp-http.js"]
