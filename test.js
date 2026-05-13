#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const resultsDir = 'test_results';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const logFile = path.join(resultsDir, `test_${timestamp}.log`);
const summaryFile = path.join(resultsDir, `summary_${timestamp}.txt`);

// Ensure results directory exists
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

console.log('\n▶ Running tests...\n');

// Run tests
const testProcess = spawn('bash', ['test/run_tests.sh'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  cwd: __dirname
});

let stdout = '';
let stderr = '';

testProcess.stdout.on('data', (data) => {
  stdout += data;
  process.stdout.write(data);
});

testProcess.stderr.on('data', (data) => {
  stderr += data;
  process.stderr.write(data);
});

testProcess.on('close', (code) => {
  // Save full log
  fs.writeFileSync(logFile, stdout + stderr);

  // Extract summary
  const lines = stdout.split('\n');
  const summaryLines = lines.slice(-15);
  const summary = summaryLines.join('\n');

  fs.writeFileSync(summaryFile, `Test Run: ${timestamp}\nExit Code: ${code}\n\n${summary}`);

  // Display results
  console.log('\n════════════════════════════════════════');
  console.log(summary);
  console.log('════════════════════════════════════════\n');

  if (code === 0) {
    console.log('✓ PASSED');
  } else {
    console.log(`✗ FAILED (exit code: ${code})`);
  }

  console.log(`\nLog:     ${logFile}`);
  console.log(`Summary: ${summaryFile}\n`);

  // Show history tip
  console.log('Tip: node test.js --history  (to show recent results)\n');

  process.exit(code);
});
