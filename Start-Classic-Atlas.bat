@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
"%PY%" "%~dp0edition_launcher.py" classic all
if errorlevel 1 (pause & exit /b 1)
