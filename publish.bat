@echo off
cd /d "%~dp0"
echo [1/3] Compressing new pins...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-pins.ps1"
echo [2/3] Uploading pins...
rclone copy "D:\KIDS\site\public\pins" r2:sfl-files/pins --include "/*.jpg" --progress
echo [3/3] Uploading print files...
rclone copy "D:\KIDS\site\public\print" r2:sfl-files/print --progress
echo Done.
pause
