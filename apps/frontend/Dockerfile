# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS builder
WORKDIR /workspace
COPY package.json tsconfig.base.json ./
COPY apps/frontend ./apps/frontend
RUN npm install --ignore-scripts && npm --prefix apps/frontend run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /workspace/apps/frontend ./apps/frontend
USER nextjs
EXPOSE 3000
CMD ["npm", "--prefix", "apps/frontend", "run", "start"]
