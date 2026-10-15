@echo off
setlocal
rem Run once in the normal Outlook/Teams account. Optional first argument: approved signed MSIX.
call "%~dp0Python_Settings.bat"
if errorlevel 1 goto failed
"%PY%" -m pip install -r "%~dp0requirements-outlook.txt"
if errorlevel 1 goto failed
if "%~1"=="" (
  powershell.exe -NoProfile -File "%~dp0Install-Notification-Listener.ps1"
) else (
  powershell.exe -NoProfile -File "%~dp0Install-Notification-Listener.ps1" -PackagePath "%~1"
)
if errorlevel 1 goto failed
echo Collectors installed. Open Atlas Admin, Live Inbox, then Connect collectors.
pause
exit /b 0
:failed
echo Collector installation needs attention. Read the error above; see docs\inbox-integration.md.
pause
exit /b 1
