@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
rem Installs the llama-cpp-python library for the Local Assistant (no llama-server.exe needed).
"%PY%" "%~dp0install_assistant.py" %*
pause
