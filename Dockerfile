# One image for all three apps. Each Kubernetes Deployment picks its app with
# its command: node dist/apps/<ingester|archiver|bursts>/main.js
#
#   docker build -t wiki-reader:dev .

# Debian (glibc), not Alpine: @confluentinc/kafka-javascript downloads a prebuilt
# librdkafka binary for linux-glibc-x64 in its install script
ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Manifests first: this layer (the slow npm ci) is reused until they change
COPY package.json package-lock.json ./
# Runs the Confluent client's install script, which fetches the native binary
# into node_modules/@confluentinc/kafka-javascript/build/Release
RUN npm ci
COPY . .
# Each app has its own outDir (dist/apps/<app>), so building one doesn't
# delete another's output even with deleteOutDir
RUN npx nest build ingester \
 && npx nest build archiver \
 && npx nest build bursts
# Drops dev dependencies but keeps the native binary already in place, so it
# isn't downloaded a second time
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# package.json is needed at runtime: "type": "module" makes Node load main.js as ESM.
# Rspack leaves node_modules out of the bundle, so they are copied as well.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The image's built-in "node" user, by number: Kubernetes can only check
# runAsNonRoot against a numeric UID
USER 1000
EXPOSE 3000
CMD ["node", "dist/apps/ingester/main.js"]
