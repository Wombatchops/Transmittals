@echo off
REM ==========================================================
REM  Builds DocControl_v1.1.exe  (run once, on any Windows PC)
REM  Needs Python 3.10+ from python.org or the Microsoft Store.
REM ==========================================================
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (set PY=py -3) || (set PY=python)
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo  ^(tick "Add python.exe to PATH" during install^), then run this again.
  pause
  exit /b 1
)

echo Creating build environment...
%PY% -m venv .buildenv || goto :fail
call .buildenv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
python -m pip install -r requirements_v1.1.txt || goto :fail

echo Building exe...
pyinstaller --onefile --console --name DocControl_v1.1 ^
  --collect-all extract_msg --collect-all fpdf ^
  --distpath . --workpath .build --specpath .build -y DocControl_v1.1.py || goto :fail

call deactivate
rmdir /s /q .build .buildenv 2>nul
echo.
echo ==========================================================
echo  Done:  %~dp0DocControl_v1.1.exe
echo  Copy that exe into any folder of .eml / .msg files and run it.
echo ==========================================================
pause
exit /b 0

:fail
echo.
echo Build FAILED - see messages above.
pause
exit /b 1
