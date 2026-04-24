# Stage 1: build frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: runtime environment
FROM node:20-alpine
RUN apk add --no-cache ca-certificates
# vedur.is does not send its intermediate cert (GlobalSign GCC R6 AlphaSSL CA 2025),
# so we bundle it manually and tell Node where to find it.
COPY globalsign-intermediate.pem /usr/local/share/ca-certificates/globalsign-intermediate.pem
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/globalsign-intermediate.pem
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=builder /app/dist ./dist/
EXPOSE 8080
CMD ["node", "server/index.js"]
