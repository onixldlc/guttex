# guttex design notes

## Where the pieces sit

```
browser (Svelte SPA)
      |  same-origin /api/*    (no credentials in the bundle)
      v
guttex (SvelteKit, Node)
      |-- /api/guttex/*  -> its own project store, on a volume
      |-- /api/*         -> ghidra-rest, bearer token attached here
                              |
                              v
                   analyzeHeadless --> JSON artifacts on disk
```

One process. It serves the app, owns guttex's state and fronts the analyser.

There was an nginx in this diagram while the build was pure static, and briefly
a separate Go service when state arrived. Both were wrong: the moment guttex
needs to remember anything it needs a runtime, and it already has one. A second
language and a second process would have bought an extra image to keep in step
with nothing to show for it.

## Why the SPA never talks to ghidra-rest directly

1. The API token would have to live in the browser. It cannot.
2. ghidra-rest has no CORS layer, and adding one just to widen who can call it
   is the wrong direction.
3. Anything guttex remembers -- projects, renames, notes, bookmarks -- is guttex
   state, not ghidra-rest state. ghidra-rest is deliberately stateless past its
   artifact directory, and it should stay that way.

`$lib/server/*` makes (1) structural rather than a matter of discipline:
SvelteKit refuses to import those modules from client code, so the token and the
projects path cannot be shipped to a browser by accident.

## State: a folder, not a database

```
$GUTTEX_PROJECTS/<sha256 of the binary>/
    meta.json           name, timestamps, revision, rename count, last job id
    annotations.json    { symbols: {addr: entry}, locals: {"fn:ident": entry},
                          patches: {addr: {changes: "a1 a1 a1 a1"}} }
    ghidra-export.zip   ghidra-rest's artifact set
```

An entry is `{ from, to, at, by }`. `at` is the editing device's clock.

**The key is the binary's sha256, not the job id.** ghidra-rest mints job ids
from `crypto/rand`, so the same binary gets a different id on every instance --
a project keyed by one could never be opened on another machine. The content
hash is stable everywhere, so an exported project finds its binary by itself and
the job id becomes what it should be: this machine's handle, recorded in
`meta.json` and refreshed on open.

Export is the folder zipped (`lib/server/bundle.ts`, store-only entries, written
by hand -- less code than a dependency, and `unzip` reads it). Import merges by
the same rule as a sync push: a bundle is a very late device reporting what it
knows.

SQLite was the plan and is no longer. The property that actually matters is
portability: analyse on a 32-core box, copy one directory to a laptop, keep
working. A folder of JSON gives that for free, is greppable, diffable and needs
no migration story. If guttex ever grows real multi-user concurrency, the store
module is one file with a narrow interface -- a DB connector goes behind it
without the rest of the app noticing.

### Sync

Neither device is authoritative and both work offline, so this is not a
transaction. It is two documents and a merge rule.

- **Per entry, later `at` wins.** Never per document: two people renaming
  different functions in the same binary is the normal case, and whole-file
  last-writer-wins throws away whoever pushed second.
- **Removals are tombstones** (`to: ""`), not deleted keys. A device that was
  offline would otherwise resurrect a name on its next push.
- **Push is debounced**, and its response is the merged document, so one round
  trip is both directions. **Pull** polls with `If-None-Match`, so the quiet
  case costs a 304.
- Equal timestamps keep what is stored, which makes a replayed push a no-op and
  keeps pollers quiet.

Clock skew between devices is the known weakness. It is bounded by how wrong a
phone's clock is, and the failure mode is "the wrong one of your own two renames
won", not corruption. A vector clock would be the fix if that ever bites.

## Endpoint split

- `/api/v1/*` -- proxied to ghidra-rest untouched (results, logs, export).
- `/api/guttex/v1/projects...` -- projects, annotations, archive, export/import,
  and `/binary?variant=original|patched` -- the submitted binary back out, as-is
  or with the patch list applied to a copy in memory (`$lib/server/patchmap`
  turns Ghidra addresses into file offsets via the ELF/PE headers). The stored
  original is never modified.
- `/api/guttex/v1/asm` -- assemble or disassemble one patch's worth of code, for
  the editor's preview box. Keystone and Capstone are WASM and run inside the
  guttex Node process, so this is the one guttex endpoint that is neither a
  project nor a proxy. Ghidra has no assembler behind ghidra-rest, which is why
  it is here at all. A bad mnemonic answers `200 {ok:false,error}` -- it is the
  user talking to the assembler, not a fault.

What the editor stores is always hex: assembly typed into it is assembled first,
then written to `patches` as bytes. The patch log holds bytes and an address and
nothing else, so nothing in it needs an assembler to be read back.

The overlay is done in the client, not the server: results come from ghidra-rest
and names are resolved at render time, by address where an address is in hand
and otherwise by whole-token match. Merging server-side would mean re-serving
every artifact endpoint through guttex, which is a lot of proxy for a lookup the
browser can do in a map.

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
