@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Classic and Desktop share the same local services. This stops Admin and Demo for both.
echo Finish ongoing jobs before stopping.
echo Configured Live Inbox collectors receive a graceful stop request.
"%PY%" "%~dp0launcher.py" stop
if errorlevel 1 (pause & exit /b 1)
