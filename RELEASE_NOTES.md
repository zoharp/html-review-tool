# Release Notes

## [1.0.0] — 2026-05-12

### Features
- **Admin Preview Annotations** — Admins can now add comments and suggest changes directly in Preview mode
- **Full annotation system** — Reviewers can comment on text selections and suggest replacements
- **Admin dashboard** — Manage documents, invites, and review all annotations
- **Presence indicators** — Real-time indicators showing active reviewers
- **Document export** — Export final HTML with accepted changes applied
- **Threaded discussions** — Reply to annotations with inline comments

### Technical
- Backend: Node.js 20 + Express 4
- Database: sql.js (pure-WASM SQLite)
- Frontend: Vanilla JS
- Deployment: Fly.io with persistent volume

### Documentation
- `CLAUDE.md` — Developer instructions
- `system.md` — Features, schema, API, business logic
- `ops.md` — Running and deployment
- `FEATURES_GUIDE.md` — User guides
- `TECHNICAL_REFERENCE.md` — Code architecture
- `IMPLEMENTATION_COMPLETE.md` — Implementation summary

---

## Version History

| Version | Date | Type | Notes |
|---------|------|------|-------|
| 1.0.0 | 2026-05-12 | Release | Initial release with admin annotations |
