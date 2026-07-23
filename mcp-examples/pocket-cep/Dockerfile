# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
WORKDIR /app

# 1. Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm install --no-audit --no-fund

# 2. Build Next.js application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# 3. Production runner
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

CMD ["npm", "start"]
