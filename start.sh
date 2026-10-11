#!/usr/bin/env bash
# Static preview server: build (copy) + serve dist/ in the foreground.
# Writes $OPENCODE_WEB_DIR/deployment-output.json for the controller.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
/usr/bin/time -p test -n "${PORT}"
/usr/bin/time -p mkdir -p dist
# Build when needed: source lives at ./index.html, output at ./dist/index.html.
/usr/bin/time -p bash -c 'if [ ! -f dist/index.html ]; then cp index.html dist/index.html; else if [ index.html -nt dist/index.html ]; then cp index.html dist/index.html; fi; fi'
/usr/bin/time -p test -f dist/index.html
/usr/bin/time -p test -f index.html
# Install step: no npm dependencies for this static build (timed no-op check).
/usr/bin/time -p bash -c 'if [ -f package.json ]; then npm install --no-audit --no-fund; else echo "no package.json, skipping npm install"; fi'
# Publish deployment output (project + absolute dist directory inside PROJECT_DIR).
/usr/bin/time -p node -e '
const fs = require("node:fs");
const path = require("node:path");
const project = process.cwd();
const directory = path.resolve(project, "dist");
if (!fs.existsSync(path.join(directory, "index.html"))) { console.error("Missing dist/index.html"); process.exit(1); }
const webDir = process.env.OPENCODE_WEB_DIR || "/home/runner/work/_temp/omgithub-web";
fs.mkdirSync(webDir, { recursive: true });
fs.writeFileSync(path.join(webDir, "deployment-output.json"), JSON.stringify({ project, directory }));
console.log("deployment-output: " + path.join(webDir, "deployment-output.json") + " -> " + directory);
'
# Serve in the foreground on PORT (uses only stdlib, no dependency install).
/usr/bin/time -p python3 -c 'import sys; print("serving dist on port " + (sys.argv[1] if len(sys.argv) > 1 else "?"))' "$PORT"
exec /usr/bin/time -p python3 -m http.server "$PORT" --directory dist --bind 0.0.0.0
