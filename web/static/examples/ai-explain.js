// AI function explainer -- an example of the thing guttex deliberately does not
// ship. Nothing here is built in: the endpoint, the model and the key are
// yours, and no request leaves the browser until you press the button.
//
// Talks to any OpenAI-compatible /chat/completions endpoint. The default is a
// local Ollama, so out of the box nothing leaves the machine:
//
//   ollama serve                     # then set model to e.g. qwen2.5-coder
//   OLLAMA_ORIGINS='*' ollama serve  # needed so the browser may call it
//
// For a hosted provider, set endpoint + key in the panel. The key is stored in
// this browser's localStorage, which every other installed plugin can also
// read -- see the security section of /plugins.

const DEFAULTS = {
	endpoint: 'http://localhost:11434/v1/chat/completions',
	model: 'qwen2.5-coder:7b',
	key: '',
	prompt:
		'You are a reverse engineer. Explain what this decompiled function does, ' +
		'name its likely purpose, and flag anything security relevant. Be concise.'
};

function field(label, value, type = 'text') {
	const wrap = document.createElement('label');
	wrap.style.cssText = 'display:flex;gap:6px;align-items:center;font-size:11px;color:var(--fg-dim)';
	const input = document.createElement('input');
	input.type = type;
	input.value = value ?? '';
	input.style.cssText = 'flex:1 1 auto;min-width:0';
	wrap.append(label, input);
	return { wrap, input };
}

async function explain(cfg, code, name) {
	const res = await fetch(cfg.endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {})
		},
		body: JSON.stringify({
			model: cfg.model,
			stream: false,
			messages: [
				{ role: 'system', content: cfg.prompt },
				{ role: 'user', content: `Function ${name}:\n\n${code}` }
			]
		})
	});
	if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
	const body = await res.json();
	return body.choices?.[0]?.message?.content ?? JSON.stringify(body).slice(0, 2000);
}

export default {
	manifest: {
		id: 'ai-explain',
		name: 'ai explain',
		version: '1.0.0',
		description: 'explains the selected function with an LLM you supply',
		author: 'guttex'
	},

	activate(host) {
		const cfg = () => ({
			endpoint: host.settings.get('endpoint', DEFAULTS.endpoint),
			model: host.settings.get('model', DEFAULTS.model),
			key: host.settings.get('key', DEFAULTS.key),
			prompt: host.settings.get('prompt', DEFAULTS.prompt)
		});

		host.addPanel({
			id: 'explain',
			label: 'ai',
			mount(el, ctx) {
				const c = cfg();
				const bar = document.createElement('div');
				bar.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--border)';

				const ep = field('endpoint', c.endpoint);
				const md = field('model', c.model);
				const key = field('api key', c.key, 'password');
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;gap:8px;align-items:center';
				const go = document.createElement('button');
				go.textContent = 'explain selected function';
				const status = document.createElement('span');
				status.style.cssText = 'font-size:11px;color:var(--fg-dim)';
				row.append(go, status);
				bar.append(ep.wrap, md.wrap, key.wrap, row);

				const out = document.createElement('pre');
				out.style.cssText = 'margin:8px 0 0;white-space:pre-wrap;font:12px var(--mono);color:var(--fg)';
				el.append(bar, out);

				for (const [name, f] of [['endpoint', ep], ['model', md], ['key', key]]) {
					f.input.onchange = () => host.settings.set(name, f.input.value);
				}

				const setStatus = () => {
					status.textContent = ctx.addr ? `selected ${ctx.fn?.name ?? ctx.addr}` : 'select a function first';
					go.disabled = !ctx.addr;
				};
				setStatus();
				const off = ctx.onSelect(setStatus);

				go.onclick = async () => {
					if (!ctx.addr) return;
					go.disabled = true;
					status.textContent = 'decompiling...';
					try {
						const d = await ctx.read.decompile(ctx.addr);
						if (!d.ok || !d.c) throw new Error(d.error || 'no decompiled C for this address');
						status.textContent = 'asking the model...';
						out.textContent = await explain(
							{ ...cfg(), endpoint: ep.input.value, model: md.input.value, key: key.input.value },
							d.c,
							d.name || ctx.addr
						);
						status.textContent = 'done';
					} catch (e) {
						out.textContent = '';
						ctx.notify(e.message, 'error');
						status.textContent = 'failed';
					} finally {
						go.disabled = !ctx.addr;
					}
				};

				return () => off();
			}
		});

		host.addAction({
			id: 'explain',
			label: 'ai: explain this function',
			needs: 'address',
			async run(ctx) {
				ctx.notify('decompiling and asking the model...');
				const d = await ctx.read.decompile(ctx.addr);
				if (!d.ok || !d.c) throw new Error(d.error || 'no decompiled C for this address');
				const text = await explain(cfg(), d.c, d.name || ctx.addr);
				ctx.notify(text.slice(0, 400));
			}
		});
	}
};
