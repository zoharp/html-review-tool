@echo off
cd /d "%~dp0"

:: Prompt for commit message
set /p MSG="Commit message: "
if "%MSG%"=="" (
    echo No message provided, aborting.
    exit /b 1
)

echo.
echo === Staging changes ===
git add -A
git status --short

echo.
echo === Committing ===
git commit -m "%MSG%"
if errorlevel 1 (
    echo Commit failed.
    exit /b 1
)

echo.
echo === Pushing to GitHub ===
git push
if errorlevel 1 (
    echo Push failed.
    exit /b 1
)

echo.
echo === Deploy Flytl ===
flyctl deploy

echo.
echo === Done! Deployed successfully. ===
pause
