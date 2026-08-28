# guttex

**G**hidra-c**utte**r-e**x**tended — a web front end for
[ghidra-rest](https://github.com/onixldlc/ghidra-rest).

Ghidra does the analysis. ghidra-rest turns a run of `analyzeHeadless` into JSON
artifacts behind a REST API. guttex is the part you actually look at: a dense,
dark, dockable workbench modelled on [Cutter](https://cutter.re) rather than on
Ghidra's own Swing UI.

Status: **frontend scaffold**. The Svelte app is complete and talks to a live
ghidra-rest instance today. The guttex backend (database, projects, persisted
renames/notes) is the next piece — see [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
guttex/
├── docker/                     Dockerfile, nginx template, entrypoint, verify
├── docker-compose.yml          ghidra-rest + guttex, one command
├── web/                        SvelteKit 5 SPA (adapter-static)
│   ├── src/
│   │   ├── app.css             Cutter-ish dark theme, all tokens in :root
│   │   ├── app.html
│   │   ├── lib/
│   │   │   ├── api/client.ts   the only place that speaks HTTP
│   │   │   ├── api/types.ts    mirrors ghidra-rest's openapi.yaml
│   │   │   ├── format.ts       byte/time/address formatting + C tokenizer
│   │   │   ├── state/session.svelte.ts   shared workbench state (runes)
│   │   │   └── components/     TitleBar, SideDock, ListPanel, Decompiler,
│   │   │                       HexView, InfoPanel, XrefsPanel, Console,
│   │   │                       StatusBar, Splitter
│   │   └── routes/
│   │       ├── +page.svelte        job queue + upload
│   │       └── j/[id]/+page.svelte the workbench
│   ├── vite.config.ts          dev proxy /api -> ghidra-rest
│   └── svelte.config.js        adapter-static, SPA fallback
└── docs/DESIGN.md              UI model + backend/DB plan
```

## Why Svelte

No virtual DOM and no runtime framework shipped to the browser: Svelte 5
compiles components to direct DOM updates, so a 40k-row symbol table stays
responsive without hand-writing DOM code. Runes (`$state`, `$derived`,
`$effect`) give the reactivity React needs hooks and memo gymnastics for. The
built SPA is a folder of static files — later the guttex backend can `embed` it
and ship as one binary, same as ghidra-rest does.

## Running it

Requires Node 20+ and a reachable ghidra-rest.

```sh
cd web
cp .env.example .env        # point GHIDRAREST_URL at your instance
npm install
npm run dev                 # http://localhost:5173
```

The browser only ever calls same-origin `/api/*`. In dev, vite proxies that to
`GHIDRAREST_URL` and injects `Authorization: Bearer $GHIDRAREST_TOKEN`
server-side, so **the token never reaches the browser bundle**. In production
the guttex backend owns that path and the same rule holds.

Production build:

```sh
npm run build               # -> web/build/, static files + index.html fallback
npm run preview
```

No Node on the host? Same thing in a container:

```sh
podman run --rm -it -v "$PWD/web":/app -w /app -p 5173:5173 \
  docker.io/library/node:22-alpine sh -c 'npm install && npm run dev'
```

## Container / compose

The whole stack, analyser included:

```sh
podman-compose up -d          # or: docker compose up -d
xdg-open http://127.0.0.1:8088
```

`docker-compose.yml` runs ghidra-rest **unpublished** on the compose network and
only exposes guttex. The browser reaches the analyser exclusively through the
UI's `/api` proxy, which attaches the token nginx-side.

Just the UI, against an existing ghidra-rest:

```sh
podman build --format docker -t guttex:dev -f docker/Dockerfile .
podman run -d --name guttex -p 127.0.0.1:8088:8080 \
  -e GHIDRAREST_URL=http://host.containers.internal:8090 \
  -e GHIDRAREST_TOKEN=your-token \
  guttex:dev
```

| env | default | meaning |
|---|---|---|
| `GHIDRAREST_URL` | `http://127.0.0.1:8080` | upstream the `/api` prefix proxies to |
| `GHIDRAREST_TOKEN` | empty | injected as `Authorization: Bearer`; blank clears whatever the browser sent |
| `GUTTEX_PORT` | `8080` | listen port inside the container |
| `GUTTEX_MAX_UPLOAD` | `1024m` | `client_max_body_size`; nginx defaults to 1m, useless for binaries |
| `GUTTEX_RUNDIR` | `/tmp/guttex` | where the rendered config lives |

The image ships `docker/nginx.conf.template`; `docker/entrypoint.sh` renders it
into `GUTTEX_RUNDIR` at start, so the resolved config -- the only place the token
appears -- exists just for the life of the container. `docker/verify.sh` is the
healthcheck and doubles as a smoke test:

```sh
podman exec guttex /usr/local/bin/verify.sh
```

Anyone who can reach the UI port can submit binaries to ghidra-rest through it,
with the token already attached. Keep the publish on `127.0.0.1` and tunnel in
(`ssh -L 8088:127.0.0.1:8088 host`) unless the network is trusted.

## The UI

Cutter's arrangement, in the browser:

| Region | What's in it |
|---|---|
| Title bar | file name, arch/format badges, seek box, cancel/export, console toggle |
| Left dock | Functions, Strings, Symbols, Imports, Exports, Types, Memory — filtered server-side via `?q=`, paged 200 at a time, sortable by column |
| Center | Disassembly (instruction listing, clickable call/jump targets), Decompiler (syntax-highlighted C), Hexdump (paged, `<<`/`>>`), Info (summary.json) |
| Right dock | selected address: signature, parameters, calls / called-by, xrefs both ways |
| Bottom | console — tails `analyzeHeadless` output |
| Status bar | artifact counts, analysis duration, current address |

One selection drives everything: click a row anywhere and the centre and right
docks follow it. Dividers drag (and take arrow keys). Tab bars collapse into a
`⋯` menu when a dock is too narrow rather than clipping, and the active tab is
never the one that gets hidden.

Column headers sort. Sorting is client-side over the rows fetched so far --
ghidra-rest has no sort parameter, and pulling 40k symbols just to order them
would be worse than ordering the page in front of you.

The Disassembly tab needs the `disasm` artifact, added to ghidra-rest for this.
Jobs analysed before that exist without it and the tab answers 404 for them;
re-submit with `force=1` to get a listing.

Design rules, if you extend it:

- `client.ts` is the only module that calls `fetch`. Components take data, not URLs.
- Server text is rendered as text. The decompiler tokenizes into spans; nothing
  is ever passed to `{@html}`.
- Lists page server-side. Never `limit=100000`.
- A `409` from a result endpoint means "analysis still running", not an error —
  `ApiError.notReady` marks it.

## Related

- [ghidra-rest](https://github.com/onixldlc/ghidra-rest) — the analysis API this
  front end drives; its `docs/openapi.yaml` is the contract mirrored in
  `web/src/lib/api/types.ts`.
