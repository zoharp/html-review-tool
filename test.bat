@echo off
REM HTML Review Tool — Test Runner (Windows)
REM Usage: test.bat [history|verbose]

setlocal enabledelayedexpansion

if "%1"=="history" (
  echo Recent Test Results:
  echo.
  for /f "tokens=*" %%A in ('dir /b /od test_results\summary_*.txt 2^>nul') do (
    echo %%A
  )
  exit /b 0
)

if "%1"=="verbose" (
  bash test/run_tests.sh
  exit /b !errorlevel!
)

REM Create results directory
if not exist test_results mkdir test_results

REM Generate timestamp
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c%%a%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a%%b)
set TIMESTAMP=!mydate!_!mytime!

set LOG_FILE=test_results\test_!TIMESTAMP!.log
set SUMMARY_FILE=test_results\summary_!TIMESTAMP!.txt

echo.
echo Running tests...
echo.

REM Run tests
bash test/run_tests.sh > "!LOG_FILE!" 2>&1
set RESULT=!errorlevel!

REM Show last 10 lines
echo.
echo ════════════════════════════════════════
for /f "tokens=*" %%A in ('powershell -Command "Get-Content '!LOG_FILE!' | Select-Object -Last 10"') do (
  echo %%A
)
echo ════════════════════════════════════════
echo.

if !RESULT! equ 0 (
  echo Result: ✓ PASSED
) else (
  echo Result: ✗ FAILED [exit code: !RESULT!]
)

echo Log:     !LOG_FILE!
echo Summary: !SUMMARY_FILE!
echo.

echo Tips:
echo   test.bat history  — show recent results
echo   test.bat verbose  — show full output
echo.

exit /b !RESULT!
