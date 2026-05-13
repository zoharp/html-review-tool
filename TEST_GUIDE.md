# Test Guide — HTML Review Tool

## Running Tests

**Simple:**
```bash
bash test/run_tests.sh
```

**With output:**
```bash
cd review-tool && bash test/run_tests.sh 2>&1 | tee test_results.txt
```

**Just syntax check (no running server):**
```bash
node -c server.js
```

---

## What Tests Cover

The test suite (`test/run_tests.sh`) is an **end-to-end bash + curl test** that:

1. **Starts a fresh server** on port 3099 (isolated from production)
2. **Seeds a test database** with sample files, invites, annotations, replies
3. **Runs ~35 curl-based assertions** across all major features
4. **Cleans up** — restores `.env`, kills server process

**No external dependencies:** Tests use pure curl + SQL.js; no Jest, Mocha, or heavyweight test runners.

---

## Test Sections

| Section | Checks |
|---------|--------|
| **AUTH** | Login, password validation, session cookies |
| **FILE UPLOAD** | Upload HTML, list files |
| **ADMIN ANNOTATIONS** | Create/accept/reject reviewer annotations, status workflow |
| **ADMIN ANNOTATIONS (Preview Mode)** | Admin can add comments/suggestions directly in preview |
| **EXPORT** | Download HTML with accepted changes applied |
| **PREVIEW** | Admin preview overlay with annotation highlights |
| **REPLIES** | Thread discussions on annotations |
| **REVIEWER SESSION** | Reviewer auth, file access, annotation list |
| **INVITE FLOW** | Email invite links, auth with invite code |
| **STATIC FILES** | All HTML pages load (admin.html, reviewer.html, etc.) |
| **RATE LIMITER** | Login endpoint blocks after 10 failed attempts/15min |

---

## Understanding Test Output

```
  ✓ /me unauthed → 401              # Pass: endpoint correctly returns 401
  ✗ export applies change            # Fail: expected "example content", got something else
```

Each line shows:
- **✓ / ✗** — pass/fail status
- **Test description** — what is being checked
- **Expected vs actual** — shown on failures (truncated to 120 chars)

**Summary:**
```
══════════════════════════════════
  ✓ PASSED : 33
  ✗ FAILED : 2
══════════════════════════════════
```

Exit code 0 = all tests passed; non-zero = failures.

---

## Recent Changes (May 12, 2026)

**New:** Admin Preview Annotations feature
- Admins can now add comments & suggest changes in preview mode (not just reviewers)
- New endpoint: `POST /api/admin/annotations`
- New tests added:
  - ✓ admin post annotation → has id
  - ✓ admin annotation in list
  - ✓ admin annotation status change

---

## Continuous Testing Tips

**Watch-mode (re-run on file change):**
```bash
nodemon -e js,html --exec "bash test/run_tests.sh"
```

**Parallel testing (if you split test file):**
```bash
bash test/run_tests.sh &
bash test/run_tests.sh &
wait
```

**Track results over time:**
```bash
for i in {1..5}; do
  echo "=== Run $i ===" >> test_history.log
  bash test/run_tests.sh 2>&1 | tail -3 >> test_history.log
  sleep 5
done
```

---

## Debugging Failures

**1. See full test log:**
```bash
bash test/run_tests.sh 2>&1 | tee full_log.txt
# Review full_log.txt, especially /tmp/rv_srv.log for server errors
```

**2. Check specific endpoint manually:**
```bash
# Start server in one terminal
node server.js

# In another, test an endpoint
curl -s http://localhost:3000/api/admin/annotations?fileId=xyz
```

**3. Inspect test database:**
```bash
# During test (in another window while tests running)
sqlite3 /tmp/rv_test.db ".tables"
sqlite3 /tmp/rv_test.db "SELECT * FROM annotations;"
```

**4. Check .env or server startup:**
```bash
cat .env
# Verify PORT, ADMIN_PASSWORD, DB_PATH are correct for test
```

---

## Test Coverage Status

| Feature | Coverage |
|---------|----------|
| Admin auth & file mgmt | ✓ Full |
| Reviewer invites & auth | ✓ Full |
| Annotations (create/accept/reject) | ✓ Full |
| Admin annotations (new) | ✓ Full (just added) |
| Replies & threading | ✓ Full |
| Export with changes | ✓ Full |
| Preview overlay | ✓ Full |
| Rate limiting | ✓ Full |
| Static files | ✓ Full |

---

## Next Steps

Run the full test suite before each commit:
```bash
bash test/run_tests.sh && git commit -m "feature: ..."
```

Or add a pre-commit hook:
```bash
cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/bash
bash test/run_tests.sh || exit 1
HOOK
chmod +x .git/hooks/pre-commit
```
