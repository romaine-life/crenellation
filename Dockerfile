FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json backend/
RUN cd backend && npm install --omit=dev

COPY backend/ backend/
COPY --from=frontend-build /app/frontend/dist frontend/dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /var/run/chess-tactics-hot /var/run/chess-tactics-static-override && \
    chown -R nodejs:nodejs /app /var/run/chess-tactics-hot /var/run/chess-tactics-static-override
USER nodejs

ENV HOT_BACKEND_DIR=/var/run/chess-tactics-hot \
    STATIC_FRONTEND_DIR=/var/run/chess-tactics-static-override \
    FRONTEND_DIR=/app/frontend/dist \
    NODE_PATH=/app/backend/node_modules

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

CMD ["node", "backend/supervisor.js"]
