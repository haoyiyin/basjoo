FROM node:20-alpine AS builder

WORKDIR /app

ARG BACKEND_PROXY_TARGET=http://localhost:8000
ENV BACKEND_PROXY_TARGET=$BACKEND_PROXY_TARGET
ENV NODE_OPTIONS=--max-old-space-size=768

COPY package*.json ./
RUN npm ci --prefer-offline --no-audit

COPY next.config.mjs tsconfig.json next-env.d.ts ./
COPY app ./app
COPY src ./src
COPY public ./public

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

CMD ["node", "server.js"]
