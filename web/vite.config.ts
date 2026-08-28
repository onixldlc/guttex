import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, '.', '');

	// Dev-only shim for the guttex backend, which does not exist yet: proxy
	// /api/* straight at a ghidra-rest instance. The token stays server-side in
	// the vite process, so it is never shipped to the browser -- same contract
	// the real backend will honour.
	const upstream = env.GHIDRAREST_URL || 'http://127.0.0.1:8080';
	const token = env.GHIDRAREST_TOKEN || '';

	return {
		plugins: [sveltekit()],
		server: {
			port: Number(env.PORT || 5173),
			proxy: {
				'/api': {
					target: upstream,
					changeOrigin: true,
					rewrite: (p: string) => p.replace(/^\/api/, ''),
					configure: (proxy) => {
						proxy.on('proxyReq', (proxyReq) => {
							if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`);
						});
					}
				}
			}
		}
	};
});
