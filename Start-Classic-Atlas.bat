@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Starting Classic Atlas and configured Live Inbox collectors.
"%PY%" "%~dp0edition_launcher.py" classic all %*
if errorlevel 1 (pause & exit /b 1)
