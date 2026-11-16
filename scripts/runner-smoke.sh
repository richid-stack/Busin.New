#!/usr/bin/env bash
# Builds the cloud box worker image and checks it for real: it starts, runs a plan as an ordinary user, keeps its secret
# from the programs, uses the tools a plan may call, and restarts after the plan. Runs in CI (needs Docker).
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET="$(openssl rand -hex 24)"
IMAGE=openlobs-runner:smoke
NAME=openlobs-runner-smoke
fail() { echo "FAIL $1"; docker logs "$NAME" 2>&1 | tail -20 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; exit 1; }
pass() { echo "PASS $1"; }

docker build --progress=plain -f Dockerfile.runner -t "$IMAGE" . && pass "the image builds"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p 18080:8080 -e RUNNER_SECRET="$SECRET" "$IMAGE" >/dev/null

for i in $(seq 1 40); do curl -fs http://127.0.0.1:18080/health >/dev/null 2>&1 && break; sleep 0.5; done
curl -fs http://127.0.0.1:18080/health >/dev/null || fail "the worker did not start"
pass "the worker starts and answers /health"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:18080/run -d '{}')" = 401 ] || fail "a request with no secret was not turned away"
pass "a request with no secret is turned away"

PLAN='{"files":[{"path":"spy.js","content":"const fs=require(\"fs\");const o={uid:process.getuid(),home:process.env.HOME,env:Object.keys(process.env).includes(\"RUNNER_SECRET\"),cwd:process.cwd()};try{o.parent=fs.readFileSync(\"/proc/\"+process.ppid+\"/environ\",\"utf8\").includes(\"RUNNER_SECRET\")?\"READ\":\"empty\"}catch(e){o.parent=\"denied\"};try{fs.writeFileSync(\"/app/runner/x\",\"1\");o.writeApp=\"yes\"}catch(e){o.writeApp=\"no\"};console.log(JSON.stringify(o))"}],"steps":[{"program":"node","args":["spy.js"]},{"program":"python","args":["--version"]},{"program":"git","args":["--version"]},{"program":"npm","args":["--version"]},{"program":"pnpm","args":["--version"]},{"program":"yarn","args":["--version"]}]}'
OUT="$(curl -s -X POST http://127.0.0.1:18080/run -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d "$PLAN")"
echo "$OUT" | jq -c '{steps: [.steps[] | {n, exitCode, output: (.output|tostring|.[0:120])}], error}'

[ "$(echo "$OUT" | jq '[.steps[] | select(.exitCode == 0)] | length')" = 6 ] || fail "not every step ran (node, python, git, npm, pnpm, yarn)"
pass "node, python, git, npm, pnpm and yarn all run inside the image"
SPY="$(echo "$OUT" | jq -r '.steps[0].output' | tail -1)"
[ "$(echo "$SPY" | jq -r .uid)" = 10001 ] || fail "programs did not run as user 10001: $SPY"
pass "programs run as the ordinary user, not root"
[ "$(echo "$SPY" | jq -r .env)" = false ] || fail "the secret is in the program's environment"
[ "$(echo "$SPY" | jq -r .parent)" = denied ] || fail "a program could read the worker's process: $SPY"
pass "a program cannot see the worker's secret"
[ "$(echo "$SPY" | jq -r .writeApp)" = no ] || fail "a program could change the worker's own files"
pass "a program cannot change the worker's own files"
echo "$SPY" | jq -r .home | grep -q '^/tmp/box-' || fail "the home folder is not inside the throw-away folder: $SPY"
pass "the home folder sits inside the throw-away folder"

# The worker restarts after every plan: the container exits on its own.
for i in $(seq 1 30); do [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = false ] && break; sleep 0.5; done
[ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = false ] || fail "the worker did not restart after the plan"
pass "the worker exits after a plan, so the platform starts a fresh one"

docker rm -f "$NAME" >/dev/null
echo "all runner image checks passed"
