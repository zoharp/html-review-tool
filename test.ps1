# HTML Review Tool — Test Runner (PowerShell - Windows native)
# Usage: powershell -ExecutionPolicy Bypass -File test.ps1

$ErrorActionPreference = "Continue"
$resultsDir = "test_results"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $resultsDir "test_$timestamp.log"
$summaryFile = Join-Path $resultsDir "summary_$timestamp.txt"

# Create results directory
if (-not (Test-Path $resultsDir)) {
    New-Item -ItemType Directory -Path $resultsDir | Out-Null
}

Write-Host "`n▶ Running tests...`n" -ForegroundColor Cyan

# Run the bash test suite
$output = @()
$exitCode = 0

try {
    # Try with bash first (if WSL/Git Bash is available)
    Write-Host "Looking for bash..." -ForegroundColor Gray
    $bashPath = (Get-Command bash -ErrorAction SilentlyContinue).Source

    if ($bashPath) {
        Write-Host "Found bash at: $bashPath" -ForegroundColor Green
        & bash test/run_tests.sh 2>&1 | Tee-Object -Variable output | Out-Host
        $exitCode = $LASTEXITCODE
    }
    else {
        Write-Host "Bash not found. Trying direct Node execution..." -ForegroundColor Yellow
        # Fallback: run tests via Node
        & node -e @"
            const { execSync } = require('child_process');
            try {
                const result = execSync('bash test/run_tests.sh', {
                    stdio: 'inherit',
                    cwd: '.'
                });
                process.exit(0);
            } catch(e) {
                process.exit(e.status || 1);
            }
"@
        $exitCode = $LASTEXITCODE
    }
}
catch {
    Write-Host "ERROR: Could not run tests" -ForegroundColor Red
    Write-Host $_.Exception.Message
    $exitCode = 1
}

# Save logs
$outputText = ($output -join "`n")
if ($outputText) {
    $outputText | Out-File -FilePath $logFile -Encoding UTF8
}

# Extract summary
$summary = ""
if (Test-Path $logFile) {
    $summary = Get-Content $logFile | Select-Object -Last 10 | Out-String
}

# Write summary file
@"
Test Run: $timestamp
Exit Code: $exitCode

$summary
"@ | Out-File -FilePath $summaryFile -Encoding UTF8

# Display results
Write-Host "`n════════════════════════════════════════" -ForegroundColor Blue
if ($summary) {
    Write-Host $summary -ForegroundColor Gray
}
Write-Host "════════════════════════════════════════`n" -ForegroundColor Blue

if ($exitCode -eq 0) {
    Write-Host "✓ PASSED" -ForegroundColor Green
}
else {
    Write-Host "✗ FAILED (exit code: $exitCode)" -ForegroundColor Red
}

Write-Host "`nLog:     $logFile"
Write-Host "Summary: $summaryFile`n"

Write-Host "Tip: powershell -File test.ps1  (to run again)`n" -ForegroundColor Gray

exit $exitCode
