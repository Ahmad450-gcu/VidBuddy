@echo off
rem Double-click to stop the local test servers started by "Start VidBuddy (dev).bat".
rem The installed VidBuddy app is not affected.
title VidBuddy dev
cd /d "%~dp0"

rem The two server windows (found by what they run), and everything running inside them
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match 'uvicorn app\.main:app|--prefix frontend run dev' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }"

rem Anything still serving the two ports (e.g. servers started another way)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8000 .*LISTENING" /c:":5173 .*LISTENING"') do (
  taskkill /PID %%p /T /F >nul 2>&1
)

echo VidBuddy's test servers are stopped.
timeout /t 2 >nul
