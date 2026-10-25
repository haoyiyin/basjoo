# ---- build stage -------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

ENV NODE_OPTIONS=--max-old-space-size=1024

COPY package*.json ./
# `--legacy-peer-deps` is required: npm 10's arborist crashes on this
# dependency graph's peer set ("Cannot read properties of null (reading 'edgesOut')").
RUN npm ci --prefer-offline --no-audit --legacy-peer-deps

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

RUN npm run build

# ---- runtime stage (static files only, no Node) ------------------------------
FROM nginxinc/nginx-unprivileged:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

# The image's entrypoint runs nginx as the unprivileged user.
CMD ["nginx", "-g", "daemon off;"]
