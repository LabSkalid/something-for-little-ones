@echo off
cd /d "%~dp0"
set "PATH=%~dp0..\.tools\node-v22.23.3-win-x64;%PATH%"
title Something for Little Ones - Factory
echo Opening the factory at http://127.0.0.1:4317
echo Close this window to stop it.
echo.
if exist "node_modules\tsx\dist\cli.mjs" (
  node "node_modules\tsx\dist\cli.mjs" src/studio.ts
) else (
  npx --yes tsx src/studio.ts
)
pause
