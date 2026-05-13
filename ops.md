# Ops Reference

## How to Run (Local)

```bash
cd review-tool
npm install
node server.js        # or double-click start.bat on Windows
```

Opens at http://localhost:3000 — Admin dashboard: http://localhost:3000/admin.html

---

## Deploy to Fly.io

```bash
flyctl launch          # say NO to overwriting fly.toml
flyctl volumes create review_data --size 1 --region ewr
flyctl deploy          # every subsequent deploy
```

The `fly.toml` mounts a persistent volume at `/data` and sets `DB_PATH=/data/review.db`.

---

## Testing

```bash
bash test/run_tests.sh
```

Backs up `.env`, runs a fresh test server on port 3099, seeds the DB, runs ~30 curl-based checks (auth, upload, annotations, export, preview, replies, invite flow, static files, rate limiter), then restores `.env`.
