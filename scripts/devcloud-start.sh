#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="${PID_FILE:-server-3000.pid}"
LOG_DIR="${LOG_DIR:-logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/server.log}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"

if [ ! -f server/.env ]; then
  echo "缺少 server/.env，请先执行：cp server/.env.example server/.env，并填入真实 GPT_IMAGE2_API_KEY。" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "服务已在运行：PID=$OLD_PID"
    exit 0
  fi
fi

nohup env HOST="$HOST" PORT="$PORT" node server/index.js > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "服务已启动：PID=$(cat "$PID_FILE")"
echo "日志：$LOG_FILE"
echo "健康检查：http://127.0.0.1:$PORT/api/health"
