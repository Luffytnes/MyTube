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

# Start backend
echo -e "${GREEN}Starting backend (FastAPI + yt-dlp) on port 8000...${NC}"
cd "$BACKEND"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
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
