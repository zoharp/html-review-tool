# HTML Review Tool — Claude Instructions

See `system.md` for features, data flow, business logic, database schema, and API routes.

## Project

An invite-based HTML review tool. Admins upload HTML documents, invite reviewers by email, and manage their annotations (comments + tracked text changes) from a dashboard. Reviewers access a personalised link, select text in the rendered document, and add comments or suggest replacements. The admin can accept/reject changes, reply in threaded discussions, edit the document directly (HTML text or file upload), preview the document with highlights, and export the final HTML with accepted changes applied.

**Git repo:** https://github.com/zoharp/html-review-tool  
**Live URL:** https://review-tool.fly.dev (Fly.io)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 + Express 4 |
| Database | sql.js 1.14 (pure-WASM SQLite — no native bindings, required for Fly.io Docker) |
| Email | Nodemailer (Gmail / SMTP) |
| Auth | httpOnly cookies + uuid tokens |
| Frontend | Vanilla JS, no frameworks |
| File upload | multer (memory storage) |
| Rate limiting | express-rate-limit (10 req / 15 min on login endpoints) |
| Deployment | Fly.io (Docker) with persistent volume `/data` for the DB |

---

## Project Structure

```
review-tool/
├── CLAUDE.md                     ← this file
├── system.md                     ← what it does (features, schema, API, business logic)
├── ops.md                        ← how to run, deploy, test
├── IMPLEMENTATION_COMPLETE.md    ← summary of all 3 features implemented
├── FEATURES_GUIDE.md             ← user guides for all features (how to use)
├── TECHNICAL_REFERENCE.md        ← code architecture & implementation details
├── PRESENCE_INDICATORS.md        ← detailed guide for presence feature
├── server.js                     ← entire backend (~1400 lines)
├── package.json
├── Dockerfile
├── fly.toml
├── start.bat                     ← Windows launcher (kills port 3000, opens browser)
├── .env                          ← secrets (never commit — see .env.example)
├── .env.example
├── .gitignore                    ← node_modules/, review.db, .env
├── test/
│   └── run_tests.sh              ← end-to-end test suite (bash + curl)
└── public/
    ├── admin.html                ← admin dashboard
    ├── reviewer.html             ← reviewer interface (iframe + sidebar)
    ├── preview.html              ← admin document preview with annotation highlights + editing
    └── login.html                ← reviewer login (pre-filled from invite link)
```

---

## Environment Variables (`.env`)

```env
PORT=3000
ADMIN_PASSWORD=changeme123
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your@gmail.com
SMTP_PASS=your_google_app_password   # Gmail → Security → App Passwords
SMTP_FROM=your@gmail.com
BASE_URL=http://localhost:3000       # Change to https://review-tool.fly.dev for prod
DB_PATH=                             # Optional — defaults to ./review.db
                                     # Fly.io sets this to /data/review.db via fly.toml
```

**Important:** On Fly.io set secrets:
```
flyctl secrets set BASE_URL="https://review-tool.fly.dev"
flyctl secrets set ADMIN_PASSWORD="your-secure-password"
```

See `ops.md` for how to run locally, deploy to Fly.io, and run the test suite.

---

## Recent Changes

**May 12, 2026: Admin Preview Annotations**
- Admins can now add comments and suggest changes directly in Preview mode
- See `CHANGES_SUMMARY.md` for technical details
- See `ADMIN_ANNOTATION_GUIDE.md` for user guide
- See `DEVELOPER_REFERENCE.md` for code architecture
- Modified: `server.js`, `public/preview.html`

---

## Skills
 
| When | Skill |
|---|---|
| Committing / pushing to GitHub | `/deploy` |
| Bumping version / writing release notes | `/release-management` |
| Security audit of changes | `/security-review` |
| Reviewing a PR | `/review` |
| Code cleanup after a change | `/simplify` |
