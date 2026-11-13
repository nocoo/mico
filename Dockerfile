FROM node:26.13.0-bookworm-slim AS build

ARG NPM_REGISTRY=https://packagefeedproxy.microsoft.io/npm/
WORKDIR /app
RUN npm install --global pnpm@12.18.0 --registry="$NPM_REGISTRY"
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry="$NPM_REGISTRY"
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts --registry="$NPM_REGISTRY"

FROM node:26.13.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    MICO_HOST=0.0.0.0 \
    MICO_PORT=47063 \
    MICO_DB_PATH=/data/board.sqlite \
    MICO_STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/generate-image.ts ./scripts/generate-image.ts
RUN mkdir -p /data /home/node/.config/mico \
    && chown -R node:node /data /home/node/.config
USER node
EXPOSE 47063
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.MICO_PORT+'/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server/index.ts"]
