@echo off
setlocal

set "PORT=3010"

echo Stopping Triton Data Bridge on port %PORT%...
echo.

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo Found process %%P listening on port %PORT%.
  taskkill /PID %%P /T /F
  if errorlevel 1 (
    echo Failed to stop process %%P.
    pause
    exit /b 1
  )
  echo Stopped process %%P.
  pause
  exit /b 0
)

echo No running Triton Data Bridge process was found on port %PORT%.
pause
