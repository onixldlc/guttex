# guttex design notes

## Where the pieces sit

```
browser (Svelte SPA)
      |  same-origin /api/*    (no credentials in the bundle)
      v
guttex backend            <-- does not exist yet
      |  bearer token
      v
ghidra-rest  --> analyzeHeadless --> JSON artifacts on disk
```

Today the middle box is a stand-in: `vite.config.ts` proxies `/api/*` straight
at ghidra-rest and adds the `Authorization` header in the dev server process.
Every path the SPA calls is a ghidra-rest path, so when the real backend lands
it can pass unknown `/api/v1/*` requests straight through and only intercept
what it owns.

## Why the SPA never talks to ghidra-rest directly

1. The API token would have to live in the browser. It cannot.
2. ghidra-rest has no CORS layer, and adding one just to widen who can call it
   is the wrong direction.
3. Anything guttex remembers — projects, renames, notes, bookmarks — is guttex
   state, not ghidra-rest state. ghidra-rest is deliberately stateless past its
   artifact directory, and it should stay that way.

## Backend, when we get to it

Unresolved, but the constraints are already clear:

- **Language: Go.** Matches ghidra-rest, single static binary, and
  `embed.FS` can serve `web/build` so deployment stays one artifact.
- **DB: SQLite first.** Single-node lab tool, WAL mode, no server to run. The
  schema below is plain enough to move to Postgres later if guttex ever grows
  multiple users.
- **The backend owns what ghidra-rest refuses to.** ghidra-rest keys everything
  by job id and forgets the rest. guttex adds identity and edits on top.

Sketch of the tables:

| table | holds |
|---|---|
| `project` | a named workspace; groups binaries |
| `binary` | sha256, original filename, size, the ghidra-rest job id, cached summary fields |
| `annotation` | (binary, address, kind, value) — user renames, comments, bookmarks, tags |
| `note` | free markdown per binary or per address |
| `job_event` | status transitions, so the queue view survives a backend restart |

Endpoint split, once it exists:

- `/api/v1/*` — proxied to ghidra-rest untouched (results, logs, export).
- `/api/guttex/*` — projects, annotations, notes, search across binaries.

The overlay rule: results come from ghidra-rest, annotations come from the DB,
the backend merges them on read so the SPA sees one object with a user-supplied
`name` winning over Ghidra's `FUN_00101234`.

## Things the frontend already assumes

- Addresses are normalised the way ghidra-rest normalises them (`format.ts:normAddr`),
  so a name from the DB and an address from an artifact key the same.
- `409` from any result endpoint = not analysed yet. Any future backend must
  keep that status meaning.
- Lists are server-paged with `q`/`limit`/`offset`. Annotation search must page
  the same way or `ListPanel` needs rewriting.

## Later (ideas, not commitments)

Ideas that motivated "extended" in the name, parked until the backend exists:
call-graph view, diffing two binaries by function hash, cross-binary string
search, saved queries, and a patch/annotate round trip back into a Ghidra
project.
