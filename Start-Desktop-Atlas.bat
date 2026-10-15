@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Starting Desktop Atlas and configured Live Inbox collectors.
"%PY%" "%~dp0edition_launcher.py" desktop all %*
if errorlevel 1 (pause & exit /b 1)
