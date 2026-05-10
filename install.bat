@echo off
setlocal
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [INKTTS] installing pnpm globally via npm...
  where npm >nul 2>nul
  if errorlevel 1 (
    echo [INKTTS] npm not found. Install Node.js 20+ from https://nodejs.org first.
    pause
    exit /b 1
  )
  call npm install -g pnpm
  if errorlevel 1 exit /b 1
)
echo [INKTTS] installing dependencies...
call pnpm install
if errorlevel 1 exit /b 1
echo [INKTTS] done. Run start.bat to launch.
pause
