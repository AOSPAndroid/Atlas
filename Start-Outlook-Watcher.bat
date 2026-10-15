@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
"%PY%" "%~dp0outlook_watcher.py" start %*
if errorlevel 1 (pause & exit /b 1)
