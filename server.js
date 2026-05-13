/**
 * HTML Review Tool — server.js
 * Uses sql.js (pure-JS SQLite, no native compilation required)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.replace(/\r/, '').match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const express      = require('express');
const initSqlJs    = require('sql.js');
const nodemailer   = require('nodemailer');
const { v4: uuid } = require('uuid');
const multer       = require('multer');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DB_PATH  = process.env.DB_PATH || path.join(__dirname, 'review.db');
const VERSION  = '1.0.0';

// ── DB helpers ────────────────────────────────────────────────────────────────
let db;

function saveDb() {
  const data = Buffer.from(db.export());
  const tmp  = DB_PATH + '.tmp';
  const bak  = DB_PATH + '.bak';
  fs.writeFileSync(tmp, data);          // write to temp first
  if (fs.existsSync(DB_PATH)) {
    try { fs.copyFileSync(DB_PATH, bak); } catch(_) {} // keep last-good backup
  }
  try {
    fs.renameSync(tmp, DB_PATH);        // atomic swap on Linux/Mac
  } catch(_) {
    fs.copyFileSync(tmp, DB_PATH);      // fallback for Windows cross-device
    try { fs.unlinkSync(tmp); } catch(_2) {}
  }
}

function dbGet(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params) {
  db.run(sql, params);
  saveDb();
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    try {
      db = new SQL.Database(fs.readFileSync(DB_PATH));
      db.exec('SELECT 1'); // quick sanity check
    } catch (e) {
      console.warn('[db] Existing database is corrupt — starting fresh:', e.message);
      const backup = DB_PATH + '.bak';
      fs.copyFileSync(DB_PATH, backup);
      console.warn('[db] Corrupt file backed up to', backup);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL, email TEXT NOT NULL,
      name TEXT, invite_code TEXT NOT NULL UNIQUE, status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY, file_id TEXT NOT NULL, invite_id TEXT,
      reviewer_email TEXT NOT NULL, reviewer_name TEXT, type TEXT NOT NULL,
      selected_text TEXT, context_before TEXT, context_after TEXT,
      comment TEXT, suggested_text TEXT, status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, invite_id TEXT NOT NULL,
      email TEXT NOT NULL, file_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS replies (
      id TEXT PRIMARY KEY,
      annotation_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      author_name TEXT,
      author_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      reference_id TEXT NOT NULL DEFAULT '',
      recipient_email TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Seed default settings (INSERT OR IGNORE so existing values are preserved)
  db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('notif_admin', '1')");
  // Migrations — safe to run on existing DBs
  const annCols = dbAll('PRAGMA table_info(annotations)').map(function(c){ return c.name; });
  if (!annCols.includes('applied'))       dbRun('ALTER TABLE annotations ADD COLUMN applied INTEGER DEFAULT 0');
  if (!annCols.includes('source_ann_id')) dbRun('ALTER TABLE annotations ADD COLUMN source_ann_id TEXT DEFAULT NULL');
  const fileCols = dbAll('PRAGMA table_info(files)').map(function(c){ return c.name; });
  if (!fileCols.includes('parent_id'))    dbRun('ALTER TABLE files ADD COLUMN parent_id TEXT DEFAULT NULL');
  // Notifications table schema migration (ref_key → reference_id + recipient_email)
  const notifCols = dbAll('PRAGMA table_info(notifications)').map(function(c){ return c.name; });
  if (notifCols.includes('ref_key') && !notifCols.includes('reference_id')) {
    db.exec('DROP TABLE notifications');
    db.exec(`CREATE TABLE notifications (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      reference_id TEXT NOT NULL DEFAULT '', recipient_email TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')))`);
    saveDb();
  }
  saveDb();
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    (file.originalname.toLowerCase().endsWith('.html') || file.mimetype === 'text/html')
      ? cb(null, true) : cb(new Error('Only .html files')),
});

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function requireAdmin(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token || !dbGet('SELECT 1 FROM admin_sessions WHERE token = ?', [token]))
    return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireReviewer(req, res, next) {
  const token = req.cookies.reviewer_token;
  const session = token && dbGet('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.reviewerSession = session;
  next();
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Max 10 login attempts per IP per 15 minutes, then locked out
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/version', (_req, res) => {
  res.json({ version: VERSION });
});

app.get('/api/release-notes', (_req, res) => {
  const notes = require('fs').readFileSync('./RELEASE_NOTES.md', 'utf8');
  res.json({ notes });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (req.body.password !== (process.env.ADMIN_PASSWORD || 'admin123'))
    return res.status(401).json({ error: 'Invalid password' });
  const token = uuid();
  dbRun('INSERT INTO admin_sessions (token) VALUES (?)', [token]);
  res.cookie('admin_token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  dbRun('DELETE FROM admin_sessions WHERE token = ?', [req.cookies.admin_token]);
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (_req, res) => res.json({ ok: true }));

// Files
app.get('/api/admin/files', requireAdmin, (_req, res) => {
  res.json(dbAll(`
    SELECT f.id, f.name, f.uploaded_at, f.parent_id,
      COUNT(DISTINCT CASE WHEN i.status != 'revoked' THEN i.id END) AS invite_count,
      COUNT(DISTINCT CASE WHEN i.status = 'pending' THEN i.id END) AS pending_invite_count,
      COUNT(DISTINCT a.id) AS annotation_count,
      COUNT(DISTINCT CASE WHEN a.status='pending' THEN a.id END) AS pending_count
    FROM files f
    LEFT JOIN invites i ON i.file_id=f.id
    LEFT JOIN annotations a ON a.file_id=f.id
    GROUP BY f.id ORDER BY f.uploaded_at ASC`));
});

app.post('/api/admin/files', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const id = uuid();
  dbRun('INSERT INTO files (id,name,content) VALUES (?,?,?)',
    [id, req.file.originalname, req.file.buffer.toString('utf8')]);
  res.json({ id, name: req.file.originalname });
});

app.delete('/api/admin/files/:id', requireAdmin, (req, res) => {
  const fid = req.params.id;
  dbAll('SELECT id FROM invites WHERE file_id=?', [fid]).forEach(({ id }) => {
    dbRun('DELETE FROM annotations WHERE invite_id=?', [id]);
    dbRun('DELETE FROM sessions WHERE invite_id=?', [id]);
  });
  dbRun('DELETE FROM invites WHERE file_id=?', [fid]);
  dbRun('DELETE FROM files WHERE id=?', [fid]);
  res.json({ ok: true });
});

app.patch('/api/admin/files/:id/content', requireAdmin, upload.single('file'), (req, res) => {
  const file = dbGet('SELECT id FROM files WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  dbRun('UPDATE files SET name=?, content=?, uploaded_at=datetime(\'now\') WHERE id=?',
    [req.file.originalname, req.file.buffer.toString('utf8'), file.id]);
  res.json({ ok: true, name: req.file.originalname });
});

// Edit HTML text in-place (no file upload — raw text from the editor)
app.patch('/api/admin/files/:id/text', requireAdmin, (req, res) => {
  const file = dbGet('SELECT id FROM files WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  dbRun("UPDATE files SET content=?, uploaded_at=datetime('now') WHERE id=?", [content, file.id]);
  saveDb();
  res.json({ ok: true });
});

// ── Revisions ────────────────────────────────────────────────────────────────
async function sendRevisionEmail(email, name, inviteCode, newFileName, prevFileName) {
  const link = `${BASE_URL}/review/invite/${inviteCode}`;
  await mailer().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: `New revision ready for review: ${newFileName}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#1a73e8;">New Revision Ready</h2>
      <p>Hello${name ? ' ' + name : ''},</p>
      <p>A new revision of <strong>${prevFileName}</strong> is ready for your review.</p>
      <a href="${link}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 28px;
         text-decoration:none;border-radius:6px;margin:16px 0;">Review New Version →</a>
      <p style="color:#555;font-size:13px;">Or copy: <a href="${link}">${link}</a></p>
      <p style="color:#999;font-size:12px;margin-top:24px;">Personal invite for ${email}.</p>
    </div>`,
  });
}

app.post('/api/admin/files/:id/revise', requireAdmin, upload.single('file'), async (req, res) => {
  const parentFile = dbGet('SELECT * FROM files WHERE id=?', [req.params.id]);
  if (!parentFile) return res.status(404).json({ error: 'Parent file not found' });
  if (!req.file)   return res.status(400).json({ error: 'No file uploaded' });

  const doReInvite = req.body.reInvite === 'true';
  const doImport   = req.body.importAnnotations === 'true';
  const newContent = req.file.buffer.toString('utf8');
  const newId      = uuid();

  dbRun('INSERT INTO files (id, name, content, parent_id) VALUES (?,?,?,?)',
    [newId, req.file.originalname, newContent, parentFile.id]);

  let invited = 0, imported = 0;

  if (doReInvite) {
    const activeInvites = dbAll("SELECT * FROM invites WHERE file_id=? AND status!='revoked'", [parentFile.id]);
    for (const inv of activeInvites) {
      const newInvId = uuid(), newCode = uuid();
      dbRun('INSERT INTO invites (id, file_id, email, name, invite_code) VALUES (?,?,?,?,?)',
        [newInvId, newId, inv.email, inv.name, newCode]);
      invited++;
      sendRevisionEmail(inv.email, inv.name, newCode, req.file.originalname, parentFile.name).catch(() => {});
    }
  }

  if (doImport) {
    const parentAnns = dbAll(
      'SELECT * FROM annotations WHERE file_id=?',
      [parentFile.id]
    );
    for (const ann of parentAnns) {
      if (!ann.selected_text) continue;
      const found = (ann.context_before && newContent.includes(ann.context_before + ann.selected_text))
                 || newContent.includes(ann.selected_text);
      if (!found) continue;
      const newAnnId = uuid();
      dbRun(`INSERT INTO annotations
        (id,file_id,invite_id,reviewer_email,reviewer_name,type,
         selected_text,context_before,context_after,comment,suggested_text,status,source_ann_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [newAnnId, newId, ann.invite_id, ann.reviewer_email, ann.reviewer_name, ann.type,
         ann.selected_text, ann.context_before, ann.context_after,
         ann.comment, ann.suggested_text, ann.status, ann.id, ann.created_at]);
      // Copy replies preserving original timestamps
      const replies = dbAll('SELECT * FROM replies WHERE annotation_id=? ORDER BY created_at ASC', [ann.id]);
      for (const r of replies) {
        dbRun('INSERT INTO replies (id,annotation_id,author_email,author_name,author_role,message,created_at) VALUES (?,?,?,?,?,?,?)',
          [uuid(), newAnnId, r.author_email, r.author_name, r.author_role, r.message, r.created_at]);
      }
      imported++;
    }
  }

  saveDb();
  res.json({ ok: true, id: newId, invited, imported });
});

// Invites
app.get('/api/admin/invites', requireAdmin, (req, res) => {
  const { fileId } = req.query;
  let q = `SELECT i.*, f.name AS file_name, COUNT(a.id) AS annotation_count
    FROM invites i LEFT JOIN files f ON f.id=i.file_id
    LEFT JOIN annotations a ON a.invite_id=i.id`;
  const params = [];
  if (fileId) { q += ' WHERE i.file_id=?'; params.push(fileId); }
  q += ' GROUP BY i.id ORDER BY i.created_at DESC';
  res.json(dbAll(q, params));
});

app.post('/api/admin/invites', requireAdmin, async (req, res) => {
  const { fileId, email, name, message } = req.body;
  if (!fileId || !email) return res.status(400).json({ error: 'fileId and email required' });
  const file = dbGet('SELECT * FROM files WHERE id=?', [fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const emailLower = email.trim().toLowerCase();
  if (dbGet("SELECT 1 FROM invites WHERE file_id=? AND email=? AND status!='revoked'", [fileId, emailLower]))
    return res.status(409).json({ error: 'Active invite already exists for this email + file' });

  const inviteCode = uuid(), id = uuid();
  dbRun('INSERT INTO invites (id,file_id,email,name,invite_code) VALUES (?,?,?,?,?)',
    [id, fileId, emailLower, name || null, inviteCode]);

  const link = `${BASE_URL}/review/invite/${inviteCode}`;
  const customMsgHtml = message
    ? `<div style="background:#f0f7ff;border-left:4px solid #1a73e8;padding:12px 16px;margin:16px 0;border-radius:0 6px 6px 0;">
        <p style="margin:0;color:#1a1a1a;font-size:14px;">${message.replace(/\n/g,'<br>')}</p>
       </div>`
    : '';
  try {
    await mailer().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: emailLower,
      subject: `You're invited to review: ${file.name}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#1a73e8;">Document Review Invitation</h2>
        <p>Hello${name ? ' '+name : ''},</p>
        <p>You've been invited to review <strong>${file.name}</strong>.</p>
        ${customMsgHtml}
        <a href="${link}" style="display:inline-block;background:#1a73e8;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;margin:16px 0;">Open Review Tool →</a>
        <p style="color:#555;font-size:13px;">Or copy: <a href="${link}">${link}</a></p>
        <p style="color:#999;font-size:12px;margin-top:24px;">Personal invite for ${emailLower}.</p>
      </div>`,
    });
    res.json({ ok: true, inviteCode, link });
  } catch (err) {
    dbRun('DELETE FROM invites WHERE id=?', [id]);
    res.status(500).json({ error: 'Email failed: ' + err.message });
  }
});

app.patch('/api/admin/invites/:id', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (typeof name !== 'string') return res.status(400).json({ error: 'name (string) required' });
  const trimmed = name.trim() || null;
  dbRun('UPDATE invites SET name=? WHERE id=?', [trimmed, req.params.id]);
  dbRun('UPDATE annotations SET reviewer_name=? WHERE invite_id=?', [trimmed, req.params.id]);
  res.json({ ok: true });
});

app.patch('/api/admin/invites/:id/revoke', requireAdmin, (req, res) => {
  dbRun("UPDATE invites SET status='revoked' WHERE id=?", [req.params.id]);
  dbRun('DELETE FROM sessions WHERE invite_id=?', [req.params.id]);
  res.json({ ok: true });
});

// Annotations (admin)
app.get('/api/admin/annotations', requireAdmin, (req, res) => {
  const { fileId, status } = req.query;
  let q = `SELECT a.*, f.name AS file_name FROM annotations a LEFT JOIN files f ON f.id=a.file_id WHERE 1=1`;
  const params = [];
  if (fileId) { q += ' AND a.file_id=?'; params.push(fileId); }
  if (status)  { q += ' AND a.status=?';  params.push(status); }
  res.json(dbAll(q + ' ORDER BY a.created_at DESC', params));
});

app.patch('/api/admin/annotations/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['accepted','rejected','pending'].includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  dbRun('UPDATE annotations SET status=? WHERE id=?', [status, req.params.id]);
  res.json({ ok: true });
  notifyReviewerStatus(req.params.id, status).catch(() => {});
});

app.post('/api/admin/annotations/:id/apply', requireAdmin, (req, res) => {
  const ann = dbGet('SELECT * FROM annotations WHERE id=?', [req.params.id]);
  if (!ann) return res.status(404).json({ error: 'Annotation not found' });
  if (ann.type !== 'change') return res.status(400).json({ error: 'Only change annotations can be applied' });
  if (ann.status !== 'accepted') return res.status(400).json({ error: 'Annotation must be accepted before applying' });
  if (ann.applied) return res.status(400).json({ error: 'Already applied' });
  if (!ann.selected_text || !ann.suggested_text) return res.status(400).json({ error: 'Missing text fields' });

  const file = dbGet('SELECT * FROM files WHERE id=?', [ann.file_id]);
  if (!file) return res.status(404).json({ error: 'File not found' });

  let content = file.content;
  let matched = false;

  if (ann.context_before && content.includes(ann.context_before + ann.selected_text)) {
    content = content.replace(ann.context_before + ann.selected_text,
                              ann.context_before + ann.suggested_text);
    matched = true;
  } else if (content.includes(ann.selected_text)) {
    content = content.replace(ann.selected_text, ann.suggested_text);
    matched = true;
  }

  if (!matched) return res.status(422).json({ error: 'Text not found in document — it may have already been changed' });

  dbRun('UPDATE files SET content=? WHERE id=?', [content, ann.file_id]);
  dbRun('UPDATE annotations SET applied=1 WHERE id=?', [ann.id]);
  res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// REVIEWER ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/review/invite/:code', (req, res) => {
  const invite = dbGet("SELECT * FROM invites WHERE invite_code=? AND status!='revoked'", [req.params.code]);
  if (!invite) return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid</title>
    <style>body{font-family:Arial;text-align:center;padding:80px}h2{color:#d32f2f}</style></head>
    <body><h2>Invalid or Expired Invite</h2><p>Contact the document owner.</p></body></html>`);
  res.redirect(`/login.html?code=${encodeURIComponent(req.params.code)}&email=${encodeURIComponent(invite.email)}`);
});

app.post('/api/reviewer/auth', loginLimiter, (req, res) => {
  const { email, inviteCode } = req.body;
  if (!email || !inviteCode) return res.status(400).json({ error: 'email and inviteCode required' });
  const invite = dbGet("SELECT * FROM invites WHERE invite_code=? AND email=? AND status!='revoked'",
    [inviteCode.trim(), email.trim().toLowerCase()]);
  if (!invite) return res.status(401).json({ error: 'Invalid email or invite code' });
  if (invite.status === 'pending')
    dbRun("UPDATE invites SET status='accepted' WHERE id=?", [invite.id]);
  const token = uuid();
  dbRun('INSERT INTO sessions (token,invite_id,email,file_id) VALUES (?,?,?,?)',
    [token, invite.id, invite.email, invite.file_id]);
  res.cookie('reviewer_token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
  res.json({ ok: true, fileId: invite.file_id });
});

app.get('/api/reviewer/me', requireReviewer, (req, res) => {
  const invite = dbGet('SELECT name, email FROM invites WHERE id=?', [req.reviewerSession.invite_id]);
  const file   = dbGet('SELECT id, name FROM files WHERE id=?', [req.reviewerSession.file_id]);
  res.json({ email: req.reviewerSession.email, name: invite ? invite.name : null, file });
});

// Serve HTML with annotation overlay injected
app.get('/api/reviewer/file/:fileId', requireReviewer, (req, res) => {
  if (req.reviewerSession.file_id !== req.params.fileId)
    return res.status(403).json({ error: 'Access denied' });
  const file = dbGet('SELECT * FROM files WHERE id=?', [req.params.fileId]);
  if (!file) return res.status(404).send('File not found');

  const FID = req.params.fileId;
  const overlay = `<style id="__ann_styles__">
  .__ann_comment__{background:rgba(255,193,7,.30);border-bottom:2px solid #f9a825;cursor:pointer;border-radius:2px}
  .__ann_change__ {background:rgba(244,67,54,.18);text-decoration:line-through;border-bottom:2px dashed #c62828;cursor:pointer;border-radius:2px}
  .__ann_accepted__{opacity:.55}.__ann_rejected__{opacity:.35}
  .__ann_highlight__{outline:2px solid #1a73e8!important;border-radius:2px}
</style>
<script id="__ann_script__">
(function(){
'use strict';
var FILE_ID='${FID}';
var currentSelection=null;

function loadAnnotations(){
  fetch('/api/reviewer/annotations/'+FILE_ID,{credentials:'include'})
    .then(function(r){return r.json();})
    .then(function(list){
      window.parent.postMessage({type:'annotations-loaded',annotations:list},'*');
      list.forEach(applyHighlight);
    });
}

function findTextNode(text,before){
  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
    acceptNode:function(n){
      var p=n.parentElement;
      if(!p||p.id==='__ann_script__'||p.tagName==='SCRIPT'||p.tagName==='STYLE')
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }},false);
  var node;
  while((node=walker.nextNode())){
    if(node.textContent.indexOf(text)===-1) continue;
    var pt=node.parentElement?node.parentElement.textContent:node.textContent;
    if(before&&before.length>4){
      var tail=before.slice(-Math.min(20,before.length));
      if(pt.indexOf(tail+text)===-1){
        var cnt=0,p2=0;
        while((p2=pt.indexOf(text,p2))!==-1){cnt++;p2+=text.length;}
        if(cnt>1) continue;
      }
    }
    return{node:node,idx:node.textContent.indexOf(text)};
  }
  return null;
}

function applyHighlight(ann){
  if(!ann.selected_text) return;
  if(document.querySelector('[data-ann-id="'+ann.id+'"]')) return;
  var r=findTextNode(ann.selected_text,ann.context_before);
  if(!r) return;
  try{
    var range=document.createRange();
    range.setStart(r.node,r.idx);
    range.setEnd(r.node,r.idx+ann.selected_text.length);
    var span=document.createElement('span');
    span.dataset.annId=ann.id;
    span.className='__ann__ __ann_'+ann.type+'__ __ann_'+ann.status+'__';
    range.surroundContents(span);
    span.addEventListener('click',function(e){
      e.stopPropagation();
      window.parent.postMessage({type:'annotation-click',annotationId:ann.id},'*');
    });
  }catch(e){}
}

function removeHighlights(){
  document.querySelectorAll('.__ann__').forEach(function(el){
    var p=el.parentNode;
    while(el.firstChild) p.insertBefore(el.firstChild,el);
    p.removeChild(el);
  });
}

var _selDebounce=null;
document.addEventListener('selectionchange',function(){
  clearTimeout(_selDebounce);
  _selDebounce=setTimeout(function(){
    var sel=window.getSelection();
    if(!sel||sel.isCollapsed||!sel.toString().trim()){
      if(currentSelection){currentSelection=null;window.parent.postMessage({type:'clear-selection'},'*');}
      return;
    }
    var text=sel.toString().trim();
    var range=sel.getRangeAt(0);
    var rect=range.getBoundingClientRect();
    var container=range.commonAncestorContainer;
    var parentEl=container.nodeType===3?container.parentElement:container;
    var full=parentEl?parentEl.textContent:'';
    var idx=full.indexOf(text);
    var before=idx>=0?full.substring(Math.max(0,idx-40),idx):'';
    var afterCtx=idx>=0?full.substring(idx+text.length,idx+text.length+40):'';
    currentSelection={selectedText:text,contextBefore:before,contextAfter:afterCtx,rect:{top:rect.top,left:rect.left,bottom:rect.bottom,right:rect.right,width:rect.width}};
    window.parent.postMessage({type:'text-selected',selectedText:text,
      contextBefore:before,contextAfter:afterCtx,
      rect:{top:rect.top,left:rect.left,bottom:rect.bottom,right:rect.right,width:rect.width}},'*');
  },120);
});

document.addEventListener('mousedown',function(e){
  if(e.target&&e.target.closest&&e.target.closest('.__ann__')) return;
  clearTimeout(_selDebounce);
  window.parent.postMessage({type:'clear-selection'},'*');
  currentSelection=null;
});

window.addEventListener('message',function(e){
  if(!e.data) return;
  if(e.data.type==='get-selection')
    window.parent.postMessage({type:'selection-data',data:currentSelection},'*');
  if(e.data.type==='clear-selection'){window.getSelection().removeAllRanges();currentSelection=null;}
  if(e.data.type==='reload-annotations'){removeHighlights();loadAnnotations();}
  if(e.data.type==='highlight-annotation'){
    document.querySelectorAll('.__ann_highlight__').forEach(function(el){el.classList.remove('__ann_highlight__');});
    if(e.data.annotationId){
      var el=document.querySelector('[data-ann-id="'+e.data.annotationId+'"]');
      if(el){el.classList.add('__ann_highlight__');el.scrollIntoView({behavior:'smooth',block:'center'});}
    }
  }
});

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',loadAnnotations);
}else{loadAnnotations();}
})();
</script>`;

  let content = file.content;
  content = content.toLowerCase().includes('</body>')
    ? content.replace(/<\/body>/i, overlay + '\n</body>')
    : content + overlay;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(content);
});

// Helper: return Set of all ancestor file IDs for a given file
function getAncestorIds(fileId) {
  const ids = new Set();
  let cur = dbGet('SELECT parent_id FROM files WHERE id=?', [fileId]);
  while (cur && cur.parent_id) {
    ids.add(cur.parent_id);
    cur = dbGet('SELECT parent_id FROM files WHERE id=?', [cur.parent_id]);
  }
  return ids;
}

app.get('/api/reviewer/annotations/:fileId', requireReviewer, (req, res) => {
  const sessionFileId = req.reviewerSession.file_id;
  const reqFileId = req.params.fileId;
  if (reqFileId !== sessionFileId) {
    if (!getAncestorIds(sessionFileId).has(reqFileId))
      return res.status(403).json({ error: 'Access denied' });
  }
  res.json(dbAll('SELECT * FROM annotations WHERE file_id=? ORDER BY created_at ASC', [reqFileId]));
});

// Revision info for reviewer — returns full version chain
app.get('/api/reviewer/revisions', requireReviewer, (req, res) => {
  const current = dbGet('SELECT id, name, parent_id FROM files WHERE id=?', [req.reviewerSession.file_id]);
  if (!current) return res.status(404).json({ error: 'File not found' });
  const chain = [current];
  let cur = current;
  while (cur.parent_id) {
    const parent = dbGet('SELECT id, name, parent_id FROM files WHERE id=?', [cur.parent_id]);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  res.json({ current, chain }); // chain = [v1, v2, …, vN=current]
});

// Serve any ancestor file content read-only (no overlay) for version switcher
app.get('/api/reviewer/file/:fileId/readonly', requireReviewer, (req, res) => {
  if (!getAncestorIds(req.reviewerSession.file_id).has(req.params.fileId))
    return res.status(403).json({ error: 'Access denied' });
  const file = dbGet('SELECT content FROM files WHERE id=?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(file.content);
});

// Raw HTML for any file in reviewer's chain (used for track-changes diff)
app.get('/api/reviewer/file/:fileId/raw', requireReviewer, (req, res) => {
  const sessionFileId = req.reviewerSession.file_id;
  const reqFileId = req.params.fileId;
  if (reqFileId !== sessionFileId && !getAncestorIds(sessionFileId).has(reqFileId))
    return res.status(403).json({ error: 'Access denied' });
  const file = dbGet('SELECT content FROM files WHERE id=?', [reqFileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(file.content);
});

app.post('/api/reviewer/annotations', requireReviewer, (req, res) => {
  const { type, selectedText, contextBefore, contextAfter, comment, suggestedText } = req.body;
  if (!type || !selectedText) return res.status(400).json({ error: 'type and selectedText required' });
  if (type==='change' && !suggestedText) return res.status(400).json({ error: 'suggestedText required' });
  if (type==='comment' && !comment)      return res.status(400).json({ error: 'comment required' });
  const invite = dbGet('SELECT * FROM invites WHERE id=?', [req.reviewerSession.invite_id]);
  const id = uuid();
  dbRun(`INSERT INTO annotations
    (id,file_id,invite_id,reviewer_email,reviewer_name,type,
     selected_text,context_before,context_after,comment,suggested_text)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, req.reviewerSession.file_id, req.reviewerSession.invite_id,
     req.reviewerSession.email, invite ? invite.name : null,
     type, selectedText, contextBefore||null, contextAfter||null,
     comment||null, suggestedText||null]);
  const newAnn = dbGet('SELECT * FROM annotations WHERE id=?', [id]);
  res.json(newAnn);
  // Fire-and-forget — don't hold up the response
  maybeNotifyAdmin().catch(() => {});
});

app.patch('/api/reviewer/annotations/:id', requireReviewer, (req, res) => {
  const ann = dbGet('SELECT * FROM annotations WHERE id=? AND invite_id=?',
    [req.params.id, req.reviewerSession.invite_id]);
  if (!ann) return res.status(404).json({ error: 'Not found or not yours' });
  if (ann.status !== 'pending')
    return res.status(403).json({ error: 'Cannot edit after admin has reviewed it' });
  const { comment, suggestedText } = req.body;
  if (ann.type === 'comment') {
    if (!comment || !comment.trim()) return res.status(400).json({ error: 'comment required' });
    dbRun('UPDATE annotations SET comment=? WHERE id=?', [comment.trim(), req.params.id]);
  } else {
    if (!suggestedText || !suggestedText.trim()) return res.status(400).json({ error: 'suggestedText required' });
    dbRun('UPDATE annotations SET suggested_text=? WHERE id=?', [suggestedText.trim(), req.params.id]);
  }
  res.json(dbGet('SELECT * FROM annotations WHERE id=?', [req.params.id]));
});

app.delete('/api/reviewer/annotations/:id', requireReviewer, (req, res) => {
  const ann = dbGet('SELECT * FROM annotations WHERE id=? AND invite_id=?',
    [req.params.id, req.reviewerSession.invite_id]);
  if (!ann) return res.status(404).json({ error: 'Not found or not yours' });
  dbRun('DELETE FROM annotations WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── Admin can add annotations in preview mode ──────────────────────────────────
app.post('/api/admin/annotations', requireAdmin, (req, res) => {
  const { fileId, type, selectedText, contextBefore, contextAfter, comment, suggestedText } = req.body;
  if (!fileId || !type || !selectedText) return res.status(400).json({ error: 'fileId, type, and selectedText required' });
  if (type==='change' && !suggestedText) return res.status(400).json({ error: 'suggestedText required' });
  if (type==='comment' && !comment)      return res.status(400).json({ error: 'comment required' });
  // Verify file exists
  const file = dbGet('SELECT * FROM files WHERE id=?', [fileId]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const id = uuid();
  dbRun(`INSERT INTO annotations
    (id,file_id,invite_id,reviewer_email,reviewer_name,type,
     selected_text,context_before,context_after,comment,suggested_text)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fileId, null, 'admin', 'admin',
     type, selectedText, contextBefore||null, contextAfter||null,
     comment||null, suggestedText||null]);
  const newAnn = dbGet('SELECT * FROM annotations WHERE id=?', [id]);
  res.json(newAnn);
});

app.post('/api/reviewer/logout', requireReviewer, (req, res) => {
  dbRun('DELETE FROM sessions WHERE token=?', [req.cookies.reviewer_token]);
  res.clearCookie('reviewer_token');
  res.json({ ok: true });
});

// ── Settings helpers ──────────────────────────────────────────────────────────

function getSetting(key, defaultVal = '') {
  const row = dbGet('SELECT value FROM settings WHERE key=?', [key]);
  return row ? row.value : defaultVal;
}
function setSetting(key, value) {
  dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, String(value)]);
}

// Per-email opt-out stored as settings key  optout:{email}
function isOptedOut(email) {
  return getSetting('optout:' + (email || '').toLowerCase(), '0') === '1';
}
function setOptOut(email, optOut) {
  setSetting('optout:' + (email || '').toLowerCase(), optOut ? '1' : '0');
}

// ── Notification helpers ──────────────────────────────────────────────────────

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function minutesSince(isoStr) {
  if (!isoStr) return Infinity;
  return (Date.now() - new Date(isoStr + 'Z').getTime()) / 60000;
}

function lastNotifiedAt(type, referenceId, recipientEmail) {
  const row = dbGet(
    'SELECT sent_at FROM notifications WHERE type=? AND reference_id=? AND recipient_email=? ORDER BY sent_at DESC LIMIT 1',
    [type, referenceId || '', recipientEmail]
  );
  return row ? row.sent_at : null;
}

function recordNotification(type, referenceId, recipientEmail) {
  dbRun('INSERT INTO notifications (id,type,reference_id,recipient_email) VALUES (?,?,?,?)',
    [uuid(), type, referenceId || '', recipientEmail]);
}

// Admin digest — at most once every ADMIN_DIGEST_MINUTES minutes
const ADMIN_DIGEST_MINUTES = 120;

async function maybeNotifyAdmin() {
  if (getSetting('notif_admin', '1') !== '1') return; // admin disabled notifications
  const adminEmail = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!adminEmail) return;

  const last = lastNotifiedAt('admin_digest', '', 'admin');
  if (minutesSince(last) < ADMIN_DIGEST_MINUTES) return; // too soon

  // Everything since last digest (or last 24h if first time)
  const sinceDate = last
    ? new Date(new Date(last + 'Z').getTime()).toISOString().replace('T', ' ').slice(0, 19)
    : new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const newAnns = dbAll(
    `SELECT a.*, f.name AS file_name FROM annotations a
     LEFT JOIN files f ON f.id = a.file_id
     WHERE a.created_at > ? ORDER BY a.created_at DESC`,
    [sinceDate]
  );

  const newReplies = dbAll(
    `SELECT r.*, a.selected_text, f.name AS file_name FROM replies r
     LEFT JOIN annotations a ON a.id = r.annotation_id
     LEFT JOIN files f ON f.id = a.file_id
     WHERE r.author_role = 'reviewer' AND r.created_at > ?
     ORDER BY r.created_at DESC`,
    [sinceDate]
  );

  if (!newAnns.length && !newReplies.length) return;

  const annRows = newAnns.map(a =>
    `<tr>
       <td style="padding:7px 10px;border-bottom:1px solid #eee;">${escHtml(a.file_name)}</td>
       <td style="padding:7px 10px;border-bottom:1px solid #eee;">${escHtml(a.reviewer_name || a.reviewer_email)}</td>
       <td style="padding:7px 10px;border-bottom:1px solid #eee;">${a.type === 'comment' ? '💬 Comment' : '✏️ Change'}</td>
       <td style="padding:7px 10px;border-bottom:1px solid #eee;font-style:italic;color:#555;">"${escHtml((a.selected_text || '').slice(0, 70))}"</td>
     </tr>`
  ).join('');

  const replyNote = newReplies.length
    ? `<p style="margin-top:14px;color:#555;">Also ${newReplies.length} new reviewer repl${newReplies.length !== 1 ? 'ies' : 'y'} in open threads.</p>`
    : '';

  const total = newAnns.length + newReplies.length;
  const subject = `[Review Tool] ${total} new item${total !== 1 ? 's' : ''} need your attention`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
    <h2 style="color:#1a73e8;margin-bottom:4px;">📋 Review Tool Digest</h2>
    <p style="color:#555;margin-bottom:20px;">Here's what's new since your last update:</p>
    ${newAnns.length ? `
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
      <thead><tr style="background:#f5f5f5;text-align:left;">
        <th style="padding:8px 10px;">File</th>
        <th style="padding:8px 10px;">Reviewer</th>
        <th style="padding:8px 10px;">Type</th>
        <th style="padding:8px 10px;">Selected text</th>
      </tr></thead>
      <tbody>${annRows}</tbody>
    </table>` : ''}
    ${replyNote}
    <p style="margin-top:24px;">
      <a href="${BASE_URL}/admin.html"
         style="background:#1a73e8;color:#fff;padding:10px 24px;text-decoration:none;border-radius:6px;font-size:14px;">
        Open Dashboard →
      </a>
    </p>
    <p style="color:#bbb;font-size:11px;margin-top:28px;">
      You receive this digest at most once every ${ADMIN_DIGEST_MINUTES} minutes.
    </p>
  </div>`;

  try {
    await mailer().sendMail({ from: adminEmail, to: adminEmail, subject, html });
    recordNotification('admin_digest', '', 'admin');
    console.log('[notify] admin digest sent');
  } catch (e) {
    console.error('[notify] admin digest failed:', e.message);
  }
}

// Reviewer: annotation accepted or rejected — one email per unique annotation+status
async function notifyReviewerStatus(annotationId, newStatus) {
  if (newStatus === 'pending') return; // reset — no email
  if (getSetting('notif_admin', '1') !== '1') return; // admin disabled all notifications
  const ann = dbGet(
    `SELECT a.*, f.name AS file_name FROM annotations a
     LEFT JOIN files f ON f.id = a.file_id WHERE a.id = ?`,
    [annotationId]
  );
  if (!ann || !ann.reviewer_email) return;
  if (isOptedOut(ann.reviewer_email)) return; // reviewer opted out

  const refKey = annotationId + ':' + newStatus;
  if (lastNotifiedAt('reviewer_status', refKey, ann.reviewer_email)) return; // already sent

  const accepted  = newStatus === 'accepted';
  const label     = accepted ? '✓ Accepted' : '✗ Rejected';
  const color     = accepted ? '#34a853' : '#ea4335';
  const changeRow = ann.type === 'change'
    ? `<p style="font-size:13px;">Suggested: <span style="background:#e8f5e9;padding:2px 6px;border-radius:3px;">${escHtml(ann.suggested_text || '')}</span></p>`
    : '';

  const invite = dbGet("SELECT invite_code FROM invites WHERE email=? AND file_id=? AND status!='revoked' LIMIT 1",
    [ann.reviewer_email, ann.file_id]);
  const unsubUrl = invite ? `${BASE_URL}/unsubscribe/${invite.invite_code}` : null;

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
    <h2 style="color:${color};">${label}</h2>
    <p>Hello${ann.reviewer_name ? ' ' + escHtml(ann.reviewer_name) : ''},</p>
    <p>Your annotation on <strong>${escHtml(ann.file_name)}</strong> has been <strong>${newStatus}</strong>.</p>
    <div style="background:#f5f5f5;border-left:4px solid ${color};padding:10px 14px;margin:16px 0;border-radius:0 6px 6px 0;font-style:italic;font-size:13px;">
      "${escHtml((ann.selected_text || '').slice(0, 140))}"
    </div>
    ${changeRow}
    <p style="color:#bbb;font-size:11px;margin-top:28px;">
      You are receiving this because you are a reviewer on this document.
      ${unsubUrl ? `· <a href="${unsubUrl}" style="color:#bbb;">Unsubscribe from notifications</a>` : ''}
    </p>
  </div>`;

  try {
    await mailer().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ann.reviewer_email,
      subject: `Your annotation was ${newStatus} — ${ann.file_name}`,
      html
    });
    recordNotification('reviewer_status', refKey, ann.reviewer_email);
    console.log(`[notify] reviewer status (${newStatus}) sent to ${ann.reviewer_email}`);
  } catch (e) {
    console.error('[notify] reviewer status failed:', e.message);
  }
}

// Reviewer: new admin reply on their annotation — at most once per REPLY_COOLDOWN_MINUTES per annotation
const REPLY_COOLDOWN_MINUTES = 60;

async function notifyReviewerReply(annotationId, replyAuthorRole) {
  if (replyAuthorRole === 'reviewer') return; // reviewer's own activity — don't self-notify

  const ann = dbGet(
    `SELECT a.*, f.name AS file_name FROM annotations a
     LEFT JOIN files f ON f.id = a.file_id WHERE a.id = ?`,
    [annotationId]
  );
  if (!ann || !ann.reviewer_email) return;
  if (getSetting('notif_admin', '1') !== '1') return;
  if (isOptedOut(ann.reviewer_email)) return;

  const last = lastNotifiedAt('reviewer_reply', annotationId, ann.reviewer_email);
  if (minutesSince(last) < REPLY_COOLDOWN_MINUTES) return; // too soon

  const recent = dbAll(
    'SELECT * FROM replies WHERE annotation_id=? ORDER BY created_at DESC LIMIT 1',
    [annotationId]
  );
  const latest = recent[0];
  if (!latest) return;

  const invite = dbGet("SELECT invite_code FROM invites WHERE email=? AND file_id=? AND status!='revoked' LIMIT 1",
    [ann.reviewer_email, ann.file_id]);
  const unsubUrl = invite ? `${BASE_URL}/unsubscribe/${invite.invite_code}` : null;

  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
    <h2 style="color:#1a73e8;">💬 New Reply on Your Annotation</h2>
    <p>Hello${ann.reviewer_name ? ' ' + escHtml(ann.reviewer_name) : ''},</p>
    <p>There is a new reply on your annotation in <strong>${escHtml(ann.file_name)}</strong>:</p>
    <div style="background:#f5f5f5;border-left:3px solid #e0e0e0;padding:8px 12px;margin:12px 0;border-radius:0 6px 6px 0;font-style:italic;font-size:13px;color:#666;">
      Your annotation: "${escHtml((ann.selected_text || '').slice(0, 120))}"
    </div>
    <div style="background:#e8f0fe;border-left:4px solid #1a73e8;padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;font-size:13px;">
      <strong>${escHtml(latest.author_name || 'Admin')}:</strong> ${escHtml(latest.message)}
    </div>
    <p style="color:#bbb;font-size:11px;margin-top:28px;">
      You will receive at most one reply notification per hour per annotation thread.
      ${unsubUrl ? `· <a href="${unsubUrl}" style="color:#bbb;">Unsubscribe from notifications</a>` : ''}
    </p>
  </div>`;

  try {
    await mailer().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ann.reviewer_email,
      subject: `New reply on your annotation — ${ann.file_name}`,
      html
    });
    recordNotification('reviewer_reply', annotationId, ann.reviewer_email);
    console.log(`[notify] reviewer reply notification sent to ${ann.reviewer_email}`);
  } catch (e) {
    console.error('[notify] reviewer reply failed:', e.message);
  }
}

// -- Replies (shared helper) --------------------------------------------------
function getReplies(annotationId) {
  return dbAll('SELECT * FROM replies WHERE annotation_id=? ORDER BY created_at ASC', [annotationId]);
}

// Admin reply routes
app.get('/api/admin/annotations/:id/replies', requireAdmin, (req, res) => {
  res.json(getReplies(req.params.id));
});
app.post('/api/admin/annotations/:id/replies', requireAdmin, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  if (!dbGet('SELECT 1 FROM annotations WHERE id=?', [req.params.id]))
    return res.status(404).json({ error: 'Annotation not found' });
  const id = uuid();
  dbRun('INSERT INTO replies (id,annotation_id,author_email,author_name,author_role,message) VALUES (?,?,?,?,?,?)',
    [id, req.params.id, 'admin', 'Admin', 'admin', message.trim()]);
  res.json(dbGet('SELECT * FROM replies WHERE id=?', [id]));
  notifyReviewerReply(req.params.id, 'admin').catch(() => {});
});

// Reviewer reply routes
app.get('/api/reviewer/annotations/:id/replies', requireReviewer, (req, res) => {
  const ann = dbGet('SELECT 1 FROM annotations WHERE id=? AND file_id=?',
    [req.params.id, req.reviewerSession.file_id]);
  if (!ann) return res.status(403).json({ error: 'Access denied' });
  res.json(getReplies(req.params.id));
});
app.post('/api/reviewer/annotations/:id/replies', requireReviewer, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  const ann = dbGet('SELECT * FROM annotations WHERE id=? AND file_id=?',
    [req.params.id, req.reviewerSession.file_id]);
  if (!ann) return res.status(403).json({ error: 'Access denied' });
  const invite = dbGet('SELECT * FROM invites WHERE id=?', [req.reviewerSession.invite_id]);
  const id = uuid();
  dbRun('INSERT INTO replies (id,annotation_id,author_email,author_name,author_role,message) VALUES (?,?,?,?,?,?)',
    [id, req.params.id, req.reviewerSession.email,
     invite ? invite.name : null, 'reviewer', message.trim()]);
  res.json(dbGet('SELECT * FROM replies WHERE id=?', [id]));
  maybeNotifyAdmin().catch(() => {}); // reviewer replied — include in next admin digest
});

// Reply edit / delete
app.patch('/api/admin/replies/:id', requireAdmin, (req, res) => {
  const reply = dbGet("SELECT * FROM replies WHERE id=? AND author_role='admin'", [req.params.id]);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  dbRun('UPDATE replies SET message=? WHERE id=?', [message.trim(), req.params.id]);
  res.json(dbGet('SELECT * FROM replies WHERE id=?', [req.params.id]));
});
app.delete('/api/admin/replies/:id', requireAdmin, (req, res) => {
  const reply = dbGet("SELECT * FROM replies WHERE id=? AND author_role='admin'", [req.params.id]);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  dbRun('DELETE FROM replies WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});
app.patch('/api/reviewer/replies/:id', requireReviewer, (req, res) => {
  const reply = dbGet('SELECT * FROM replies WHERE id=? AND author_email=?',
    [req.params.id, req.reviewerSession.email]);
  if (!reply) return res.status(404).json({ error: 'Not found or not yours' });
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message required' });
  dbRun('UPDATE replies SET message=? WHERE id=?', [message.trim(), req.params.id]);
  res.json(dbGet('SELECT * FROM replies WHERE id=?', [req.params.id]));
});
app.delete('/api/reviewer/replies/:id', requireReviewer, (req, res) => {
  const reply = dbGet('SELECT * FROM replies WHERE id=? AND author_email=?',
    [req.params.id, req.reviewerSession.email]);
  if (!reply) return res.status(404).json({ error: 'Not found or not yours' });
  dbRun('DELETE FROM replies WHERE id=?', [req.params.id]);
  res.json({ ok: true });
});

// ── Admin settings ────────────────────────────────────────────────────────────
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  res.json({ notificationsEnabled: getSetting('notif_admin', '1') === '1' });
});
app.patch('/api/admin/settings', requireAdmin, (req, res) => {
  const { notificationsEnabled } = req.body;
  if (typeof notificationsEnabled !== 'boolean')
    return res.status(400).json({ error: 'notificationsEnabled (boolean) required' });
  setSetting('notif_admin', notificationsEnabled ? '1' : '0');
  res.json({ ok: true, notificationsEnabled });
});

// ── Reviewer notification opt-out ─────────────────────────────────────────────
app.post('/api/reviewer/notifications/optout', requireReviewer, (req, res) => {
  const { optOut } = req.body; // true = opt out, false = opt back in
  if (typeof optOut !== 'boolean') return res.status(400).json({ error: 'optOut (boolean) required' });
  setOptOut(req.reviewerSession.email, optOut);
  res.json({ ok: true, optOut });
});
app.get('/api/reviewer/notifications/status', requireReviewer, (req, res) => {
  res.json({ optedOut: isOptedOut(req.reviewerSession.email) });
});

// ── Public unsubscribe / resubscribe (one-click from email) ───────────────────
function unsubPage(title, message, color, resubUrl) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#fff;border-radius:12px;padding:40px 36px;max-width:420px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1)}
    h2{color:${color};margin-bottom:12px} p{color:#555;line-height:1.6}
    a{display:inline-block;margin-top:20px;padding:10px 24px;background:${color};color:#fff;text-decoration:none;border-radius:6px;font-size:14px}
  </style></head><body>
  <div class="card">
    <h2>${escHtml(title)}</h2>
    <p>${escHtml(message)}</p>
    ${resubUrl ? `<a href="${escHtml(resubUrl)}">Re-enable notifications</a>` : ''}
  </div></body></html>`;
}

app.get('/unsubscribe/:inviteCode', (req, res) => {
  const invite = dbGet('SELECT * FROM invites WHERE invite_code=?', [req.params.inviteCode]);
  if (!invite) return res.status(404).send(unsubPage('Link Expired', 'This unsubscribe link is no longer valid.', '#ea4335', null));
  setOptOut(invite.email, true);
  const resubUrl = `${BASE_URL}/resubscribe/${req.params.inviteCode}`;
  res.send(unsubPage(
    'Unsubscribed',
    `${escHtml(invite.email)} will no longer receive email notifications for document reviews.`,
    '#34a853',
    resubUrl
  ));
});

app.get('/resubscribe/:inviteCode', (req, res) => {
  const invite = dbGet('SELECT * FROM invites WHERE invite_code=?', [req.params.inviteCode]);
  if (!invite) return res.status(404).send(unsubPage('Link Expired', 'This link is no longer valid.', '#ea4335', null));
  setOptOut(invite.email, false);
  res.send(unsubPage(
    'Notifications Re-enabled',
    `${escHtml(invite.email)} will now receive email notifications again.`,
    '#1a73e8',
    null
  ));
});

// Full version chain for a file (admin)
app.get('/api/admin/files/:id/chain', requireAdmin, (req, res) => {
  const current = dbGet('SELECT id, name, parent_id FROM files WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Not found' });
  const chain = [current];
  let cur = current;
  while (cur.parent_id) {
    const parent = dbGet('SELECT id, name, parent_id FROM files WHERE id=?', [cur.parent_id]);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  res.json({ current, chain });
});

// Raw HTML for any file (admin, used for track-changes diff)
app.get('/api/admin/file/:fileId/raw', requireAdmin, (req, res) => {
  const file = dbGet('SELECT content FROM files WHERE id=?', [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(file.content);
});

// -- Export accepted changes --------------------------------------------------
app.get('/api/admin/files/:id/export', requireAdmin, (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const changes = dbAll(
    "SELECT * FROM annotations WHERE file_id=? AND type='change' AND status='accepted' AND (applied IS NULL OR applied=0) ORDER BY created_at ASC",
    [req.params.id]
  );
  let content = file.content;
  let applied = 0;
  changes.forEach(function(c) {
    if (!c.selected_text || !c.suggested_text) return;
    if (c.context_before && content.includes(c.context_before + c.selected_text)) {
      content = content.replace(c.context_before + c.selected_text,
                                c.context_before + c.suggested_text);
      applied++;
    } else if (content.includes(c.selected_text)) {
      content = content.replace(c.selected_text, c.suggested_text);
      applied++;
    }
  });
  const filename = file.name.replace(/\.html$/i, '') + '_revised.html';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('X-Applied-Changes', String(applied));
  res.send(content);
});

// -- Export annotations as markdown for AI ----------------------------------
app.get('/api/admin/files/:id/export-annotations', requireAdmin, (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id=?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });
  
  const annotations = dbAll(
    "SELECT * FROM annotations WHERE file_id=? AND status='accepted' ORDER BY type DESC, created_at ASC",
    [req.params.id]
  );
  
  let md = '# Accepted Annotations\n\n';
  md += '**File:** ' + file.name + '\n';
  md += '**Exported:** ' + new Date().toISOString() + '\n\n';
  
  const changes = annotations.filter(a => a.type === 'change');
  const comments = annotations.filter(a => a.type === 'comment');
  
  md += '## Summary\n';
  md += '- **Change suggestions:** ' + changes.length + '\n';
  md += '- **Comments:** ' + comments.length + '\n\n';
  
  // Changes section
  if (changes.length > 0) {
    md += '## Change Suggestions\n\n';
    changes.forEach((a, i) => {
      md += '### Change #' + (i+1) + '\n';
      md += '**Reviewer:** ' + (a.reviewer_name || a.reviewer_email || 'Unknown') + '\n';
      md += '**Date:** ' + a.created_at + '\n';
      md += '**Location:** `' + (a.context_before || '') + '**' + a.selected_text + '**' + (a.context_after || '') + '`\n\n';
      md += '**Find:** `' + a.selected_text + '`\n\n';
      md += '**Replace with:** `' + a.suggested_text + '`\n\n';
      if (a.comment) {
        md += '**Note:** ' + a.comment + '\n\n';
      }
      md += '---\n\n';
    });
  }
  
  // Comments section
  if (comments.length > 0) {
    md += '## Comments\n\n';
    comments.forEach((a, i) => {
      md += '### Comment #' + (i+1) + '\n';
      md += '**Reviewer:** ' + (a.reviewer_name || a.reviewer_email || 'Unknown') + '\n';
      md += '**Date:** ' + a.created_at + '\n';
      md += '**Location:** `' + (a.context_before || '') + '**' + a.selected_text + '**' + (a.context_after || '') + '`\n\n';
      md += '**Text being commented on:** `' + a.selected_text + '`\n\n';
      md += '**Comment:** ' + a.comment + '\n\n';
      md += '---\n\n';
    });
  }
  
  const filename = file.name.replace(/\.html$/i, '') + '_annotations.md';
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(md);
});

// ── Presence Tracking ──────────────────────────────────────────
var activePresence = {}; // { fileId: { userId: { name, email, lastSeen } } }

// Clean up stale presence (older than 5 minutes)
setInterval(function(){
  var now = Date.now();
  Object.keys(activePresence).forEach(function(fileId){
    Object.keys(activePresence[fileId]).forEach(function(userId){
      if(now - activePresence[fileId][userId].lastSeen > 5 * 60 * 1000){
        delete activePresence[fileId][userId];
      }
    });
    if(Object.keys(activePresence[fileId]).length === 0){
      delete activePresence[fileId];
    }
  });
}, 30 * 1000); // Check every 30 seconds

// Set user as active on a file
app.post('/api/presence/set-active', (req, res) => {
  var fileId = req.body.fileId;
  var userId = req.session.userId || req.session.email || 'anonymous';
  var email = req.session.email || 'unknown@example.com';
  var name = req.session.name || (email ? email.split('@')[0] : 'User');

  if(!fileId){
    return res.status(400).json({ error: 'fileId required' });
  }

  if(!activePresence[fileId]){
    activePresence[fileId] = {};
  }

  activePresence[fileId][userId] = {
    name: name,
    email: email,
    lastSeen: Date.now()
  };

  res.json({ ok: true });
});

// Get active users for a file
app.get('/api/presence/active/:fileId', (req, res) => {
  var fileId = req.params.fileId;
  var users = [];

  if(activePresence[fileId]){
    Object.keys(activePresence[fileId]).forEach(function(userId){
      users.push({
        userId: userId,
        name: activePresence[fileId][userId].name,
        email: activePresence[fileId][userId].email,
        initial: activePresence[fileId][userId].name.charAt(0).toUpperCase()
      });
    });
  }

  res.json(users);
});



// -- Admin preview (admin-authed, same overlay as reviewer but uses admin annotations API) --
app.get('/api/admin/preview/file/:fileId', requireAdmin, (req, res) => {
  const file = dbGet('SELECT * FROM files WHERE id=?', [req.params.fileId]);
  if (!file) return res.status(404).send('File not found');
  const FID = req.params.fileId;
  const annStyle = [
    '<style id="__ann_styles__">',
    '  .__ann_comment__{background:rgba(255,193,7,.30);border-bottom:2px solid #f9a825;cursor:pointer;border-radius:2px}',
    '  .__ann_change__ {background:rgba(244,67,54,.18);text-decoration:line-through;border-bottom:2px dashed #c62828;cursor:pointer;border-radius:2px}',
    '  .__ann_accepted__{opacity:.55}.__ann_rejected__{opacity:.35}',
    '  .__ann_highlight__{outline:2px solid #1a73e8!important;border-radius:2px}',
    '</style>'
  ].join('\n');

  const annScript = [
    '<script id="__ann_script__">',
    '(function(){',
    "'use strict';",
    "var FILE_ID='" + FID + "';",
    'function loadAnnotations(){',
    "  fetch('/api/admin/annotations?fileId='+FILE_ID,{credentials:'include'})",
    '    .then(function(r){return r.json();})',
    '    .then(function(list){',
    "      window.parent.postMessage({type:'annotations-loaded',annotations:list},'*');",
    '      list.forEach(applyHighlight);',
    '    });',
    '}',
    'function applyHighlight(ann){',
    '  if(!ann.selected_text) return;',
    "  if(document.querySelector('[data-ann-id=\"'+ann.id+'\"')) return;",
    '  var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){',
    "    var p=n.parentElement;if(!p||p.id==='__ann_script__'||p.tagName==='SCRIPT'||p.tagName==='STYLE') return NodeFilter.FILTER_REJECT;",
    '    return NodeFilter.FILTER_ACCEPT;}},false);',
    '  var node;',
    '  while((node=walker.nextNode())){',
    '    if(node.textContent.indexOf(ann.selected_text)===-1) continue;',
    '    try{',
    '      var idx=node.textContent.indexOf(ann.selected_text);',
    '      var range=document.createRange();',
    '      range.setStart(node,idx);range.setEnd(node,idx+ann.selected_text.length);',
    '      var span=document.createElement("span");',
    '      span.dataset.annId=ann.id;',
    "      span.className='__ann__ __ann_'+ann.type+'__ __ann_'+ann.status+'__';",
    '      range.surroundContents(span);',
    '      span.addEventListener("click",function(e){',
    '        e.stopPropagation();',
    "        window.parent.postMessage({type:'annotation-click',annotationId:ann.id},'*');",
    '      });',
    '      break;',
    '    }catch(e){}',
    '  }',
    '}',
    'function removeHighlights(){',
    "  document.querySelectorAll('.__ann__').forEach(function(el){",
    '    var p=el.parentNode;while(el.firstChild)p.insertBefore(el.firstChild,el);p.removeChild(el);',
    '  });',
    '}',
    "window.addEventListener('message',function(e){",
    '  if(!e.data) return;',
    "  if(e.data.type==='reload-annotations'){removeHighlights();loadAnnotations();}",
    "  if(e.data.type==='highlight-annotation'){",
    "    document.querySelectorAll('.__ann_highlight__').forEach(function(el){el.classList.remove('__ann_highlight__');});",
    '    if(e.data.annotationId){',
    '      var el=document.querySelector(\'[data-ann-id="\'+e.data.annotationId+\'"]\');',
    "      if(el){el.classList.add('__ann_highlight__');el.scrollIntoView({behavior:'smooth',block:'center'});}",
    '    }',
    '  }',
    '});',
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',loadAnnotations);}",
    'else{loadAnnotations();}',
    '})();',
    '<\/script>'
  ].join('\n');

  const overlay = annStyle + '\n' + annScript;
  let content = file.content;
  content = content.toLowerCase().includes('</body>')
    ? content.replace(/<\/body>/i, overlay + '\n</body>')
    : content + overlay;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(content);
});

app.get('/', function(_req, res){ res.redirect('/admin.html'); });

initDb().then(function() {
  app.listen(PORT, function() {
    console.log('HTML Review Tool running at ' + BASE_URL);
    console.log('Admin: ' + BASE_URL + '/admin.html');
    console.log('Password: ' + (process.env.ADMIN_PASSWORD || 'admin123'));
  });
}).catch(function(err){
  console.error("DB init failed:", err);
  process.exit(1);
});
