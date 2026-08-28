import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// Pure SPA. `build/` is a folder of static files the guttex backend can
		// embed and serve, with index.html as the catch-all for client routes.
		adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: false }),
		prerender: { entries: [] },
		alias: { $components: 'src/lib/components' }
	}
};
