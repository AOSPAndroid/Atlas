@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
"%PY%" -m pip install -r "%~dp0requirements-outlook.txt"
if errorlevel 1 (pause & exit /b 1)
echo Outlook watcher dependency installed. Open Outlook, then run Start-Outlook-Watcher.bat.
pause
