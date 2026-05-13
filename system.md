# System Reference

## Admin Dashboard (`admin.html`)

Admins upload HTML files, manage invites, and review annotations from a single page.

- File list with badge showing active invite count and "not opened" count (pending invites, not pending annotations)
- Per-file invite table: reviewer name/email, "Sent X ago" timestamp, annotation count, revoke button, 🔗 copy-link button (for when email wasn't received), editable reviewer name
- Annotation list filterable by status (pending / accepted / rejected); accept/reject controls; threaded replies (editable/deletable by admin)
- **Apply in place:** accept + apply a single change directly to the live document (sets `applied=1`); distinct from export which is non-destructive
- **Edit document:** admin can edit HTML text directly (inline editor) or upload a revised file
- **Revise document:** upload a new version of a file — optionally re-invites existing reviewers (sends revision email) and imports annotations that still match text in the new version
- Preview button opens `preview.html` (iframe overlay showing all reviewer annotations)
- ⚙️ Settings modal: toggle admin email digest on/off
- localStorage restores last selected file and tab on refresh (`rv_lastFile`, `rv_lastTab`)

---

## Reviewer Interface (`reviewer.html`)

Reviewers access a personalised link, read the document in an iframe, and annotate from a sidebar.

- Login via `login.html` (email + invite code, pre-filled from invite link)
- Document rendered in iframe; reviewer selects text → sidebar form appears to add a **comment** or **change suggestion**
- Annotation cards show selected text, comment/suggestion, status badge
- ✏️ Edit / 🗑 Remove own pending annotations (hidden once admin decides)
- 💬 Discussion thread toggle on every card; reviewer can edit/delete own replies
- 📧 Email notifications opt-out toggle at bottom of sidebar
- **Version switcher:** if the document has been revised, reviewer can browse the version chain and view older versions read-only (no overlay)

---

## Annotation Overlay

Injected as a `<style>` + `<script>` block before `</body>` when the server serves the document HTML.

- Uses `TreeWalker` + `Range.surroundContents()` to wrap matched text in `<span data-ann-id="...">`
- Uses `context_before` (40 chars before the selection) to disambiguate repeated phrases
- Communicates with the parent frame via `postMessage`
- Admin preview (`/api/admin/preview/file/:fileId`) fetches from the admin API so all reviewers' annotations are visible; reviewer view fetches only that reviewer's own

---

## Export Logic

Two ways to apply accepted changes:

**Export (`GET /api/admin/files/:id/export`)** — non-destructive download with all accepted, unapplied changes applied in-memory. Sent as `{original}_revised.html`. Does not modify the DB.

**Apply in place (`POST /api/admin/annotations/:id/apply`)** — applies a single accepted `change` annotation directly to the stored file content. Sets `applied=1` on the annotation so export skips it. Fails if text not found or already applied.

Both use the same strategy: context-prefixed replace first (`context_before + selected_text`), fallback to plain `selected_text` replace.

---

## Email Notifications

All sends are fire-and-forget (`.catch(() => {})`); email errors never affect HTTP responses.

| Notification | Trigger | Dedup / throttle |
|---|---|---|
| Admin digest | New annotation or reply | At most once per 120 min; controlled by `settings.notif_admin` |
| Reviewer status | Admin accepts/rejects annotation | Once per `{annotationId}:{status}` via `notifications` table |
| Reviewer reply | New reply on reviewer's annotation | At most once per 60 min per annotation thread |

Per-reviewer opt-out stored as `settings` key `optout:{email}`. Invite code doubles as the unsubscribe token (`/unsubscribe/:inviteCode`, `/resubscribe/:inviteCode`).

---

## Database Schema

```sql
files         (id, name, content TEXT, uploaded_at, parent_id)
              -- parent_id links to previous version; NULL = original
invites       (id, file_id, email, name, invite_code UNIQUE, status, created_at)
              -- status: 'pending' | 'accepted' | 'revoked'
annotations   (id, file_id, invite_id, reviewer_email, reviewer_name,
               type, selected_text, context_before, context_after,
               comment, suggested_text, status, created_at,
               applied, source_ann_id)
              -- type: 'comment' | 'change'
              -- status: 'pending' | 'accepted' | 'rejected'
              -- applied: 1 if change was applied in-place (export skips these)
              -- source_ann_id: links imported annotation back to its origin in the parent file
sessions      (token, invite_id, email, file_id, created_at)
admin_sessions(token, created_at)
replies       (id, annotation_id, author_email, author_name, author_role, message, created_at)
              -- author_role: 'admin' | 'reviewer'
settings      (key TEXT PRIMARY KEY, value TEXT)
              -- keys: 'notif_admin' ('1'/'0'), 'optout:{email}' ('1'/'0')
notifications (id, type, reference_id, recipient_email, sent_at)
              -- deduplication table per recipient; reference_id e.g. '{annotationId}:{status}'
```

DB persistence: after every write `db.export()` is written to disk via `saveDb()`.
Auto-recovery: corrupt DB on startup → backed up as `.bak`, fresh DB created.

---

## API Routes

### Admin (require `admin_token` cookie)

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/login` | Password login → sets `admin_token` cookie |
| POST | `/api/admin/logout` | Clears cookie |
| GET | `/api/admin/me` | Session check |
| GET | `/api/admin/files` | List files with invite/annotation counts |
| POST | `/api/admin/files` | Upload HTML (multipart/form-data) |
| DELETE | `/api/admin/files/:id` | Delete file + all its data |
| PATCH | `/api/admin/files/:id/text` | Edit HTML text in-place `{ content }` |
| PATCH | `/api/admin/files/:id/content` | Edit via file upload (multipart/form-data) |
| POST | `/api/admin/files/:id/revise` | Upload revised version `{ reInvite?, importAnnotations? }` |
| GET | `/api/admin/files/:id/chain` | Version chain `{ current, chain: [v1…vN] }` |
| GET | `/api/admin/file/:fileId/raw` | Raw HTML content (for diff) |
| GET | `/api/admin/invites?fileId=` | List invites (includes `invite_code`, `created_at`) |
| POST | `/api/admin/invites` | Send invite email `{ fileId, email, name?, message? }` |
| PATCH | `/api/admin/invites/:id` | Update reviewer name `{ name }` |
| PATCH | `/api/admin/invites/:id/revoke` | Revoke invite |
| GET | `/api/admin/annotations?fileId=&status=` | List annotations |
| PATCH | `/api/admin/annotations/:id` | Update status `{ status }` |
| POST | `/api/admin/annotations/:id/apply` | Apply accepted change in-place to document |
| GET | `/api/admin/annotations/:id/replies` | Get reply thread |
| POST | `/api/admin/annotations/:id/replies` | Add reply `{ message }` |
| PATCH | `/api/admin/replies/:id` | Edit own admin reply `{ message }` |
| DELETE | `/api/admin/replies/:id` | Delete own admin reply |
| GET | `/api/admin/files/:id/export` | Download HTML with all accepted unapplied changes |
| GET | `/api/admin/preview/file/:fileId` | Serve doc HTML with admin annotation overlay |
| GET | `/api/admin/settings` | Get `{ notificationsEnabled }` |
| PATCH | `/api/admin/settings` | Set `{ notificationsEnabled: bool }` |

### Reviewer (require `reviewer_token` cookie)

| Method | Path | Description |
|---|---|---|
| POST | `/api/reviewer/auth` | Login with `{ email, inviteCode }` |
| GET | `/api/reviewer/me` | Session info |
| GET | `/api/reviewer/file/:fileId` | Serve doc HTML with reviewer annotation overlay |
| GET | `/api/reviewer/file/:fileId/readonly` | Ancestor file HTML, no overlay (version switcher) |
| GET | `/api/reviewer/file/:fileId/raw` | Raw HTML for any file in reviewer's chain (diff) |
| GET | `/api/reviewer/revisions` | Version chain `{ current, chain: [v1…vN] }` |
| GET | `/api/reviewer/annotations/:fileId` | List annotations for file (can access ancestor files) |
| POST | `/api/reviewer/annotations` | Create annotation |
| PATCH | `/api/reviewer/annotations/:id` | Edit own annotation (pending only) |
| DELETE | `/api/reviewer/annotations/:id` | Delete own annotation |
| GET | `/api/reviewer/annotations/:id/replies` | Get reply thread |
| POST | `/api/reviewer/annotations/:id/replies` | Add reply `{ message }` |
| PATCH | `/api/reviewer/replies/:id` | Edit own reply `{ message }` |
| DELETE | `/api/reviewer/replies/:id` | Delete own reply |
| GET | `/api/reviewer/notifications/status` | Get `{ optedOut }` |
| POST | `/api/reviewer/notifications/optout` | Set `{ optOut: bool }` |
| POST | `/api/reviewer/logout` | Clear cookie |

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/review/invite/:code` | Validate invite code → redirect to login.html |
| GET | `/unsubscribe/:inviteCode` | One-click unsubscribe from emails (HTML page) |
| GET | `/resubscribe/:inviteCode` | Re-subscribe to emails (HTML page) |
| GET | `/` | Redirect to `/admin.html` |

---

## Common Issues

**`SMTP_PASS` incorrect / "Username and Password not accepted"**
→ Use a Gmail *App Password* (Google Account → Security → 2-Step Verification → App Passwords).

**Invite email not received**
→ Use the 🔗 Copy link button on the invite row to get the direct URL and send it manually.

**Invite email link goes to localhost on Fly.io**
→ `flyctl secrets set BASE_URL="https://review-tool.fly.dev"`

**`fly.toml` overwritten by `flyctl launch`**
→ Keep a backup. Critical: `[env]` must have `PORT=3000` and `DB_PATH=/data/review.db`; `[[mounts]]` must mount `review_data` → `/data`.

**`flyctl` not found after install on Windows**
→ `$env:PATH += ";$env:USERPROFILE\.fly\bin"` or restart terminal.

**Database corrupt after crash**
→ Server auto-recovers: backs up to `.bak` and starts fresh.

**server.js truncated on Linux mount (Windows dev machine)**
→ Bash heredoc writes on Windows-mounted FS can truncate mid-write. Use Python to write large blocks, then verify with `node --check server.js`.
