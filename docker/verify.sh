#!/bin/sh
# Container healthcheck, and a standalone smoke test:
#   podman exec guttex /usr/local/bin/verify.sh
# Checks the app shell is served and, when reachable, that /api reaches
# ghidra-rest. A dead upstream is reported but does not fail the check -- the
# UI is still up and says so in the top bar.
set -eu

PORT="${GUTTEX_PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"

fetch() { wget -q -O - --timeout=5 "$1"; }

if ! fetch "$BASE/" | grep -q '<div'; then
	echo "verify: app shell not served at $BASE/" >&2
	exit 1
fi

# SPA fallback: a client route must return index.html, not 404
if ! fetch "$BASE/j/deadbeef" | grep -q '<div'; then
	echo "verify: SPA fallback broken for /j/<id>" >&2
	exit 1
fi

if fetch "$BASE/api/v1/health" 2>/dev/null | grep -q '"status"'; then
	echo "verify: ok (app shell, SPA fallback, ghidra-rest reachable)"
else
	echo "verify: ok (app shell, SPA fallback); ghidra-rest not reachable through /api"
fi
