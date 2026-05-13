# Test Suite Setup — Complete

## Status
✅ **Tests updated and ready to run**

---

## What Was Done

### 1. Tests Updated (May 12, 2026)
Added new test section for **Admin Preview Annotations** feature:
- ✓ Admin can create comment annotations
- ✓ Admin can create change annotations  
- ✓ Admin annotations appear in list
- ✓ Admin annotations workflow (accept/reject) works

### 2. Test Coverage
The suite now covers ~35 test cases across:
- Authentication (login, password, sessions)
- File upload & management
- Admin annotations (reviewer + admin)
- Export with change application
- Preview overlay
- Replies & threading
- Reviewer invites & auth
- Static files
- Rate limiting

### 3. Scripts Created
Three ways to run tests:

**Bash (Linux/Mac):**
```bash
bash test.sh              # Run once
bash test.sh --watch     # Auto-rerun on changes
bash test.sh history     # Show recent results
```

**Node.js (Windows/Mac/Linux):**
```bash
node test.js
```

**Batch (Windows):**
```bash
test.bat
```

---

## Test Infrastructure

| Component | File | Purpose |
|-----------|------|---------|
| Main test suite | `test/run_tests.sh` | End-to-end curl-based tests (35+ assertions) |
| Test runner (bash) | `test.sh` | Linux/Mac wrapper with logging |
| Test runner (batch) | `test.bat` | Windows wrapper with logging |
| Test runner (Node) | `test.js` | Cross-platform Node.js wrapper |
| Documentation | `RUN_TESTS.md` | How to use the scripts |
| Full guide | `TEST_GUIDE.md` | Deep dive into test sections |

---

## How Tests Work

1. **Isolated Test Environment**
   - Starts fresh server on port 3099
   - Creates test database at `/tmp/rv_test.db`
   - Uses test `.env` (backed up original)

2. **Test Execution**
   - Runs ~35 curl-based HTTP assertions
   - Tests all endpoints: auth, upload, annotations, export, preview, replies
   - Seeds database with sample data
   - Verifies expected responses

3. **Cleanup**
   - Kills test server
   - Restores original `.env`
   - Saves full log + summary to `test_results/`

4. **Result Tracking**
   - Each run → timestamped log file
   - Exit code 0 = pass, non-zero = fail
   - Historical logs kept in `test_results/` folder

---

## Running Tests

### Quick Start
```bash
# Windows: use Node.js
node test.js

# Mac/Linux: use bash
bash test.sh

# Or use batch/bash directly
bash test/run_tests.sh
```

### Results
All logs saved to `test_results/test_YYYYMMDD_HHMMSS.log`

### Check History
```bash
bash test.sh history
```

Shows last 10 test runs with pass/fail counts.

---

## Recent Changes Tested

**Admin Preview Annotations** (May 12, 2026):
- New endpoint: `POST /api/admin/annotations`
- Schema: `invite_id` now nullable (admin annotations have `invite_id=NULL`)
- Tests verify:
  - Endpoint accepts fileId, type, selectedText, comment/suggestedText
  - Returns 400 on missing required fields
  - Annotations appear in list with `reviewer_email='admin'`
  - Workflow (accept/reject) works on admin annotations

---

## Test Execution Time
**~45-60 seconds** (includes server startup, DB seeding, 35+ curl requests, cleanup)

---

## Next Steps

Before each commit:
```bash
bash test.sh    # or: node test.js  (Windows)
```

Exit code 0 = safe to commit ✓

For watch-mode development:
```bash
bash test.sh --watch
```

Auto-reruns whenever you modify `server.js`, `public/`, or `test/`.

---

## CI/CD Integration

Add to your CI pipeline:
```bash
cd review-tool
bash test/run_tests.sh
exit $?
```

Fails the build if tests fail.
