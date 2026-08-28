# guttex: the SvelteKit SPA, built once, served by nginx which also fronts
# ghidra-rest at /api so the browser never holds an API token.
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


FROM docker.io/library/nginx:1.27-alpine

# the stock site config would shadow ours
RUN rm -f /etc/nginx/conf.d/default.conf

COPY docker/nginx.conf.template /etc/guttex/nginx.conf.template

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

COPY docker/verify.sh /usr/local/bin/verify.sh

RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/verify.sh

COPY --from=build /app/build /usr/share/nginx/html

ENV GUTTEX_PORT=8080 \
    GUTTEX_RUNDIR=/tmp/guttex \
    GUTTEX_MAX_UPLOAD=1024m \
    GHIDRAREST_URL=http://127.0.0.1:8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD /usr/local/bin/verify.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["nginx", "-g", "daemon off;", "-c", "/tmp/guttex/nginx.conf"]
