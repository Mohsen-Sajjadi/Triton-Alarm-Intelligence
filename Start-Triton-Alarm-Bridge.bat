@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Starting Triton AI Alarm Insights...
echo.
echo Admin page: http://localhost:3010/admin/sites.html
echo Health API:  http://localhost:3010/api/health
echo.
echo Keep this window open while the bridge is running.
echo Press Ctrl+C to stop it.
echo.

call npm start
pause
