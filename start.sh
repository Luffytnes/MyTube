#!/bin/bash
# MyTube - Start backend + frontend

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "  __  __      _____      _          "
echo " |  \/  |_   |_   _|   | |__   ___ "
echo " | |\/| | | | || |_   | '_ \ / _ \\"
echo " | |  | | |_| || |_   | |_) |  __/"
echo " |_|  |_|\__, ||_|    |_.__/ \___|"
echo "          |___/                    "
echo -e "${NC}"
echo -e "${GREEN}Privacy-focused YouTube frontend${NC}"
echo ""

# Kill any existing processes on ports 8000 and 3000
echo -e "${YELLOW}Cleaning up existing processes...${NC}"
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

# Backend dependencies live in a project-local virtualenv (nothing installed
# system-wide); reinstalled whenever requirements.txt changes (e.g. git pull)
VENV="$BACKEND/.venv"
STAMP="$VENV/.requirements-installed"
if [ ! -x "$VENV/bin/python" ]; then
  PY=""
  for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" > /dev/null 2>&1 \
      && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
      PY="$candidate"
      break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Python 3.11+ is required for the backend." >&2
    exit 1
  fi
  echo -e "${YELLOW}Creating backend virtualenv with $PY...${NC}"
  "$PY" -m venv "$VENV"
fi
if [ ! -f "$STAMP" ] || [ "$BACKEND/requirements.txt" -nt "$STAMP" ]; then
  echo -e "${YELLOW}Installing backend dependencies...${NC}"
  "$VENV/bin/pip" install --no-cache-dir --disable-pip-version-check -q -r "$BACKEND/requirements.txt"
  touch "$STAMP"
fi

# Frontend dependencies, refreshed when the lockfile changes
if [ ! -d "$FRONTEND/node_modules" ] || [ "$FRONTEND/package-lock.json" -nt "$FRONTEND/node_modules/.package-lock.json" ]; then
  echo -e "${YELLOW}Installing frontend dependencies...${NC}"
  (cd "$FRONTEND" && npm install --no-fund --no-audit)
fi

# Start backend
echo -e "${GREEN}Starting backend (FastAPI + yt-dlp) on port 8000...${NC}"
cd "$BACKEND"
"$VENV/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Wait for backend to be ready
echo -n "Waiting for backend"
for _ in $(seq 1 30); do
  if curl -s http://localhost:8000/docs > /dev/null 2>&1; then
    echo -e " ${GREEN}ready!${NC}"
    break
  fi
  echo -n "."
  sleep 1
done

# Start frontend
echo -e "${GREEN}Starting frontend (Next.js) on port 3000...${NC}"
cd "$FRONTEND"
npm run dev &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}MyTube is running!${NC}"
echo -e "  Frontend: ${BLUE}http://localhost:3000${NC}"
echo -e "  Backend:  ${BLUE}http://localhost:8000${NC}"
echo -e "  API docs: ${BLUE}http://localhost:8000/docs${NC}"
echo ""
echo "Press Ctrl+C to stop all services."

# Wait and cleanup on exit
_stop() {
    echo ''
    echo 'Stopping MyTube...'
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    exit 0
}
trap _stop INT TERM

wait $FRONTEND_PID
