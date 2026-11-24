# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY apps/notification-service ./apps/notification-service
RUN npm install --ignore-scripts && npm --prefix apps/notification-service run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3005
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder --chown=nestjs:nodejs /workspace/apps/notification-service ./apps/notification-service
COPY --from=builder --chown=nestjs:nodejs /workspace/libs/shared ./libs/shared
USER nestjs
EXPOSE 3005
CMD ["node", "apps/notification-service/dist/main.js"]
