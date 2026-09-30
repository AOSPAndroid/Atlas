@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Opening Classic and Desktop Admin, Demo and hosted Preview.
"%PY%" "%~dp0edition_launcher.py" both all
if errorlevel 1 (pause & exit /b 1)
