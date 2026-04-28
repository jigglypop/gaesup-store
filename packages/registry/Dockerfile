FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/core-rust/package.json packages/core-rust/package.json
COPY packages/registry/package.json packages/registry/package.json
RUN pnpm install --filter @gaesup-state/registry... --no-frozen-lockfile

FROM deps AS build
COPY packages/core packages/core
COPY packages/core-rust packages/core-rust
COPY packages/registry packages/registry
RUN pnpm --filter @gaesup-state/registry run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=build /app/packages/registry/dist ./packages/registry/dist
WORKDIR /app/packages/registry
EXPOSE 5000
CMD ["node", "dist/server.js"]
