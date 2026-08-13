FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install build tools for C++ server
RUN apt-get update -qq && apt-get install -y -qq git g++ make libssl-dev zlib1g-dev

# Build Next.js frontend (NEXT_PUBLIC_* must be set at build time)
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_PUBLIC_GAME_WS=wss://molorr-server-t34o.onrender.com
RUN npm run build

# Build C++ server
RUN git clone --recursive https://github.com/uNetworking/uWebSockets.git && \
    make -s -j$(nproc) -C uWebSockets && \
    g++ -std=c++20 -O2 server-cpp/main.cpp \
        -IuWebSockets/src -IuWebSockets/uSockets/src \
        uWebSockets/uSockets/*.o -lz -lssl -lcrypto -o /app/petalia-server

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

WORKDIR /app

# Runtime libs for the C++ binary
RUN apt-get update -qq && apt-get install -y -qq libssl-dev zlib1g-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Next.js standalone output → /app/nextjs/
RUN mkdir -p /app/nextjs
COPY --from=build /app/.next/standalone/. /app/nextjs/
COPY --from=build /app/.next/static /app/nextjs/.next/static

# Petalia C++ server binary
COPY --from=build /app/petalia-server /app/petalia-server

# Entry script (kept separate from Next.js server.js to avoid name collision)
COPY --from=build /app/entry.js /app/entry.js

ENV NODE_ENV=production
ENV PORT=8080

# Entry listens on :8080 → Next.js (internal :3080) + C++ WebSocket (internal :8081)
EXPOSE 8080
CMD ["node", "/app/entry.js"]