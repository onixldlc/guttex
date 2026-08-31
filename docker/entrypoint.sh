#!/bin/sh
# Makes sure the projects volume is usable before the server starts, then hands
# off. Everything else guttex needs is read from the environment by SvelteKit at
# request time, so there is nothing to render or template here any more.
set -eu

PROJECTS="${GUTTEX_PROJECTS:-/projects}"
UPSTREAM="${GHIDRAREST_URL:-http://127.0.0.1:8080}"
TOKEN="${GHIDRAREST_TOKEN:-}"
PORT="${PORT:-8080}"

mkdir -p "$PROJECTS"

# A read-only or root-owned mount is the one failure that looks like a bug in
# the app rather than in the compose file, so say so plainly and stop.
if ! touch "$PROJECTS/.writable" 2>/dev/null; then
	echo "guttex: $PROJECTS is not writable by $(id -un) -- renames cannot be saved" >&2
	exit 1
fi
rm -f "$PROJECTS/.writable"

echo "guttex: serving on :${PORT}"
echo "guttex: /api -> ${UPSTREAM} (token: $([ -n "$TOKEN" ] && echo yes || echo no))"
echo "guttex: projects in ${PROJECTS}"

exec "$@"
