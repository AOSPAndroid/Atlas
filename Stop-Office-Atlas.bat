@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Requesting collector shutdown and stopping Atlas servers.
"%PY%" "%~dp0launcher.py" stop
if errorlevel 1 (pause & exit /b 1)
