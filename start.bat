@echo off
title HTML Review Tool — Starting...
cd /d "%~dp0"

echo.
echo  HTML Review Tool
echo  ----------------

:: Kill any process already listening on port 3000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo  Stopping previous instance (PID %%a^)...
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Start the server in its own window (logs visible there)
start "HTML Review Tool" cmd /k "cd /d "%~dp0" && node server.js"

:: Wait until port 3000 is listening (up to 15 s)
echo  Waiting for server to start...
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
netstat -aon 2>nul | findstr ":3000 " | findstr "LISTENING" >nul
if errorlevel 1 (
    if %tries% lss 15 goto wait
    echo  ERROR: Server did not start. Check the server window for errors.
    pause
    exit /b 1
)

:: Open the admin dashboard
echo  Opening browser...
start "" "http://localhost:3000/admin.html"

echo  Done! Server is running in the other window.
timeout /t 2 /nobreak >nul
exit
