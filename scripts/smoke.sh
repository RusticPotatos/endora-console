#!/bin/sh
# Starts the image with no Core behind it and checks it serves its page, says so, and refuses
# what is not in the contract. Usage: scripts/smoke.sh <image>
set -eu
image="$1"
name="endora-console-smoke-$$"
docker run -d --name "$name" -p 127.0.0.1::8080 -e CORE_URL=http://core.invalid:8443 "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT
port=$(docker port "$name" 8080/tcp | head -1 | sed 's/.*://')
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$port/console/health" >/dev/null 2>&1 && break
  sleep 1
done
health=$(curl -fsS "http://127.0.0.1:$port/console/health")
echo "$health" | grep -q '"service":"endora-console"'
echo "$health" | grep -q '"reachable":false'
curl -fsS "http://127.0.0.1:$port/" | grep -q '/app.js?v='
test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/v1/runner/next")" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/v1/hq")" = 502
test "$(docker exec "$name" id -u)" != 0
for _ in $(seq 1 20); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$status" = healthy ] && break
  sleep 2
done
test "$status" = healthy
echo "smoke: $image serves its page, says Core is not reachable, refuses non-contract routes, runs unprivileged, and is healthy"
