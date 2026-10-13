@echo off
setlocal
echo Updating Atlas from AOSPAndroid/Atlas ^(main^).
call "%~dp0Python_Settings.bat"
if errorlevel 1 (
  set "ATLAS_UPDATE_RESULT=1"
  goto finish
)
"%PY%" "%~dp0update_atlas.py" %*
set "ATLAS_UPDATE_RESULT=%ERRORLEVEL%"
:finish
echo.
if "%ATLAS_UPDATE_RESULT%"=="0" (
  echo Atlas update command finished. Check the result above.
) else (
  echo Atlas update command failed. Read the message above before trying again.
)
if not "%ATLAS_UPDATE_NO_PAUSE%"=="1" pause
exit /b %ATLAS_UPDATE_RESULT%
