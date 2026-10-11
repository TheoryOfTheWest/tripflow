@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22.12 or later.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)
echo TripFlow project: %CD%
echo Website: http://127.0.0.1:5173/tripflow/
echo Keep this window open. Press Ctrl+C to stop.
call npm.cmd run dev -- --open --port 5173 --strictPort
if errorlevel 1 (
  echo Startup failed. Check whether port 5173 is already in use.
  pause
)
endlocal
