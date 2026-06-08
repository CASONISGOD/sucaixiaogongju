#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="${PID_FILE:-server-3000.pid}"

if [ ! -f "$PID_FILE" ]; then
  echo "未找到 PID 文件，服务可能未通过 scripts/devcloud-start.sh 启动。"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "服务未运行，已清理 PID 文件。"
  exit 0
fi

kill "$PID"
rm -f "$PID_FILE"
echo "服务已停止：PID=$PID"
