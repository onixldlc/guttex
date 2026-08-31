import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		// Node, because guttex now has state to keep: the same server that hands
		// out the app also owns /api/guttex (projects and annotations) and
		// fronts ghidra-rest at /api with the token attached. One process, one
		// image, and the dev server runs exactly the same endpoint code.
		adapter: adapter({ out: 'build' }),
		prerender: { entries: [] },
		// Kit's built-in cross-site check compares the browser's Origin against
		// an origin it reconstructs -- and adapter-node, with no ORIGIN env set,
		// fills the protocol in as `https`. Served over plain http that rejects
		// the page's own uploads as cross-site.
		//
		// The check is replaced, not dropped: `src/hooks.server.ts` makes the
		// same comparison by host, without guessing a protocol, and applies it
		// to every mutating method instead of only form-shaped posts.
		csrf: { checkOrigin: false },
		alias: { $components: 'src/lib/components' }
	}
};
