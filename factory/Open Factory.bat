@echo off
cd /d "%~dp0"
set "PATH=%~dp0..\.tools\node-v22.23.3-win-x64;%PATH%"
npx tsx src/studio.ts
