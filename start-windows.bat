@echo off
chcp 65001 >nul
pushd "%~dp0"
echo Starting MRP dashboard on http://localhost:5173
where python >nul 2>nul
if errorlevel 1 goto nopython
if not exist sync-config.json (
  echo Installing Excel sync libraries - first time only...
  python -m pip install --quiet --disable-pip-version-check msoffcrypto-tool pyxlsb openpyxl
  python excel_sync.py
  echo.
  echo Fill in sync-config.json - the Excel path and password - save it, then run start-windows.bat again.
  pause
  exit /b
)
start "MRP - Excel auto-sync (keep open)" cmd /k python excel_sync.py
start "" http://localhost:5173
python -m http.server 5173
goto :eof
:nopython
echo Python is not installed. Auto-sync needs Python - get it from python.org and tick "Add python.exe to PATH".
echo Starting the dashboard without auto-sync...
start "" http://localhost:5173
npx --yes serve -l 5173 .
