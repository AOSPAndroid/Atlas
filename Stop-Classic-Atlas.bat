@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo This stops Atlas Admin and Demo.
echo Finish ongoing jobs before stopping.
echo Configured Live Inbox collectors receive a graceful stop request.
"%PY%" "%~dp0launcher.py" stop
if errorlevel 1 (pause & exit /b 1)
