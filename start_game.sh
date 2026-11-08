#!/usr/bin/env bash
# 启动本地游戏服务（幂等）。用法: ./start_game.sh [端口]   停止: ./stop_game.sh
cd "$(dirname "$0")"
PORT="${1:-8077}"
if curl -sf "http://127.0.0.1:$PORT/index.html" >/dev/null; then echo "已在运行: http://localhost:$PORT/"; exit 0; fi
setsid nohup python3 -m http.server "$PORT" --bind 127.0.0.1 > .server.log 2>&1 &
echo $! > .server.pid
for i in $(seq 1 20); do curl -sf "http://127.0.0.1:$PORT/index.html" >/dev/null && break; sleep 0.3; done
echo "游戏已启动: http://localhost:$PORT/"
