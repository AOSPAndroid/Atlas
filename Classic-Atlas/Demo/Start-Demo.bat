@echo off
setlocal
pushd "%~dp0..\..\.."
if errorlevel 1 exit /b 1
call "Python_Settings.bat"
if errorlevel 1 goto failed
"%PY%" "edition_launcher.py" classic demo
if errorlevel 1 goto failed
popd
exit /b 0
:failed
popd
pause
exit /b 1
