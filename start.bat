@echo off
cd /d "%~dp0"
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Electron into this folder...
  call npm install
  if errorlevel 1 exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
