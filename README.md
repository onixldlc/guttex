# guttex

**G**hidra-c**utte**r-e**x**tended — a web front end for
[ghidra-rest](https://github.com/onixldlc/ghidra-rest).

Ghidra does the analysis. ghidra-rest turns a run of `analyzeHeadless` into JSON
artifacts behind a REST API. guttex is the part you actually look at: a dense,
dark, dockable workbench modelled on [Cutter](https://cutter.re) rather than on
Ghidra's own Swing UI.

guttex keeps its own state — projects and the names you give things — in a
folder on a volume, and syncs it, so the work follows you from the desktop to
the phone. ghidra-rest stays stateless; see [docs/DESIGN.md](docs/DESIGN.md).

## Layout

```
guttex/
├── docker/                     Dockerfile, entrypoint, verify
├── docker-compose.yml          ghidra-rest + guttex, one command
├── web/                        SvelteKit 5 SPA (adapter-static)
│   ├── src/
│   │   ├── app.css             Cutter-ish dark theme, all tokens in :root
│   │   ├── app.html
│   │   ├── lib/
│   │   │   ├── api/client.ts   ghidra-rest, through the /api proxy
│   │   │   ├── api/store.ts    guttex's own endpoints: projects, annotations
│   │   │   ├── api/types.ts    mirrors ghidra-rest's openapi.yaml
│   │   │   ├── server/store.ts the projects folder. Server-only by construction
│   │   │   ├── format.ts       byte/time/address formatting + C tokenizer
│   │   ├── plugins/        plugin contract (types.ts) + registry (host.svelte.ts)
│   │   │   ├── state/session.svelte.ts   shared workbench state (runes)
│   │   │   ├── state/device.svelte.ts    which front end this screen gets
│   │   │   ├── state/renames.svelte.ts   the annotation document
│   │   │   ├── state/book.svelte.ts      Ghidra's address -> name defaults
│   │   │   ├── state/callgraph.svelte.ts root + open branches, per job
│   │   │   ├── state/exporter.svelte.ts  one export at a time, with progress
│   │   │   ├── state/signature.svelte.ts prototypes, pushed back into Ghidra
│   │   │   ├── state/sync.svelte.ts      push/pull/merge against the server
│   │   │   ├── graph/           Cutter's GraphGridLayout, ported
│   │   │   ├── mobile/          phone shell: chips, touch list, row specs
│   │   │   └── components/     TitleBar, SideDock, ListPanel, Decompiler,
│   │   │                       Disassembly, FunctionGraph, CallGraph,
│   │   │                       HexView, InfoPanel, XrefsPanel, Console,
│   │   │                       RenameDialog, ExportDialog, SignatureDialog,
│   │   │                       StatusBar, Splitter
│   │   └── routes/
│   │       ├── +page.svelte        job queue + upload + plugins
│   │       ├── plugins/+page.svelte  plugin documentation, in-app
│   │       ├── j/[id]/+page.svelte the workbench
│   │       ├── mobile/+page.svelte  phone: job queue + upload
│   │       ├── mobile/[id]/+page.svelte  phone workbench
│   │       ├── api/[...path]/+server.ts  everything else -> ghidra-rest
│   │       └── api/guttex/v1/...   projects + annotations, guttex's own
│   ├── static/examples/     sample plugins (hello, ai-explain), installed by
│   │                        nobody until you click install
│   ├── vite.config.ts          dev proxy /api -> ghidra-rest
│   └── svelte.config.js        adapter-node: the app serves its own endpoints
├── docs/DESIGN.md              UI model + the projects folder
├── docs/SIGNATURES.md          retyping functions: what it changes and where
└── docs/PLUGINS.md             plugin API, limits, trust model
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

The browser only ever calls same-origin `/api/*`. `src/routes/api/[...path]`
forwards that to `GHIDRAREST_URL` with `Authorization: Bearer $GHIDRAREST_TOKEN`
attached server-side, so **the token never reaches the browser bundle**. Dev and
production run the same endpoint code -- there is no proxy config to drift.

Paths under `/api/guttex/` are guttex's own and never leave the process: they
are the project store, backed by `GUTTEX_PROJECTS`.

Production build:

```sh
npm run build               # -> web/build/, a Node server (adapter-node)
node build
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
UI's `/api` proxy, which attaches the token server-side. The `guttex-projects`
volume is everything guttex remembers.

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
| `GUTTEX_PROJECTS` | `/projects` | the volume: one folder per project |
| `PORT` | `8080` | listen port inside the container |
| `BODY_SIZE_LIMIT` | `1024M` | adapter-node's request cap; the default is far below a binary |

No `ORIGIN` needed, deliberately. SvelteKit's own cross-site check compares the
browser's `Origin` against an origin adapter-node reconstructs -- and with no
`ORIGIN` set it fills the protocol in as `https`, so over plain http the page's
own uploads come back `Cross-site POST form submissions are forbidden`. Setting
`ORIGIN` fixes that for exactly one URL and breaks the moment you open guttex
from your phone at a LAN address. `src/hooks.server.ts` does the comparison by
**host** instead, ignoring the protocol, and applies it to every mutating
method rather than only form-shaped posts -- so an unauthenticated guttex on
your desk still cannot be driven by a page in another tab, from any address you
reach it at.

There is no nginx and no config template any more: the SvelteKit server serves
the app, owns the project store and proxies the analyser, so the token exists
only in the server process's environment. `docker/entrypoint.sh` checks the
projects volume is writable and gets out of the way; `docker/verify.sh` is the
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
| Center | Disassembly (instruction listing, clickable call/jump targets), Decompiler (C, hover a line for its instructions), Graph (control flow), Call graph (who calls what, from the entry point out), Hexdump (paged, `<<`/`>>`), Info (summary.json) |
| Right dock | selected address: signature, parameters, calls / called-by, xrefs both ways |
| Bottom | console — tails `analyzeHeadless` output |
| Status bar | artifact counts, analysis duration, current address |

One selection drives everything: click a row anywhere and the centre and right
docks follow it. The selection lives in the URL (`?a=401490`), so the browser's
back/forward — including a mouse's thumb buttons — walks the functions you
visited, and a workbench URL is shareable.

Right-clicking anything with an address — a function row, a call/jump target,
an xref — opens guttex's own menu: open, **open in new tab**, copy address /
name / link. Right-clicking anywhere else leaves the browser menu alone, and
the menu itself offers *browser default* (arms the next right-click to pass
through); shift+right-click always bypasses it. Dividers drag (and take arrow keys). Tab bars collapse into a
`⋯` menu when a dock is too narrow rather than clipping, and the active tab is
never the one that gets hidden.

Column headers sort. Sorting is client-side over the rows fetched so far --
ghidra-rest has no sort parameter, and pulling 40k symbols just to order them
would be worse than ordering the page in front of you.

The Disassembly tab needs the `disasm` artifact, added to ghidra-rest for this.
Jobs analysed before that exist without it and the tab answers 404 for them;
re-submit with `force=1` to get a listing.

The Decompiler tab is a listing, not an editor: the C is tokenized and
rendered, and the names in it are fixed by renaming the symbol rather than by
typing over the text. See **Renaming** below.

Hovering a line of C shows the instructions that produced it. Ghidra records
that mapping on the decompiler's markup tree, and ghidra-rest now exports it as
`lines` alongside the C -- the same data its own Decompiler window uses to
highlight the Listing. Jobs analysed before that fall back to matching the text
of the line against the listing, and the card says which of the two you are
looking at.

The graph views lay out with a port of Cutter's `GraphGridLayout`, arrows and
all; green is the taken branch, red the fall-through, blue an unconditional
jump. Pan and zoom are remembered per function, so leaving the tab and coming
back does not throw away the view you set up.

The call graph is the exception to "per function": it is the map of the whole
binary, so its root and its open branches live outside the component
(`lib/state/callgraph.svelte.ts`). Walking into a callee, switching tabs or
hitting back keeps the tree you expanded -- rebuilding it from the entry point
every time was what made it useless for the thing it is for. Only the branches
you opened are ever drawn, so a 30k-function binary stays interactive.

**Names instead of addresses.** Ghidra hands the listing back with bare branch
targets (`CALL 0x006341eb`) even when it knows the address is
`__security_init_cookie`. guttex resolves them where they are drawn, in this
order:

1. your rename for that address,
2. Ghidra's name for it (`lib/state/book.svelte.ts`),
3. the address, when nothing knows it.

The book fills itself from what has already been fetched -- a function entry
names itself, everything it calls and everything that calls it -- so the common
case costs no extra request, and building the call graph once names the whole
binary. Only a call target is ever worth a lookup of its own; a jump inside the
function is a label and stays an address, as does the GOT slot in a PLT thunk's
`JMP qword ptr [...]`. The address is kept on the token's title, and the
listing's **names** toggle turns the whole thing off when you want to compare
against another tool.

Design rules, if you extend it:

- `client.ts` is the only module that calls `fetch`. Components take data, not URLs.
- Server text is rendered as text -- tokenized into spans; nothing is ever
  passed to `{@html}`.
- Renames are resolved at render time, by address or by whole token. Never
  string-replace a listing.
- Lists page server-side. Never `limit=100000`.
- A `409` from a result endpoint means "analysis still running", not an error —
  `ApiError.notReady` marks it.

## Renaming

Ghidra calls things `FUN_00101250`, `DAT_00104010` and `local_128`, and reading
a binary means giving those names meaning. guttex lets you, and the new name
shows up **everywhere at once** -- function list, disassembly operands, both
graphs, xrefs, the decompiled C -- the way Cutter does it. ghidra-rest serves
analysis artifacts read-only, so the names are guttex's to keep.

Double-click a name in the decompiler, right-click one anywhere else, or press
`n` to rename the function you are looking at.

Names have two scopes, and the store keeps them apart:

| Scope | Key | Applies to |
|---|---|---|
| symbol | address | functions, data labels, jump labels — every view that mentions that address |
| local | (function entry, original identifier) | one function's `local_128`, `param_1`, `uVar3` |

`local_128` in one function has nothing to do with `local_128` in the next, so
a local rename must not leak between them; a function *is* its address, so a
symbol rename must reach everything that names it.

Renames are never applied by rewriting text. Views resolve them at render time:
by address wherever an address is in hand, otherwise by matching a **whole
token** against the original name. A blind string replace would hit substrings,
string literals and comments -- `main` inside `domain`, `puts` inside `fputs`
-- and there is no undo for a corrupted listing. Since ghidra-rest filters on
the names *it* knows, a filter that matches a rename is re-asked under Ghidra's
name and those rows are put in front, so searching for what you called
something finds it.

An identifier in the decompiler that resolves to a symbol -- a callee, or one
of Ghidra's auto names, which carry their own address -- also carries that
address, so right-clicking it offers open, copy link and the rest, not just
rename.

### Where the names live, and how they follow you

In `GUTTEX_PROJECTS`, one folder per binary:

```
/projects/<sha256 of the binary>/
    meta.json           name, timestamps, revision, last job id
    annotations.json    every rename
    ghidra-export.zip   the artifact set
```

Keyed by the binary's **sha256**, not by a job id. ghidra-rest mints job ids
from `crypto/rand`, so the same binary analysed on two machines has two ids and
a project keyed by one of them could never be carried to the other. The content
hash is the same everywhere, which is the whole trick: an imported project meets
its binary by itself.

A folder rather than a database, because the property that matters is that you
can copy one directory to another machine and carry on.

## Retyping

Renaming is guttex's opinion about a binary. A **prototype is not** — it changes
what the decompiler produces, so it has to go back into Ghidra.

Ghidra is conservative about signatures it never resolved, and stores them as
`undefined make_secret(void)`: `undefined` return, zero recorded parameters.
The decompiler window renders that `undefined` as `void`, while its *local*
analysis of the same function independently recovers a parameter out of `RDI`
and prints it. So the callee reads `void make_secret(long param_1)` and the
caller reads `local_f8 = make_secret(local_e5);` — two per-function guesses that
never consult each other, one of which is plainly wrong.

Press `f`, or hit **signature** in the decompiler header. The field takes C, the
same text Ghidra's *Edit Function Signature* dialog takes:

```
long make_secret(byte *secret)
```

| | |
| --- | --- |
| the name in the prototype | **ignored** — use rename for that |
| convention | a separate field, because Ghidra's C parser accepts `__cdecl` inside the text and then throws it away, leaving locked parameter storage with an `unknown` convention. That is what produces the decompiler's `parameter storage is locked` warning |
| reset | puts back what Ghidra said before your first edit |

The dialog blocks while it works, and says so. This is not a rename: ghidra-rest
re-opens the analysis project headless and runs the decompiler again, which
takes **tens of seconds**. Closing optimistically would leave the old C on
screen with nothing to show that anything was happening.

What comes back:

```c
long make_secret(byte *secret)
{
  long lVar1;
  long local_10;
  for (local_10 = 0; obf_bytes[local_10] != '\0'; local_10 = local_10 + 1) {
    secret[local_10] = obf_bytes[local_10] ^ 0xaa;
  }
  secret[0xc] = 0;
  lVar1 = hash(secret);
  return lVar1;
}
```

The casts collapse, the pointer arithmetic becomes indexing, and the dropped
return value comes back.

Callers are re-decompiled too, and guttex repaints them: a caller's C names the
callee's parameters and consumes its return value, so leaving it alone would put
stale text next to fresh text.

**Retypes do not live in the project folder.** Renames are keyed by the binary's
sha256 and travel with it; a retype lives inside that job's Ghidra project on
the server, which is not portable and not part of `ghidra-export.zip`. Exporting
a project carries your names, not your types.

It also needs the server to have kept that project — `GHIDRAREST_KEEP_PROJECT`,
on by default now. When it was off at analysis time the action is greyed out
with the reason, rather than failing once per click.

Full mechanism, prototype syntax and the HTTP API:
[docs/SIGNATURES.md](docs/SIGNATURES.md).

**Export** is one button and one file. `guttex-<name>.zip` holds `meta.json`,
`annotations.json` and the analysis artifacts together -- it is the project
folder, zipped, so `unzip -l` explains it without guttex. If the artifacts have
not been pulled from ghidra-rest yet, exporting pulls them on the way out.

That pull is why Export is a dialog and not a link: on a project whose artifacts
are still upstream, a plain download link looks inert for as long as the fetch
takes, and an inert button gets clicked ten times -- ten pulls. guttex runs one
export at a time, shows `exporting...` while the server packs and a real
progress bar once bytes are moving, and closes itself when the file reaches your
downloads. The server sends `content-length` so the bar means something.

The landing page has two ways in: **drop a binary** to analyse one, or **load a
project** to take a bundle back. A loaded project lands under its binary's hash,
so if this machine already has that binary the workbench opens straight onto it
with your names in place; if it does not, the names sit and wait for it.

Two devices stay in step without either being authoritative:

- **push** is debounced ~1.2s after your last edit, and the response is the
  merged document -- one round trip is both push and pull.
- **pull** runs every 15s while the tab is visible, and immediately when it
  becomes visible again. `If-None-Match` makes the quiet case a 304.
- **offline** is a normal state, not a failure. Edits stay in `localStorage`,
  the chip in the status bar says so, and the next successful tick carries them.

The merge rule is **per entry, later edit wins** -- never per document. Two
people renaming different functions in the same binary is the normal case, and
whole-file last-writer-wins would quietly throw one of them away. A removal is
written as a tombstone rather than a deleted key, or a device that had been
offline would resurrect the name on its next push.

## On a phone

The workbench is three docks, a splitter and a right-click menu. None of that
survives a 360px screen, so phones get their own route rather than a pile of
media queries bent over the desktop one: **`/mobile`** to pick or push a
binary, **`/mobile/<job id>`** to read it. `/j/<id>` is untouched.

Depth replaces docks. The first screen is the result lists — functions, info,
strings, symbols, imports, exports, types, memory — as two-line touch rows
instead of a five-column table you would have to scroll sideways. Tap a
function, or an entry point on the info tab, and the second screen opens with
the listing views: decompiler, disassembly, graph, details, hexdump, call
graph, info, plus any plugin panels.

Those views are the desktop components, unchanged — they read the same shared
session, so they do not care which front end mounted them. What changes is the
frame around them: tab bars scroll sideways as chips instead of folding into a
`⋯` menu, and rows are 54px.

The boundary between the two screens is `?a=`, the same URL state the desktop
uses for address history. So Android's back button leaves a function and lands
back on the list, at the row you tapped — the list stays mounted underneath
rather than refetching. Graphs pinch-zoom with two fingers and pan with one.

The `⋮` menu carries seek, export, and a link to the desktop UI for the same
job.

You do not have to know the route exists. Opening a job from the landing page
picks the front end by how much room the screen has --
`(max-width: 820px), (pointer: coarse) and (max-width: 1180px)` -- so a phone
lands on `/mobile/<id>` and a laptop on `/j/<id>`. It is a media query, not a
user-agent sniff: a desktop window dragged narrow has the same problem a phone
does, and the coarse-pointer arm catches tablets, which have the width but not
the mouse the splitters and the right-click menu assume. `device.job(id)` in
`state/device.svelte.ts` is the one place that decides; both front ends still
link to each other by hand, so the choice is never a trap.

## Plugins

guttex is a remote Ghidra and stops there. AI assistance, exporters, signature
matching — none of it is in the default build, because most people just want to
read a binary without an LLM in the loop. Those are plugins: installed by URL
from the card on the landing page, and nothing is enabled until you say so.

A plugin is an ES module with a default export — no build step, no bundler, no
dependency on this repo. It can add a centre tab (`host.addPanel`, you get a DOM
node and own it) and commands in the workbench actions menu (`host.addAction`),
and it reads the open job through a scoped, read-only API.

Two samples ship in `web/static/examples/` and install in one click:
`hello-plugin.js` (~30 lines) and `ai-explain.js`, which explains the selected
function via any OpenAI-compatible endpoint and defaults to a local Ollama.

Plugins are **not sandboxed** — a plugin is ordinary JavaScript in the page and
can reach the same-origin `/api` proxy, which carries your ghidra-rest token.
Install only what you trust. Full API and trust model:
[docs/PLUGINS.md](docs/PLUGINS.md), or `/plugins` in the running app.

## Related

- [ghidra-rest](https://github.com/onixldlc/ghidra-rest) — the analysis API this
  front end drives; its `docs/openapi.yaml` is the contract mirrored in
  `web/src/lib/api/types.ts`.
