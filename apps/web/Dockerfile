# The Next.js dashboard. Build it from the repo root, not from apps/web:
# `next build` type-checks the shared types in libs/contracts.
#
#   docker build -f apps/web/Dockerfile -t wiki-web:dev .
#
# The browser opens the api's GET /live at NEXT_PUBLIC_API_URL. Next inlines
# that value into the JavaScript at build time, so it's a build argument, and a
# ConfigMap can't change it later. The default matches the api port-forward in
# the README; for any other address, rebuild:
#
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://... -t wiki-web:dev .

ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/apps/web
# Manifests first: the npm ci layer is reused until they change
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
# Only types cross over from the Nest side (`import type`): the type check reads
# these files and the bundle never contains them. Keep this list in step with
# the imports in libs/contracts/src/index.ts.
COPY libs/contracts/src /repo/libs/contracts/src
COPY libs/kafka/src/events.ts /repo/libs/kafka/src/events.ts
ARG NEXT_PUBLIC_API_URL=http://localhost:3004
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
# server.js listens on $HOSTNAME:$PORT. Kubernetes overrides HOSTNAME with the
# pod's name, so web.yaml sets it again; see the comment there.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# output: 'standalone' is a server.js plus only the node_modules it needs. It
# doesn't include the static assets and public/, which it serves from next to it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./.next/static
COPY --from=build /repo/apps/web/public ./public
# Next writes its cache here at runtime (optimized images, cached data). In
# Kubernetes an emptyDir is mounted over it, since the root filesystem is read-only.
RUN mkdir -p .next/cache && chown 1000:1000 .next/cache
# The image's built-in "node" user, by number: Kubernetes can only check
# runAsNonRoot against a numeric UID
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]
