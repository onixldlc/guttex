# guttex plugins

guttex is a remote Ghidra: upload a binary, read the analysis. That is the whole
product. Anything past it -- AI assistance, exporters, signature matching, house
conventions -- is a plugin. Nothing ships enabled, and a stock guttex makes no
network request except to its own ghidra-rest.

The live version of this document is served by the app itself at `/plugins`, so
it always matches the build you are running. This copy is for reading in the
repo.

## Shape

A plugin is an ES module loaded from a URL at run time, with a default export.
No build step, no bundler, no dependency on guttex's `package.json`.

```js
export default {
  manifest: {
    id: 'my-plugin',          // unique, url-safe; namespaces tabs and settings
    name: 'my plugin',
    version: '1.0.0',
    description: 'what it does'
  },

  // Runs once on enable. Register synchronously.
  // Return a disposer for anything global you touched.
  activate(host) {
    host.addPanel({
      id: 'main',
      label: 'my panel',      // becomes a tab next to DISASSEMBLY
      mount(el, ctx) {
        el.textContent = 'selected: ' + ctx.addr;
        const off = ctx.onSelect((a) => { el.textContent = 'selected: ' + a; });
        return () => off();   // tab change / disable / job change
      }
    });

    host.addAction({
      id: 'ping',
      label: 'say the function name',
      needs: 'address',       // greyed out until something is selected
      run(ctx) { ctx.notify(ctx.fn?.name ?? 'not a function'); }
    });
  }
};
```

Serve it anywhere the browser can reach -- a file server, a raw gist URL, a
folder mounted into the container at `/usr/share/nginx/html/examples` -- and
paste the URL into the plugins card on the landing page. Cross-origin URLs need
CORS headers from whatever serves them.

TypeScript definitions for everything below live in
`web/src/lib/plugins/types.ts`.

## Extension points

| Point | What you get |
| --- | --- |
| `host.addPanel` | A tab in the centre view, peer to DISASSEMBLY / DECOMPILER / HEXDUMP / INFO. You get a DOM node and own everything inside it. |
| `host.addAction` | A command in the workbench's *actions* menu, run against the current selection. |

Both are stable. New points will be added rather than these changed.

## Context

```
ctx.jobId        string     open job id
ctx.job          Job|null   filename, status, size, language, timings
ctx.summary      Summary|null
ctx.addr         string     normalised selected address, '' if none
ctx.fn           FunctionEntry|null
ctx.read         ReadApi    read-only, bound to this job
ctx.select(addr)            navigate the workbench (also pushes browser history)
ctx.notify(msg, level?)     'info' | 'warn' | 'error' toast
ctx.settings                get / set / delete / all -- persisted JSON
ctx.onSelect(cb)            subscribe to selection; returns unsubscribe
```

`ctx.read` mirrors the calls the built-in views use. Paging arguments are
`{ limit, offset, q }`.

```
summary()  functions(p)  strings(p)  symbols(p)  imports(p)  exports(p)
types(p)   memory()      fn(addr)    decompile(addr)         disasm(addr)
disasmIndex(p)  decompiledIndex(p)   xrefs(addr)  hexdump(addr, len)  log(tail)
```

## Limits

- **No touching the built-in views.** No hooks into disassembly or decompiler
  rendering, no restyling the shell, no replacing the sidebar. Add a panel.
- **No writes to ghidra-rest.** No submitting jobs, no deleting, no renaming
  functions. Results are immutable artifacts on disk.
- **No persistence beyond this browser.** `ctx.settings` is localStorage. There
  is no server-side plugin storage and no guttex account.
- **No caching of plugin code.** Every activation re-fetches the URL. If it
  stops resolving, the plugin stops loading.
- **No background execution.** No workers, no scheduled tasks.

## Lifecycle

- `activate(host)` once per enable; may be async. A throw marks the plugin
  `error` and registers nothing.
- `mount(el, ctx)` per panel when its tab is first shown, and again after
  reload, disable/enable, or opening a different binary.
- The disposer from `mount` runs on tab change, disable, reload and job change.
- The disposer from `activate` runs on disable, reload and uninstall.

## Trust model

Plugins are **not sandboxed**. A plugin is ordinary JavaScript in the guttex
page, with everything that implies:

- It can call the same-origin `/api` proxy, which attaches your ghidra-rest
  token server-side. A plugin therefore reaches your entire ghidra-rest
  instance -- every job, not only the open one -- even though `ctx.read` itself
  is scoped and read-only.
- It can read and write every plugin's settings, including API keys another
  plugin stored.
- It can send anything it reads to any host that permits it, and it can modify
  the page.

Install only plugins whose source you trust or have read. Treat a plugin URL
like a shell command someone handed you. If you are analysing malware or client
binaries, assume an AI plugin uploads the decompiled code to whichever endpoint
you configured -- that is what it is for.

guttex itself never contacts anything but its own backend. That is the reason AI
is not in the default build.

## Examples

Both ship in `web/static/examples/` and install in one click from the plugins
card:

- `/examples/hello-plugin.js` -- panel + action, ~30 lines.
- `/examples/ai-explain.js` -- explains the selected function via any
  OpenAI-compatible `/chat/completions` endpoint. Defaults to a local Ollama, so
  nothing leaves the machine unless you point it elsewhere. Bring your own key.
  Ollama needs `OLLAMA_ORIGINS='*'` before a browser may call it.
