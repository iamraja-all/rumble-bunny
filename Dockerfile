# Stage 1: Build Frontend
#
# WHY node:22 AND NOT node:18: `vite@8.1.5` declares
# `engines: { node: "^20.19.0 || >=22.12.0" }`. On node:18 npm reports EBADENGINE and
# vite 8 is simply unsupported there, so the builder stage could not have produced a
# bundle even with the COPY above fixed. Second defect in this file that only existed
# because `docker build` was never run. 22 is the current LTS and satisfies the range.
FROM node:22-alpine AS builder

WORKDIR /app

# WHY 03_Stable_Build IS COPIED INTO THE *BUILDER*, NOT JUST THE RUNTIME STAGE:
# the client imports engine modules directly, by relative path —
#   src/minimap.js, menu.js, scenery.js, circuit-visuals.js -> ../../03_Stable_Build/circuit-track.js
#   src/network.js                                          -> ../../03_Stable_Build/ledger.js
# so the engine has to sit at exactly the position those paths expect,
# /app/03_Stable_Build, before `npm run build` runs.
#
# Without this the build does not degrade, it FAILS: rolldown reports
# UNRESOLVED_IMPORT for every one of those files and `npm run build` exits 1. Verified
# by reproducing this stage locally with only 04_Render_Engine present.
#
# That is not a hypothetical — it is the state this Dockerfile shipped in. It was
# written on 2026-07-31, the cross-directory imports arrived with the circuit work and
# grew again in ADR-0016/0017, and nobody ever ran `docker build` to find out. The
# deployment path idea.md:11 promises has never once produced an image.
COPY 03_Stable_Build /app/03_Stable_Build
COPY 04_Render_Engine /app/04_Render_Engine
WORKDIR /app/04_Render_Engine
RUN npm install
RUN npm run build

# Stage 2: Production Server
#
# Kept on the same major as the builder deliberately. The runtime only needs `ws`
# (engines: >=10) and the stdlib, so 18 would have run — but two different Node majors
# in one Dockerfile is a difference nobody would think to check when a bug appears in
# only one of them.
FROM node:22-alpine

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
