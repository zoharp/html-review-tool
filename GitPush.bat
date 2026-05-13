@echo off
setlocal
cd /d "%~dp0"

echo ================================================
echo  Git Init and Push
echo ================================================
echo.

:: Check if already a git repo
IF EXIST ".git" (
    echo This folder is already a git repo.
    echo Skipping init.
    goto :push
)

:: Ask for remote URL
set /p REPO_URL="Enter GitHub repo URL: "
if "%REPO_URL%"=="" (
    echo No URL provided, aborting.
    pause
    exit /b 1
)

echo.
echo [1/4] Initializing git repo...
git init
git branch -M main

echo.
echo [2/4] Adding remote origin...
git remote add origin %REPO_URL%

:push
echo.
echo [3/4] Staging all files...
git add -A
git status --short

echo.
set /p MSG="Commit message (default: Initial commit): "
if "%MSG%"=="" set MSG=Initial commit

echo.
echo [4/4] Committing and pushing...
git commit -m "%MSG%"
git push -u origin main

if errorlevel 1 (
    echo.
    echo Push failed. Check your URL and GitHub credentials.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Done! Pushed to GitHub successfully.
echo ================================================
pause
