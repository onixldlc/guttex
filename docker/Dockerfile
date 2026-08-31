# guttex: the SvelteKit app, served by its own Node server.
#
# That server does three things, which is why there is no nginx here any more:
# it hands out the UI, it owns /api/guttex (projects and annotations, kept in
# the /projects volume), and it fronts ghidra-rest at /api with the bearer
# token attached so the browser never holds one.
#
#   podman build -t guttex:dev -f docker/Dockerfile .

FROM docker.io/library/node:22-alpine AS build

WORKDIR /app

# lockfile first: dependency layer survives source edits
COPY web/package.json web/package-lock.json ./

RUN npm ci --no-audit --no-fund

COPY web/svelte.config.js web/vite.config.ts web/tsconfig.json ./

COPY web/src ./src

COPY web/static ./static

RUN npm run build


FROM docker.io/library/node:22-alpine

WORKDIR /app

# adapter-node emits a self-contained server; guttex has no runtime
# dependencies, so the build output is the whole application.
COPY --from=build /app/build ./build

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

COPY docker/verify.sh /usr/local/bin/verify.sh

RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/verify.sh

ENV NODE_ENV=production \
    PORT=8080 \
    GUTTEX_PROJECTS=/projects \
    BODY_SIZE_LIMIT=1024M \
    GHIDRAREST_URL=http://127.0.0.1:8080

# Everything guttex remembers. Mount it, or the renames die with the container.
VOLUME ["/projects"]

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD /usr/local/bin/verify.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["node", "build"]
