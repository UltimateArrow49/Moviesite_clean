@echo off
REM Start the Python media server (dev) on port 3000
py -m pip install --upgrade pip >NUL 2>&1
py -m pip install flask >NUL 2>&1
py server.py
pause
