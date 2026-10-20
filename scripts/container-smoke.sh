#!/usr/bin/env bash
set -euo pipefail
container="school-smoke-${GITHUB_RUN_ID:-local}"
volume="${container}-data"
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then docker logs "$container" || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
key=$(openssl rand -base64 32)
docker run -d --name "$container" --read-only --tmpfs /tmp --cap-drop ALL \
  -e "SMS_ENCRYPTION_KEY=$key" --mount "source=$volume,target=/data" szkolnyalert:test >/dev/null
for attempt in {1..30}; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [ "$status" = healthy ]; then break; fi
  sleep 2
done
test "$status" = healthy
docker exec "$container" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFile } from "node:fs/promises";
  const initial = JSON.parse(await readFile("/data/app.json", "utf8"));
  assert.equal(initial.schools.length, 0);
  assert.equal(initial.users.length, 0);
  const response = await fetch("http://127.0.0.1:3001/api/register-school", {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({name:"Container smoke school",username:"smoke.admin",password:"SmokeTest1234567"})
  });
  assert.equal(response.status, 201);
  const saved = JSON.parse(await readFile("/data/app.json", "utf8"));
  assert.equal(saved.schools.length, 1);
  assert.equal(saved.users.length, 1);
  assert.equal(saved.sessions.length, 1);
'
docker stop --time 30 "$container" >/dev/null
docker start "$container" >/dev/null
for attempt in {1..30}; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [ "$status" = healthy ]; then break; fi
  sleep 2
done
test "$status" = healthy
docker exec "$container" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFile, readdir } from "node:fs/promises";
  const saved = JSON.parse(await readFile("/data/app.json", "utf8"));
  assert.equal(saved.schools[0].name, "Container smoke school");
  assert.equal(saved.users.length, 1);
  assert.equal(saved.sessions.length, 1);
  assert.ok((await readdir("/data/backups")).length > 0);
'
