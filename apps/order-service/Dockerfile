# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY apps/order-service ./apps/order-service
RUN npm install --ignore-scripts && npm --prefix apps/order-service run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3003
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder --chown=nestjs:nodejs /workspace/apps/order-service ./apps/order-service
COPY --from=builder --chown=nestjs:nodejs /workspace/libs/shared ./libs/shared
USER nestjs
EXPOSE 3003
CMD ["node", "apps/order-service/dist/main.js"]
