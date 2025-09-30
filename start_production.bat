@echo off
REM Start the Python media server with waitress (production-ish)
py -m pip install --upgrade pip >NUL 2>&1
py -m pip install flask waitress >NUL 2>&1
waitress-serve --listen=0.0.0.0:3000 server:app
pause
