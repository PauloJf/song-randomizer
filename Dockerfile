# syntax=docker/dockerfile:1.6

# ---- 1. Build the frontend ----
FROM node:24-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- 2. Build the backend ----
FROM node:24-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

# ---- 3. Runtime image ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV STATE_DIR=/data

# Install only production deps for the server.
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# Compiled server output.
COPY --from=server-build /app/server/dist ./dist

# Built frontend, served as static files by the backend.
COPY --from=web-build /app/web/dist ./web-dist

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "dist/index.js"]
