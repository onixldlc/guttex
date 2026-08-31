import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// No proxy here any more. `/api/*` is a SvelteKit endpoint
// (`src/routes/api/[...path]/+server.ts`), so `npm run dev` runs the same
// forwarding code the container does -- there is no dev-only path left to
// drift from production.
//
// Point it at an analyser with a .env file, or the environment:
//
//     GHIDRAREST_URL=http://127.0.0.1:8090
//     GHIDRAREST_TOKEN=s3cret
//     GUTTEX_PROJECTS=./.projects
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');
	return {
		plugins: [sveltekit()],
		server: { port: Number(env.PORT || 5173) }
	};
});
