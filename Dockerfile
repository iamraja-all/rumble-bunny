# Stage 1: Build Frontend
FROM node:18-alpine AS builder

WORKDIR /app
COPY 04_Render_Engine /app/04_Render_Engine
WORKDIR /app/04_Render_Engine
RUN npm install
RUN npm run build

# Stage 2: Production Server
FROM node:18-alpine

WORKDIR /app
# Copy the built frontend static files
COPY --from=builder /app/04_Render_Engine/dist /app/public

# Copy the stable build backend
COPY 03_Stable_Build /app/03_Stable_Build

# Set up the backend dependencies
WORKDIR /app/03_Stable_Build
RUN npm install

EXPOSE 8080
CMD ["node", "server.js"]
