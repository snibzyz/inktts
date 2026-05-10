@echo off
setlocal
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [INKTTS] pnpm not found. Run install.bat first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo [INKTTS] installing dependencies...
  call pnpm install
  if errorlevel 1 exit /b 1
)
call pnpm dev
