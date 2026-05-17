#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env file found. Copying .env.example → .env"
  cp .env.example .env
  echo "Please edit .env and add your API keys, then re-run."
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Creating virtual environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo "Starting Social Media Scheduler on http://localhost:8000"
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
