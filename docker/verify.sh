#!/bin/sh
# Container healthcheck, and a standalone smoke test:
#   podman exec guttex /usr/local/bin/verify.sh
#
# Checks the app shell is served, that client-side routes fall back to it, that
# the project store answers, and that a write from the app's own origin is
# accepted while one from a foreign origin is not. A dead ghidra-rest is
# reported but does not fail the check -- the UI is still up and says so in the
# top bar. A dead project store does fail it: without it, renames stop syncing.
set -eu

PORT="${PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"

# node is the one interpreter this image is guaranteed to have
fetch() {
	node -e '
		const url = process.argv[1];
		const t = setTimeout(() => { console.error("timeout"); process.exit(1); }, 5000);
		fetch(url).then(async (r) => {
			clearTimeout(t);
			process.stdout.write(await r.text());
			process.exit(r.ok ? 0 : 1);
		}).catch((e) => { console.error(String(e)); process.exit(1); });
	' "$1"
}

# Status of a POST carrying an Origin, which is what a browser sends. The body
# is multipart, the same shape as an upload: that is the shape a framework-level
# cross-site check singles out, so it is the shape worth probing.
post_status() {
	node -e '
		const [url, origin] = process.argv.slice(1);
		const t = setTimeout(() => { console.log("timeout"); process.exit(0); }, 5000);
		const form = new FormData();
		form.append("probe", "1");
		fetch(url, { method: "POST", headers: { origin }, body: form })
			.then((r) => { clearTimeout(t); console.log(r.status); })
			.catch((e) => { clearTimeout(t); console.log(String(e)); });
	' "$1" "$2"
}

if ! fetch "$BASE/" | grep -q '<div'; then
	echo "verify: app shell not served at $BASE/" >&2
	exit 1
fi

# SPA route: /j/<id> is not a file and must still answer with the shell
if ! fetch "$BASE/j/deadbeef" | grep -q '<div'; then
	echo "verify: client route /j/<id> did not return the app shell" >&2
	exit 1
fi

if ! fetch "$BASE/api/guttex/v1/health" | grep -q '"projects"'; then
	echo "verify: project store not answering at $BASE/api/guttex/v1/health" >&2
	exit 1
fi

# The origin rule, both directions. This is here because getting it wrong is
# silent: every read keeps working and only uploads die, which reads as a broken
# analyser rather than a rejected request.
#
# The probe is a POST to a route that does not exist. The origin check runs
# before routing, so a foreign origin still gets 403 while the app's own origin
# falls through to 404 -- the rule is proved in both directions and the store is
# left untouched. Probing a real endpoint would have the healthcheck writing a
# junk project into the volume every time it ran.
PROBE="$BASE/api/guttex/v1/__verify"

SAME="$(post_status "$PROBE" "$BASE")"
if [ "$SAME" = "403" ]; then
	echo "verify: same-origin POST refused -- the app cannot post to itself" >&2
	exit 1
fi

CROSS="$(post_status "$PROBE" "http://cross.invalid")"
if [ "$CROSS" != "403" ]; then
	echo "verify: cross-origin POST was not refused (got $CROSS)" >&2
	exit 1
fi

if fetch "$BASE/api/v1/health" 2>/dev/null | grep -q '"status"'; then
	echo "verify: ok (app shell, client routes, project store, origin rule, ghidra-rest reachable)"
else
	echo "verify: ok (app shell, client routes, project store, origin rule); ghidra-rest not reachable through /api"
fi
