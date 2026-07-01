@echo off
echo Deli Berry Telegram Ready
if not exist .env (
  echo File .env not found. Creating it now...
  npm run create:env
)
npm install
npm run preflight
npm start
pause
