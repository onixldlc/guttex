# Retyping functions

How to fix a wrong prototype in guttex, what actually happens when you do, and
where the change lives afterwards.

For the HTTP API behind it, see ghidra-rest's
[docs/SIGNATURES.md](https://github.com/onixldlc/ghidra-rest/blob/main/docs/SIGNATURES.md).

---

## The problem it solves

Ghidra guesses a prototype for every function it finds, and is conservative
about the ones it never resolved. Those are stored as:

```
undefined make_secret(void)
```

`undefined` return type, zero recorded parameters. Two things then happen that
look like a contradiction but are not:

- The decompiler window renders that stored `undefined` return as **`void`**.
- The decompiler's *local* analysis of the same function independently
  recovers a parameter out of `RDI` (`MOV [RBP-0x18], RDI`) and prints it as
  `long param_1` — a parameter the stored signature says does not exist.

So the callee reads:

```c
void make_secret(long param_1)
```

while the caller, analysed separately, reads:

```c
local_f8 = make_secret(local_e5);
```

A `void` function whose result gets assigned. Neither view is lying; they are
two independent per-function guesses that never consult each other. The
assembly settles it — `make_secret` ends `CALL hash; LEAVE; RET` with nothing
writing `RAX` in between, so it really does return `hash`'s value, and `main`
stores that into `[RBP-0xf0]` and compares it.

The same cause explains a pointer typed `long` in one function and `byte *` in
another: in `make_secret` it is only a base for byte stores, so it stays `long`
with a cast at each use; in `hash` it is walked directly, so it comes out
`byte *`. One pointer, two guesses, no shared type to disagree with.

Nothing changes until the **stored** signature does. That is what this is for.

---

## Using it

Select the function, then either:

- press **`f`** — Ghidra's key for the same dialog, or
- click **signature** in the decompiler header.

The field is prefilled with the prototype the function has now. It takes C —
exactly the text Ghidra's *Edit Function Signature* dialog takes:

```
long make_secret(byte *secret)
```

Enter applies. Escape closes.

### The rules

| | |
| --- | --- |
| **The function name is ignored.** | The parser needs one, but it is never applied. Renaming is guttex's own layer and a retype quietly renaming a function would fight it — use `n` or double-click for that. |
| **`void` means no parameters** | not an empty list. |
| **An unknown type is not rejected.** | Ghidra invents a placeholder for a name it has never seen and applies the signature anyway — the GUI does the same. `struct nonexistent_t *x` lands as return type `nonexistent_t *`, pointer intact. Read the prototype in the header after applying anyway: it is what Ghidra stored, not necessarily what you typed. Builtins (`undefined`, `undefined1`..`8`, `byte`, `word`, `dword`, `qword`, `code`) and anything analysis created behave normally. |
| **Malformed C does fail** | unbalanced parens, no return type — the parser's own message appears under the field and nothing is applied. |
| **Do not write `__cdecl` in the text.** | Use the convention field. |
| **Single line.** | Tabs and newlines are refused rather than mangled. |

### The convention field

Optional, and separate from the prototype on purpose. Ghidra's C parser
*accepts* `__cdecl` inside a signature and then discards it, which leaves a
function whose parameter storage is locked while its calling convention is
still `unknown` — and that is exactly the state that makes the decompiler
print:

```
/* WARNING: Unknown calling convention -- yet parameter storage is locked */
```

Set it here and the warning goes away. The dropdown offers only what this
program's compiler spec actually defines; on an x86-64 ELF that is

```
MSABI, __stdcall, __thiscall, processEntry, syscall
```

— note that `__cdecl` is *not* in it. Ghidra will store an unrecognised name
without complaint and then print `Unknown calling convention: __cdecl` over the
result, so guttex asks the server rather than guessing. A name the program does
not define is rejected with the list of ones it does, and **nothing is
applied**: the whole edit is one transaction.

Leave the field empty to leave the convention alone.

### Reset

Once a function has been retyped, the dialog shows what Ghidra said before your
first edit and offers **reset**, which puts it back.

It is a restore, not an undo. Ghidra has no undo across processes, so the
original prototype is recorded the first time you touch a function and re-applied
on reset. The types come back; their provenance does not — the restored
signature is stored as user-defined where the original may have been an
analyser guess.

---

## What it does under the hood

Everything else guttex shows is a read of files a finished analysis left on
disk. This is the one write.

```
you                  guttex                         ghidra-rest
 |  f / signature      |                                 |
 |-------------------->|                                 |
 |                     |  PUT .../function/10135e/signature
 |                     |-------------------------------->|
 |                     |                                 |  analyzeHeadless <job>/project
 |                     |                                 |    -process -noanalysis
 |                     |                                 |    -postScript ApplySignature.java
 |                     |                                 |
 |                     |         { ok, before, prototype, redecompiled[...] }
 |                     |<--------------------------------|
 |   repaint           |                                 |
 |<--------------------|                                 |
```

`-noanalysis` is the point: the analysis is already in the project, only the
decompiler needs to run again. It costs a JVM start plus a handful of
decompilations — tens of seconds, not the minutes a re-analysis would take.

**The dialog blocks while that happens, and counts the seconds.** It also
refuses a second edit while one is in flight. Closing optimistically would
leave the old C on screen with nothing to show that anything was happening,
and an impatient click would start another JVM.

### What gets repainted

The server re-decompiles the retyped function **and every caller of it**, and
reports them in `redecompiled`. guttex repaints them because a caller's C names
the callee's parameters and consumes its return value:

```c
// before, in main
make_secret(local_e5);
// after
local_f8 = make_secret(local_e5);
```

Leaving the caller alone would put stale text next to fresh text. Callers *of*
callers are not touched — their text refers only to their direct callee.

Internally that is `signer.rev`, a counter bumped once per applied edit. Views
that show decompiled text read it inside their fetch effect, and the route
re-reads the function entry, so the prototype in the header, the parameter list
and the return type all follow.

### The result

Before:

```c
void make_secret(long param_1)
{
  long local_10;
  for (local_10 = 0; obf_bytes[local_10] != '\0'; local_10 = local_10 + 1) {
    *(byte *)(local_10 + param_1) = obf_bytes[local_10] ^ 0xaa;
  }
  *(undefined1 *)(param_1 + 0xc) = 0;
  hash(param_1);
  return;
}
```

After `long make_secret(byte *secret)` with convention `__stdcall`:

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

The casts collapse, the pointer arithmetic becomes indexing, the dropped return
value comes back, and the warning is gone.

---

## Where it lives — and where it does not

This is the important difference from renaming.

| | renames | retypes |
| --- | --- | --- |
| stored in | `GUTTEX_PROJECTS/<sha256>/annotations.json` | the job's Ghidra project, on the ghidra-rest server |
| keyed by | the binary's sha256 | the job id |
| survives re-analysis | yes | no — a new job is a new project |
| in `ghidra-export.zip` | yes | no |
| syncs between your devices | yes | no |
| works offline | yes | no |

Renames are keyed by content hash precisely so they can be carried anywhere the
binary goes. A retype cannot work that way: it is a modification of a Ghidra
database that lives on the server, is not portable, and is not part of the
project export. **Exporting a project carries your names, not your types.**

If you resubmit the same binary and get a new job, the names come back
automatically and the prototypes do not.

## When it is not available

The **signature** action is greyed out with a reason when the analysis kept no
Ghidra project — that project directory is what gets re-opened, so without it
the job can be read but not changed.

It is controlled by `GHIDRAREST_KEEP_PROJECT` on the ghidra-rest side, which now
defaults to on for exactly this reason. Jobs analysed by an older build that
defaulted to off have to be resubmitted before they can be retyped.

## Limits

- Prototypes and calling conventions only. No struct editing, no local variable
  types, no data type creation.
- One retype at a time, across the whole server — each one is a JVM.
- No batching: retyping twenty functions is twenty round trips.
- `decompiled/index.json` keeps its pre-edit `length` values. Nothing reads it
  for correctness, but a raw artifact consumer should know.
