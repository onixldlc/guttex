// The smallest useful guttex plugin: one panel, one action.
//
// Install it from the plugins card with the URL /examples/hello-plugin.js, or
// copy this file, change the manifest id, and serve it from anywhere your
// browser can reach.

export default {
	manifest: {
		id: 'hello',
		name: 'hello',
		version: '1.0.0',
		description: 'shows the current selection; a template to copy from',
		author: 'guttex'
	},

	// Called once when the plugin is enabled. Register everything here.
	// Return a function to undo anything global you did.
	activate(host) {
		host.addPanel({
			id: 'hello',
			label: 'hello',

			// `el` is yours. Plain DOM -- no framework, no build step.
			mount(el, ctx) {
				const out = document.createElement('pre');
				out.style.cssText = 'margin:0;font:12px var(--mono);color:var(--fg)';
				el.append(out);

				const render = async () => {
					const lines = [
						`job     ${ctx.jobId || '(none)'}`,
						`file    ${ctx.job?.filename ?? '-'}`,
						`addr    ${ctx.addr || '(nothing selected)'}`,
						`fn      ${ctx.fn?.name ?? '-'}`
					];
					if (ctx.addr) {
						// Every ghidra-rest read is on ctx.read, already bound to this job.
						const listing = await ctx.read.disasm(ctx.addr).catch((e) => ({ error: e.message }));
						lines.push('', listing.error ? `disasm: ${listing.error}` : `instructions ${listing.instructions?.length ?? 0}`);
						for (const ins of listing.instructions?.slice(0, 12) ?? []) {
							lines.push(`  ${ins.address_display}  ${ins.text}`);
						}
					}
					out.textContent = lines.join('\n');
				};

				render();
				// Redraw whenever the user navigates. Unsubscribe in the disposer.
				const off = ctx.onSelect(render);
				return () => off();
			}
		});

		host.addAction({
			id: 'where-am-i',
			label: 'hello: where am I?',
			needs: 'address',
			run(ctx) {
				ctx.notify(`${ctx.fn?.name ?? 'no function'} @ ${ctx.addr}`);
			}
		});
	}
};
