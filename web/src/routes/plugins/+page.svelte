<script lang="ts">
	// Plugin documentation, served by the app itself so it matches the build you
	// are running. Code samples live in the script block: Svelte would otherwise
	// read `{` in a template as an expression.
	const minimal = [
		"export default {",
		"  manifest: {",
		"    id: 'my-plugin',          // unique, url-safe, namespaces tabs + settings",
		"    name: 'my plugin',",
		"    version: '1.0.0',",
		"    description: 'what it does',",
		"  },",
		"",
		"  // Runs once on enable. Register synchronously.",
		"  // Return a disposer for anything global you touched.",
		"  activate(host) {",
		"    host.addPanel({",
		"      id: 'main',",
		"      label: 'my panel',       // becomes a tab next to DISASSEMBLY",
		"      mount(el, ctx) {",
		"        el.textContent = 'selected: ' + ctx.addr;",
		"        const off = ctx.onSelect(a => { el.textContent = 'selected: ' + a; });",
		"        return () => off();    // runs on tab change / disable / job change",
		"      }",
		"    });",
		"",
		"    host.addAction({",
		"      id: 'ping',",
		"      label: 'say the function name',",
		"      needs: 'address',        // greyed out until something is selected",
		"      run(ctx) { ctx.notify(ctx.fn?.name ?? 'not a function'); }",
		"    });",
		"  }",
		"};"
	].join('\n');

	const reads = [
		"await ctx.read.summary()                 // counts, arch, entry point",
		"await ctx.read.functions({ limit: 200, offset: 0, q: 'main' })",
		"await ctx.read.strings(p)  .symbols(p)  .imports(p)  .exports(p)  .types(p)",
		"await ctx.read.memory()                  // bare array, unpaged",
		"await ctx.read.fn(addr)                  // one function's metadata",
		"await ctx.read.decompile(addr)           // { ok, c, signature, error }",
		"await ctx.read.disasm(addr)              // { instructions: [...], truncated }",
		"await ctx.read.disasmIndex(p)  .decompiledIndex(p)",
		"await ctx.read.xrefs(addr)",
		"await ctx.read.hexdump(addr, 256)",
		"await ctx.read.log(400)                  // ghidra headless log tail"
	].join('\n');

	const ctxRef = [
		"ctx.jobId        string     open job id",
		"ctx.job          Job|null   filename, status, size, language, timings",
		"ctx.summary      Summary|null",
		"ctx.addr         string     normalised selected address, '' if none",
		"ctx.fn           FunctionEntry|null",
		"ctx.read         ReadApi    see above -- read-only, bound to this job",
		"ctx.select(addr)            navigate the workbench (also pushes history)",
		"ctx.notify(msg, level?)     'info' | 'warn' | 'error' toast",
		"ctx.settings                get / set / delete / all -- persisted JSON",
		"ctx.onSelect(cb)            subscribe to selection; returns unsubscribe"
	].join('\n');
</script>

<header class="bar">
	<a class="brand" href="/">guttex</a>
	<span class="dim">plugins</span>
	<span class="spacer"></span>
	<a href="/">back to jobs</a>
</header>

