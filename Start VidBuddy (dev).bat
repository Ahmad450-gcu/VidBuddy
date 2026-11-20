@echo off
rem Double-click to start the local test servers (backend on 8000, app on 5173) and open the app.
rem Uses its own test data folder (data-dev), separate from the installed VidBuddy.
title VidBuddy dev
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
  echo The backend isn't set up yet: backend\.venv is missing.
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo Installing the app's packages the first time...
  call npm --prefix frontend install || (pause & exit /b 1)
)

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul && (
  echo The servers seem to be running already. Opening the app...
  start "" http://localhost:5173
  timeout /t 3 >nul
  exit /b 0
)

start "VidBuddy backend" /min cmd /k "set "HAUL_DATA_DIR=./data-dev" && backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000"
start "VidBuddy frontend" /min cmd /k "npm --prefix frontend run dev"

echo Starting VidBuddy... the app opens in your browser when it's ready.
powershell -NoProfile -Command "foreach ($i in 1..60) { try { Invoke-WebRequest http://localhost:8000/api/health -UseBasicParsing -TimeoutSec 2 | Out-Null; Invoke-WebRequest http://localhost:5173 -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo The servers didn't start within a minute. Check the "VidBuddy backend" and "VidBuddy frontend" windows on the taskbar.
  pause
  exit /b 1
)
start "" http://localhost:5173
