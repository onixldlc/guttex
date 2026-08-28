#!/bin/sh
# Renders the nginx config from its template into an ephemeral run dir, then
# hands off to nginx. The image ships the template; the resolved config only
# ever exists for the life of the container.
set -eu

RUNDIR="${GUTTEX_RUNDIR:-/tmp/guttex}"
TEMPLATE="${GUTTEX_TEMPLATE:-/etc/guttex/nginx.conf.template}"
LISTEN_PORT="${GUTTEX_PORT:-8080}"
MAX_UPLOAD="${GUTTEX_MAX_UPLOAD:-1024m}"
UPSTREAM="${GHIDRAREST_URL:-http://127.0.0.1:8080}"
TOKEN="${GHIDRAREST_TOKEN:-}"

# strip one trailing slash so proxy_pass gets exactly one
UPSTREAM="${UPSTREAM%/}"

rm -rf "$RUNDIR"
mkdir -p "$RUNDIR" "$RUNDIR/client_body" "$RUNDIR/proxy" "$RUNDIR/fastcgi" "$RUNDIR/uwsgi" "$RUNDIR/scgi"

# Written, not sed-substituted: a URL or token containing sed metacharacters
# would otherwise corrupt the config.
{
	printf 'proxy_pass %s/;\n' "$UPSTREAM"
	if [ -n "$TOKEN" ]; then
		printf 'proxy_set_header Authorization "Bearer %s";\n' "$TOKEN"
	else
		# drop whatever the browser sent; this proxy owns the credential
		printf 'proxy_set_header Authorization "";\n'
	fi
} > "$RUNDIR/proxy-upstream.conf"

sed \
	-e "s|__RUNDIR__|${RUNDIR}|g" \
	-e "s|__LISTEN_PORT__|${LISTEN_PORT}|g" \
	-e "s|__MAX_UPLOAD__|${MAX_UPLOAD}|g" \
	"$TEMPLATE" > "$RUNDIR/nginx.conf"

nginx -t -c "$RUNDIR/nginx.conf"

echo "guttex: serving on :${LISTEN_PORT}, /api -> ${UPSTREAM} (token: $([ -n "$TOKEN" ] && echo yes || echo no))"

exec "$@"
