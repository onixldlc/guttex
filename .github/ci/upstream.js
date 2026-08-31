// A stand-in for ghidra-rest, for the CI smoke test.
//
// guttex's contract at /api is narrow and worth proving on its own: the request
// reaches upstream, the path survives the rewrite, and the bearer token is
// attached *by the server* so it never has to exist in the bundle. None of
// that needs a 2GB Ghidra image to test -- it needs something that answers and
// reports what it was asked. That is this.
//
// Run it on the CI network and point GHIDRAREST_URL at it.

const http = require('node:http');

http
	.createServer((req, res) => {
		res.setHeader('content-type', 'application/json');
		res.end(
			JSON.stringify({
				status: 'ok',
				seen_path: req.url,
				seen_method: req.method,
				seen_auth: req.headers.authorization ?? '',
				seen_host: req.headers.host ?? ''
			})
		);
	})
	.listen(8080, '0.0.0.0', () => console.log('fake ghidra-rest on :8080'));
