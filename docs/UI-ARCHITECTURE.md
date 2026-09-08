# guttex UI — where the redundancy came from, and what was done about it

The UI counterpart to `ghidra-rest/docs/ARCHITECTURE.md`.

**Status: done.** The commit tree is removed (§0) and all four catalogues are in
(§4). `svelte-check` reports 0 errors and 0 warnings; the production build is
clean.

The problem this fixed: the UI was not badly written — almost every individual
file was reasonable — but **four things were described more than once, in more
than one place, with nothing forcing the copies to agree.** That is where the
redundant dropdowns came from, and where most of the bugginess came from too. A
"bug" here was usually two copies of one list that had drifted apart.

---

## 0. The commit tree is gone

It was parked behind `COMMITS = false` and still shipping. Removed rather than
left to rot: a half-wired feature has to be read and maintained by everyone
working near it and pays nothing back.

Deleted outright:

```
lib/commit.ts                                     lib/flags.ts
lib/components/CommitGraph.svelte                 lib/components/CommitChip.svelte
lib/state/history.svelte.ts                       lib/state/commitview.svelte.ts
lib/server/history.ts                             lib/server/rebuild.ts
routes/api/guttex/v1/projects/[id]/history/       .../[id]/rebuild/
```

`web/src` went from 17,760 to 15,974 lines.

Two things were deliberately kept, because they share a word with commits but
not a purpose:

- **`state/patcher.svelte.ts`** and the "rebuild" item in the title bar. This is
  the *in-place* rebuild — it writes patches into the job's existing Ghidra
  project and re-disassembles one function. It never creates a job.
- **`state/patchview.svelte.ts`**, the capstone overlay that shows patched bytes
  in the listing without asking Ghidra anything.

What went with the commit tree was `server/rebuild.ts`, a *different* rebuild:
it applied a commit's patches to a copy of the binary and submitted that copy as
a **new job**. Nothing called it — `store.rebuild()` had no caller — and it is
the behaviour the in-place patcher was written to replace.

One survivor was extracted rather than deleted: the `Op` type, now `lib/ops.ts`.
It is the "what changed" payload the rename store hands its watchers and never
had anything to do with commits.

Rollback, if the idea comes back: `.scratch/commits-rollback.tar.gz`
(gitignored) holds every deleted file. Most were never committed, so git cannot
return them. Delete the tarball once you are sure.

---

## 1. What was duplicated

### 1.1 The list of centre views, written twice, disagreeing

The desktop route and the phone route each declared a tab array and each wrote
its own `{#if}` chain under it. Adding one view meant editing **four** places.

They had already drifted: the phone had a `details` tab the desktop did not, and
because `details` is not a `CenterTab`, the route special-cased it —

```ts
if (v !== 'details') session.tab = v as CenterTab;
```

— while the effect above it mirrored `session.tab` back into `view`. Anything
that set a real tab silently threw you off `details`.

### 1.2 The list of result lists, written twice

`SideDock.svelte` declared seven kinds as **columns**; `mobile/lists.ts`
declared the same seven as **rows**. Same names, same fetchers, same fields, and
the same `memory` unpaged-array workaround with the comment copied verbatim into
both files.

### 1.3 Four menus hand-rolling the same open/close machinery

`TitleBar`, `ActionsMenu`, `ContextMenu`, `TabStrip` — each with its own
`addEventListener`/`removeEventListener` pair for outside-press and Escape.
`TitleBar` also carried two hand-rolled submenu booleans.

### 1.4 Four dialogs hand-rolling the same shell

`EditDialog`, `RenameDialog`, `SignatureDialog`, `ExportDialog`, all four with a
byte-identical backdrop and a near-identical box. Three wrote their own Escape
handler and they did not agree: `SignatureDialog` refused Escape while busy, but
its backdrop closed it anyway.

### 1.5 No list of what guttex can do

`renameSymbol` was invoked from three unrelated places, `exporter.run` from two,
`editAt` from exactly one — which is why editing bytes was reachable by
right-click and by nothing else. Each surface decided for itself what it
offered, so the phone sheet and the desktop menu overlapped without either being
a subset of the other.

---

## 2. Why it read as "buggy as hell"

Every item above had the same failure shape: two descriptions of one thing, and
no mechanism making them agree. Not crashes — a UI subtly wrong in one place and
right in another, which is harder to trust than an outright error. Fixing the
symptom never helped; it came back with the next feature.

---

## 3. What was already right, and was left alone

- **`ListPanel.svelte` + `columns.ts`.** A list as data, not markup. This was
  the model for everything below.
- **`plugins/host.svelte.ts` + `ActionsMenu`.** Plugin commands and panels were
  already a registry. The idea was in the codebase — it just had not been
  applied to guttex's own features.
- **The phone reusing desktop components.** Only the chrome was duplicated,
  never the views. That was the right call and it is what made this small.
- **Selection in `?a=`.** Address history is browser history.
- **`Splitter`, `scrollmem`, `viewport`, `asmtok`, `graph/*`.**

---

## 4. What was built: share the guts, not the layout

The rule:

> **Split every shared thing in two: the part that is the same on both screens
> (data, behaviour, when-it-applies) and the part that *is* the screen (layout,
> sizing, chrome). Share only the first. Let each platform own the second,
> completely.**

