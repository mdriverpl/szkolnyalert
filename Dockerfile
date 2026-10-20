FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
COPY scripts/build.js ./scripts/build.js
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    STORAGE_DRIVER=json \
    DEMO_DATA=false \
    DATA_DIR=/data \
    JSON_FILE=app.json
LABEL org.opencontainers.image.source="https://github.com/mdriverpl/szkolnyalert"
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && mkdir /data && chown node:node /data
COPY server ./server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(async r=>{const b=await r.json();if(!r.ok||!b.ok||b.demo)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
