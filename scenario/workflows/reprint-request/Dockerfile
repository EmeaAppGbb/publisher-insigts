# syntax=docker/dockerfile:1
# The reprint request MCP server for Azure Container Apps, built from scenario/workflows/reprint-request/ as the
# context. The build stage bundles the server into one module; the runtime stage runs that bundle on a distroless,
# non-root Node.js image without a shell, package manager or node_modules. deploy.py builds it with ACR Tasks.
FROM node:24-alpine AS build
# Optional npm mirror for networks that block registry.npmjs.org; npm routes the lockfile's URLs through it.
ARG NPM_REGISTRY=""
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund ${NPM_REGISTRY:+--registry=$NPM_REGISTRY}
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs24-debian13:nonroot
WORKDIR /srv
ENV NODE_ENV=production \
    PORT=8080
COPY --from=build /src/dist dist
EXPOSE 8080
CMD ["dist/main.mjs"]