A phone dock is not a narrow desktop dock. A `columns[]` array wrapped in media
queries is worse than two layouts that share a fetcher. What the two platforms
genuinely have in common is *what exists* and *what it does* — never *how big it
is or where it sits*.

### 4.1 `lib/views.ts` — the view catalogue (68 lines)

One entry per centre view: id, label, component, and `at`, a position **per
screen**. The phone leads with the decompiler; the desktop leads with the
listing. Same catalogue, two orders, no second list to forget.

Both routes still write their own tab bar and container — `TabStrip` in a
`panel-head` on desktop, `Chips` in an `m-body` on the phone. What neither writes
any more is an `{#if}` chain.

`details` is now a declared phone-only entry with `centre: false`, so `isCentre()`
answers the question the `v !== 'details'` special case used to guess at.

### 4.2 `lib/lists.ts` — the list catalogue (259 lines)

Shared per entry: `fetch`, `empty`, `searchable`, `addr`. Per platform, side by
side in the same entry: `columns` for `ListPanel`, `row` for `MobileList`.

The two components stay separate with separate layouts. They stop owning two
separate copies of *which lists exist*. `SideDock.svelte` went from 170 lines to
44; `mobile/lists.ts` is gone.

Merging was lossless: the one apparent behaviour difference — desktop making
`types` rows clickable, the phone not — turned out to be no difference at all,
because `TypeEntry` carries no `address` field, so the desktop's generic
`addrOf` already returned `''`.

### 4.3 `lib/commands.ts` — the command catalogue (422 lines)

One entry per action: `run`, `when`, an optional `key`, an optional `group`.

Every menu is now a filter over this list. The desktop title bar is still a
dropdown with expanding groups; the phone is still a bottom sheet; the context
menu is still a context menu. They are not converging and are not meant to —
each filters and lays out its own way.

Two distinctions the catalogue makes that the old code did not:

- **`when` versus `busy`.** `when` false means the command does not apply and
  the surface omits it entirely. `busy` means it applies but something it needs
  is in flight, and the surface greys it out. A control that vanishes mid-action
  is worse than one that greys, because the thing you just pressed is where you
  are looking. This is what removed the clutter: `rebuild ▸ this function (no
  patches)` — a disabled row inside an expanded submenu inside a menu, to say
  there was nothing to do — is simply not drawn now.
- **`key` versus `hint`.** `key` binds; `hint` only prints a keycap next to a
  command another entry owns the key for. The context menu's `rename` shows `n`
  without claiming it.

Shortcuts moved out of the dialogs. `f` was owned by `SignatureDialog`, which
made a global key a property of a component that is usually not mounted; `n` was
owned by `RenameDialog` the same way. Both are in the catalogue, dispatched by
one `runKey` that also refuses to fire into an open dialog — a dialog is a mode,
and `n` inside the rename prompt is a letter.

**One behaviour fix fell out of this.** The phone's "export project" passed
`session.id` unconditionally; the desktop passed it only when the open job's
bytes are still the project's own. Now both use the same rule, so exporting from
a phone after an in-place patch no longer risks handing back the patched job as
the original.

### 4.4 `lib/actions/dismissable.ts` + `Scrim.svelte` (79 + 27 lines)

An **action**, not a component, because what the eight floating things share is
behaviour and not a look: Escape, outside-press, cleanup, and — for a menu
pinned to fixed coordinates — resize, blur and outside-scroll (`volatile`).

Every menu and dialog keeps its own box, width and position. `Scrim` is the one
piece of markup that genuinely was identical.

The `SignatureDialog` disagreement is fixed by construction: `enabled` is passed
once and governs Escape and the backdrop together.

---

## 5. Cost

`web/src` went 15,974 → 16,206 lines: **+232**.

Worth saying plainly rather than claiming a reduction. The catalogues cost more
lines than the duplication they replaced, because a declared entry with a
comment is longer than an inline `{#if}` branch. What was bought is that a view,
a list or a command is now **one entry in one file**, and cannot be half-added.

The build did shrink where it counts: the desktop route bundle went 33.3 → 27.9
kB and the phone route 12.2 → 8.9 kB, with the shared code deduped into one
chunk instead of compiled twice.

## 6. Verified by

`svelte-check` (0 errors, 0 warnings) and a clean production build, run in a
node container. **Not** click-tested in a browser — no runtime smoke test was
performed, so the first run is worth doing with the console open.

## 7. Still open

**Should the phone offer everything the desktop does?** The catalogue makes it
possible for the sheet to list "rebuild" and "export binary" — `on: ['sheet']`
is one word. Whether it *should* is a product call, and §4.3 is built so the
answer can be "no" per command without anything else changing.

## 8. Deliberately untouched

- The look. Colours, spacing, the Cutter arrangement.
- `graph/layout.ts` (974 lines) — one algorithm doing one job.
- `Decompiler.svelte` and `Disassembly.svelte` — big because rendering annotated
  code is fiddly, not because they do many jobs.
- `Decompiler`'s own "edit signature" button, which passes a name fallback the
  catalogue command does not have.
- The server. See `ghidra-rest/docs/ARCHITECTURE.md`.
