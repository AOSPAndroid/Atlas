@echo off
setlocal
call "%~dp0Python_Settings.bat"
if errorlevel 1 (pause & exit /b 1)
echo Optional offline assistant: about 2.9 GB of model files.
echo This installs Python packages and a local model, without an AI server.
"%PY%" -m venv "%~dp0.venv-assistant"
if errorlevel 1 (echo Could not create the assistant environment. & pause & exit /b 1)
set "ASSISTANT_PY=%~dp0.venv-assistant\Scripts\python.exe"
if not "%~1"=="" goto offline_packages
"%ASSISTANT_PY%" -m pip install -r "%~dp0requirements-assistant.txt"
goto packages_done
:offline_packages
if not exist "%~1\wheels" (echo Offline setup needs a wheels subfolder alongside the model assets. & pause & exit /b 1)
"%ASSISTANT_PY%" -m pip install --no-index --find-links "%~1\wheels" -r "%~dp0requirements-assistant.txt"
:packages_done
if errorlevel 1 (echo Assistant dependency installation failed. & pause & exit /b 1)
if "%~1"=="" goto online_model
"%ASSISTANT_PY%" "%~dp0scripts\setup_assistant.py" --assets "%~1"
goto model_done
:online_model
"%ASSISTANT_PY%" "%~dp0scripts\setup_assistant.py"
:model_done
if errorlevel 1 (pause & exit /b 1)
pause
