# Quick Test Runner

Two scripts to run and track tests easily.

---

## **Linux/Mac (bash)**

```bash
bash test.sh
```

**Options:**
```bash
bash test.sh --watch      # Auto-rerun on file changes
bash test.sh --verbose    # Show full output
bash test.sh --keep-logs  # Keep logs longer than 7 days
bash test.sh history      # Show last 10 test runs
```

---

## **Windows (batch)**

```bash
test.bat
```

**Options:**
```bash
test.bat history  # Show recent test runs
test.bat verbose  # Show full output
```

---

## **What Happens**

1. Runs `bash test/run_tests.sh` (the actual test suite)
2. Saves timestamped log file → `test_results/test_YYYYMMDD_HHMMSS.log`
3. Saves summary → `test_results/summary_YYYYMMDD_HHMMSS.txt`
4. Displays pass/fail summary with result code

**Exit codes:**
- `0` = all tests passed ✓
- Non-zero = tests failed ✗

---

## **View Results**

```bash
# Show recent tests
bash test.sh history
```

Output:
```
Recent Test Results:

20240512_143022      ✓  33 passed, 0 failed
20240512_142015      ✗  31 passed, 2 failed
20240512_140530      ✓  33 passed, 0 failed
```

---

## **Watch Mode (bash only)**

Auto-reruns tests whenever you modify `server.js`, files in `public/`, or `test/`:

```bash
bash test.sh --watch
```

Press `Ctrl+C` to stop.

---

## **Results Directory**

All logs saved to `test_results/` with structure:
```
test_results/
├── test_20240512_143022.log       # Full curl output & assertions
├── summary_20240512_143022.txt    # Pass/fail count
├── test_20240512_142015.log
├── summary_20240512_142015.txt
└── ...
```

Old logs (7+ days) auto-deleted unless `--keep-logs` is used.

---

## **Typical Workflow**

1. Make a code change
2. Run tests:
   ```bash
   bash test.sh
   ```
3. If failed, check the full log:
   ```bash
   tail -100 test_results/test_*.log | grep "✗"
   ```
4. Fix and re-run
5. Before commit, ensure `test.sh` passes with exit code 0

---

## **CI/CD Integration**

Use in GitHub Actions or other CI:
```bash
#!/bin/bash
cd review-tool
bash test.sh
exit $?  # Fail the CI job if tests fail
```

Or just check exit code:
```bash
bash test.sh && echo "Tests passed!" || echo "Tests failed!"
```
