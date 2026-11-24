# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json tsconfig.base.json ./
COPY libs/shared ./libs/shared
COPY apps/product-service ./apps/product-service
RUN npm install --ignore-scripts && npm --prefix apps/product-service run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV GRPC_URL=0.0.0.0:50051
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
COPY --from=builder --chown=nestjs:nodejs /workspace/apps/product-service ./apps/product-service
COPY --from=builder --chown=nestjs:nodejs /workspace/libs/shared ./libs/shared
USER nestjs
EXPOSE 3001 50051
CMD ["node", "apps/product-service/dist/main.js"]
