# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY apps/payment-service ./apps/payment-service
RUN npm install --ignore-scripts && npm --prefix apps/payment-service run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3004
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder --chown=nestjs:nodejs /workspace/apps/payment-service ./apps/payment-service
COPY --from=builder --chown=nestjs:nodejs /workspace/libs/shared ./libs/shared
USER nestjs
EXPOSE 3004
CMD ["node", "apps/payment-service/dist/main.js"]
