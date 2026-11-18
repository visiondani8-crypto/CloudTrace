#!/usr/bin/env bash
# ClipForge Studio — single local launch command.
#
#   ./clipforge.sh            install (first run), build the UI, start on http://127.0.0.1:8765
#   ./clipforge.sh dev        backend with auto-reload + Vite dev server on http://127.0.0.1:5173
#   ./clipforge.sh test       backend unit + video tests, frontend tests
#   ./clipforge.sh e2e        browser end-to-end workflow test (needs Playwright + Chromium)
#   ./clipforge.sh doctor     check dependencies
#
# Environment: CLIPFORGE_DATA_DIR (default ~/ClipForge), CLIPFORGE_PORT (default 8765),
#              CLIPFORGE_WHISPER_MODEL (model size name or local CTranslate2 model folder).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PORT="${CLIPFORGE_PORT:-8765}"
CMD="${1:-start}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
err() { printf "\033[31m%s\033[0m\n" "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

doctor() {
  local ok=1
  bold "ClipForge Studio — dependency check"
  if have ffmpeg && have ffprobe; then echo "  ✔ $(ffmpeg -version | head -1)"; else err "  ✘ FFmpeg missing — macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg"; ok=0; fi
  if have uv; then echo "  ✔ uv $(uv --version | awk '{print $2}')"; elif have python3; then echo "  ✔ $(python3 --version) (uv not found; will use venv + pip)"; else err "  ✘ Python 3.11+ missing — brew install python@3.12 (or install uv: brew install uv)"; ok=0; fi
  if have node && have npm; then echo "  ✔ node $(node --version)"; else err "  ✘ Node.js 20+ missing (needed to build the UI) — brew install node"; ok=0; fi
  if have ffmpeg; then
    local filters encoders
    filters="$(ffmpeg -hide_banner -filters 2>/dev/null || true)"
    encoders="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
    if [[ "$filters" == *" subtitles "* ]]; then echo "  ✔ libass (captions)"; else err "  ✘ FFmpeg built without libass — captions cannot be burned in (brew install ffmpeg includes it)"; ok=0; fi
    if [[ "$encoders" == *"h264_videotoolbox"* ]]; then echo "  ✔ VideoToolbox hardware encoding available"; fi
    if [[ "$encoders" != *"libx264"* ]]; then err "  ✘ FFmpeg built without libx264"; ok=0; fi
  fi
  [ "$ok" = 1 ] || { err "Install the missing dependencies, then run ./clipforge.sh again."; return 1; }
}

backend_env() {
  cd "$BACKEND"
  if have uv; then
    uv sync --quiet
    PY=(uv run python)
  else
    if [ ! -d .venv ]; then python3 -m venv .venv; fi
    .venv/bin/pip install --quiet --upgrade pip
    .venv/bin/pip install --quiet -e . pytest pytest-timeout scikit-image
    PY=(.venv/bin/python)
  fi
}

build_ui() {
  cd "$FRONTEND"
  if [ ! -d node_modules ]; then npm ci --no-audit --no-fund; fi
  local stamp="dist/.built"
  if [ ! -f "$stamp" ] || [ -n "$(find src index.html package.json -newer "$stamp" -print -quit 2>/dev/null)" ]; then
    bold "Building the interface…"
    npm run build --silent
    touch "$stamp"
  fi
}

case "$CMD" in
  doctor)
    doctor
    ;;
  start)
    doctor
    backend_env
    build_ui
    bold "Starting ClipForge Studio on http://127.0.0.1:$PORT"
    ( sleep 2; if [[ "${OSTYPE:-}" == darwin* ]]; then open "http://127.0.0.1:$PORT"; elif have xdg-open; then xdg-open "http://127.0.0.1:$PORT" >/dev/null 2>&1 || true; fi ) &
    cd "$BACKEND"
    exec "${PY[@]}" -m clipforge --port "$PORT"
    ;;
  dev)
    doctor
    backend_env
    cd "$FRONTEND"; [ -d node_modules ] || npm ci --no-audit --no-fund
    cd "$BACKEND"
    "${PY[@]}" -m clipforge --port "$PORT" --reload &
    BPID=$!
    trap 'kill $BPID 2>/dev/null' EXIT
    cd "$FRONTEND"
    CLIPFORGE_BACKEND="http://127.0.0.1:$PORT" npx vite
    ;;
  test)
    backend_env
    cd "$BACKEND"
    "${PY[@]}" -m pytest -q
    cd "$FRONTEND"; [ -d node_modules ] || npm ci --no-audit --no-fund
    npx tsc -b --noEmit
    npx vitest run
    ;;
  e2e)
    backend_env
    build_ui
    cd "$FRONTEND"
    node e2e/workflow.e2e.mjs
    ;;
  *)
    err "Unknown command: $CMD (use start | dev | test | e2e | doctor)"
    exit 2
    ;;
esac
