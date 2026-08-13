FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install build tools for C++ server
RUN apt-get update -qq && apt-get install -y -qq g++ make libssl-dev zlib1g-dev

# Build Next.js frontend
COPY package*.json ./
RUN npm ci
COPY . .
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

# Next.js standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Petalia C++ server binary
COPY --from=build /app/petalia-server /app/petalia-server

# Proxy script
COPY --from=build /app/server.js /app/server.js

ENV NODE_ENV=production
ENV PORT=8080
ENV NEXT_PUBLIC_GAME_WS=wss://molorr.onrender.com

# Proxy listens on :8080 → Next.js (internal) + C++ WebSocket (internal :8081)
EXPOSE 8080
CMD ["node", "/app/server.js"]
