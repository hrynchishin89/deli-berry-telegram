#!/usr/bin/env bash
set -e
echo "Deli Berry Telegram Ready"
if [ ! -f .env ]; then
  echo "File .env not found. Creating it now..."
  npm run create:env
fi
npm install
npm run preflight
npm start