<main>
	<article>
		<h1>Writing a guttex plugin</h1>
		<p class="lead">
			guttex is a remote Ghidra: upload a binary, read the analysis. That is the whole product, and
			it stays that way. Anything beyond it -- AI assistance, exporters, signature matching, your
			team's conventions -- is a plugin. Nothing ships enabled, and a stock guttex makes no network
			request except to its own ghidra-rest.
		</p>

		<h2>What a plugin is</h2>
		<p>
			An ES module, loaded from a URL at run time, with a default export. No build step, no
			bundler, no dependency on guttex's package.json. Change the file, hit <em>reload</em> on the
			plugins card, and the new code is live.
		</p>
		<pre>{minimal}</pre>
		<p>
			Save that anywhere your browser can reach it -- a file server, a gist raw URL, a folder
			mounted into the container at <code>/usr/share/nginx/html/examples</code> -- and paste the URL
			into the plugins card. Cross-origin URLs need CORS headers from the host serving them.
		</p>

		<h2>How deep the modding goes</h2>
		<p>Two extension points today. Both are stable; more will be added rather than these changed.</p>
		<table class="ref">
			<thead>
				<tr><th>Point</th><th>What you get</th></tr>
			</thead>
			<tbody>
				<tr>
					<td><code>host.addPanel</code></td>
					<td>
						A tab in the centre view, peer to DISASSEMBLY / DECOMPILER / HEXDUMP / INFO. You are
						handed a DOM node and own everything inside it -- any markup, any styling, any
						library you load yourself.
					</td>
				</tr>
				<tr>
					<td><code>host.addAction</code></td>
					<td>
						A command in the workbench's <em>actions</em> menu, run against the current
						selection. Use for one-shot work with no UI of its own.
					</td>
				</tr>
			</tbody>
		</table>

		<h3>What you can reach</h3>
		<pre>{ctxRef}</pre>
		<p>
			Reads are the same calls the built-in views use, already bound to the open job. Paging
			arguments are <code>{'{ limit, offset, q }'}</code>.
		</p>
		<pre>{reads}</pre>

		<h3>What you cannot do</h3>
		<ul>
			<li>
				<strong>Change the built-in views.</strong> No hooks into the disassembly or decompiler
				rendering, no restyling the shell, no replacing the sidebar. Add your own panel instead.
			</li>
			<li>
				<strong>Write to ghidra-rest.</strong> <code>ctx.read</code> is read-only: no submitting
				jobs, no deleting them, no renaming functions. Analysis results are immutable artifacts on
				disk, so there is nothing to write back to yet.
			</li>
			<li>
				<strong>Persist anywhere but this browser.</strong> <code>ctx.settings</code> is
				localStorage. There is no server-side plugin storage, and no guttex account.
			</li>
			<li>
				<strong>Survive a reload without being re-fetched.</strong> Plugin code is never cached by
				guttex. If the URL stops resolving, the plugin stops loading.
			</li>
			<li>
				<strong>Run when guttex is closed.</strong> No background workers, no scheduled tasks.
			</li>
		</ul>

		<h3>Lifecycle</h3>
		<ul>
			<li><code>activate(host)</code> once per enable. May be async. Errors mark the plugin <em>error</em> and register nothing.</li>
			<li><code>mount(el, ctx)</code> per panel, when its tab is first shown, and again after a reload, a disable/enable, or opening a different binary.</li>
			<li>The disposer returned by <code>mount</code> runs on tab change, disable, reload, and job change. Unsubscribe there.</li>
			<li>The disposer returned by <code>activate</code> runs on disable, reload and uninstall.</li>
		</ul>

		<h2 class="danger">Trust model</h2>
		<p class="danger-body">
			Plugins are not sandboxed. A plugin runs as ordinary JavaScript in the guttex page, with
			everything that implies:
		</p>
		<ul class="danger-body">
			<li>
				It can call the same-origin <code>/api</code> proxy, which attaches your ghidra-rest token
				server-side. A plugin therefore reaches your whole ghidra-rest instance -- every job, not
				just the open one -- even though <code>ctx.read</code> itself is scoped and read-only.
			</li>
			<li>It can read and write every plugin's settings, including API keys stored by another plugin.</li>
			<li>It can send anything it reads to any host that permits it, and it can modify the page.</li>
		</ul>
		<p class="danger-body">
			Install only plugins whose source you trust or have read. Treat a plugin URL exactly like a
			shell command someone handed you. If you are analysing malware or client binaries, assume an
			AI plugin uploads the decompiled code to whichever endpoint you configured -- that is its job.
		</p>
		<p>
			guttex itself never contacts anything but its own backend, which is the point of keeping AI
			out of the default build.
		</p>

		<h2>Examples</h2>
		<ul>
			<li>
				<a href="/examples/hello-plugin.js"><code>/examples/hello-plugin.js</code></a> -- panel +
				action, about 30 lines.
			</li>
			<li>
				<a href="/examples/ai-explain.js"><code>/examples/ai-explain.js</code></a> -- explains the
				selected function with an OpenAI-compatible endpoint. Defaults to a local Ollama, so
				nothing leaves the machine unless you point it elsewhere. Bring your own key.
			</li>
		</ul>
		<p>Both are installable in one click from the <a href="/">plugins card</a>.</p>
	</article>
</main>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 38px;
		flex: 0 0 38px;
		padding: 0 12px;
		background: var(--bg-head);
		border-bottom: 1px solid var(--border);
		font-size: 12px;
	}
	.brand {
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--fg);
		text-decoration: none;
	}
	main {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 24px 20px 60px;
	}
	article {
		max-width: 860px;
		margin: 0 auto;
		line-height: 1.6;
	}
	h1 {
		font-size: 20px;
		margin: 0 0 12px;
	}
	h2 {
		font-size: 15px;
		margin: 28px 0 8px;
		padding-bottom: 5px;
		border-bottom: 1px solid var(--border);
	}
	h3 {
		font-size: 13px;
		margin: 20px 0 6px;
		color: var(--fg-dim);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	p,
	li {
		font-size: 13px;
	}
	.lead {
		color: var(--fg-dim);
	}
	pre {
		background: var(--bg-input);
		border: 1px solid var(--border-soft);
		border-radius: 4px;
		padding: 10px 12px;
		overflow-x: auto;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.5;
	}
	code {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--syn-key);
	}
	table.ref {
		width: 100%;
		border-collapse: collapse;
		margin: 8px 0;
	}
	table.ref th,
	table.ref td {
		text-align: left;
		vertical-align: top;
		padding: 7px 10px;
		border: 1px solid var(--border-soft);
		font-size: 13px;
	}
	table.ref th {
		background: var(--bg-head);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-dim);
	}
	ul {
		padding-left: 20px;
	}
	li {
		margin: 5px 0;
	}
	h2.danger {
		border-bottom-color: var(--warn);
		color: var(--warn);
	}
	.danger-body {
		color: var(--fg);
	}
</style>
