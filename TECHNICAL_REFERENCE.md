# Technical Reference

## Architecture Overview

### Feature 1: Admin Preview Annotations

**Endpoints:**
```
POST /api/admin/annotations
  Body: { fileId, type, selectedText, contextBefore, contextAfter, comment/suggestedText }
  Returns: annotation object
```

**Database Schema:**
```sql
annotations table:
  - Made invite_id nullable (was NOT NULL)
  - Admin annotations have invite_id=NULL, reviewer_email='admin'
```

**Frontend Changes (preview.html):**
- `setupIframeSelectionListener()` — Detects text selection in iframe
- `handleIframeSelection()` — Shows toolbar with selected text
- `openModal(type)` / `closeModal()` — Modal form for annotation input
- `submitAnnotation()` — Creates annotation via POST endpoint
- CSS: Selection toolbar (dark, floating), annotation modal, button styles

**Text Selection Implementation:**
- TreeWalker API for DOM traversal
- Range API for text extraction and context
- Iframe context extraction (40 chars before/after)
- Handles cross-iframe selection challenges

---

## Feature 2: Export Annotations as Markdown

**Endpoint:**
```
GET /api/admin/files/:id/export-annotations
  Returns: text/markdown file download
  Filename: {docname}_annotations.md
```

**Server Implementation (server.js, line ~1214):**
```javascript
app.get('/api/admin/files/:id/export-annotations', requireAdmin, (req, res) => {
  // 1. Get file by ID
  // 2. Query annotations where status='accepted'
  // 3. Separate into changes and comments
  // 4. Format as markdown with:
  //    - Header: file name, export timestamp
  //    - Summary: counts
  //    - Change suggestions: find/replace pairs
  //    - Comments: location + text
  // 5. Set content-type: text/markdown
  // 6. Return as file download
});
```

**Markdown Structure:**
```
# Accepted Annotations
**File:** {name}
**Exported:** {ISO timestamp}

## Summary
- **Change suggestions:** {count}
- **Comments:** {count}

## Change Suggestions
### Change #N
**Reviewer:** {name}
**Date:** {ISO date}
**Location:** `{context}`
**Find:** `{original text}`
**Replace with:** `{replacement text}`
**Note:** {comment}

## Comments
### Comment #N
**Reviewer:** {name}
**Date:** {ISO date}
**Location:** `{context}`
**Text:** `{commented text}`
**Comment:** {comment text}
```

**Frontend Implementation (admin.html):**
```javascript
function exportAnnotations(){
  if(!selectedFileId) return;
  const link = document.createElement('a');
  link.href = '/api/admin/files/' + selectedFileId + '/export-annotations';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
```

**UI:** Blue button "📋 Export Annotations" in file controls bar (line 401)

---

## Feature 3: Real-time Presence Indicators

**Endpoints:**

1. **POST /api/presence/set-active**
   ```javascript
   Body: { fileId }
   Response: { ok: true }
   Auth: Requires valid session
   ```

2. **GET /api/presence/active/:fileId**
   ```javascript
   Response: [
     { userId, name, email, initial },
     ...
   ]
   Auth: None (public endpoint)
   ```

**Server Implementation (server.js, line ~1310+):**
```javascript
var activePresence = {}; // { fileId: { userId: { name, email, lastSeen } } }

// Cleanup every 30 seconds
setInterval(function(){
  // Remove sessions older than 5 minutes
  // Delete empty file entries
}, 30 * 1000);

// Set user active
app.post('/api/presence/set-active', requireAuth, (req, res) => {
  var fileId = req.body.fileId;
  var userId = req.session.userId;
  activePresence[fileId][userId] = {
    name, email, lastSeen: Date.now()
  };
  res.json({ ok: true });
});

// Get active users
app.get('/api/presence/active/:fileId', (req, res) => {
  var users = [];
  if(activePresence[req.params.fileId]){
    // Collect and format users
  }
  res.json(users);
});
```

**Frontend Implementation:**

Common to admin.html, reviewer.html, preview.html:

```javascript
var presenceFileId = null;
var presenceUserId = null;
var presencePollInterval = null;

function startPresenceTracking(fileId){
  presenceFileId = fileId;
  // Generate or retrieve userId from localStorage
  // Poll every 2 seconds:
  //   - setPresenceActive() — heartbeat
  //   - pollPresence() — fetch active users
  //   - updatePresenceDisplay() — render circles
}

function updatePresenceDisplay(users){
  // Filter out self
  // Render profile circles with:
  //   - Background gradient (color-coded)
  //   - User initial (13px bold white)
  //   - Tooltip on hover
}
```

**CSS Styling:**
```css
#presence-container {
  display: flex; gap: 8px; align-items: center;
  margin-right: 16px;
}

.presence-circle {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff;
  position: relative; cursor: default;
}

.presence-tooltip {
  position: absolute; bottom: -50px; left: 50%;
  transform: translateX(-50%);
  background: #2c3e50; color: #fff;
  padding: 8px 12px; border-radius: 6px;
  font-size: 12px; opacity: 0; pointer-events: none;
  transition: opacity .15s; z-index: 1001;
}

.presence-circle:hover .presence-tooltip { opacity: 1; }
```

**Data Flow:**
```
User opens file
  ↓
startPresenceTracking(fileId) called
  ↓
Generate/retrieve userId from localStorage
  ↓
Immediate: setPresenceActive() → POST heartbeat
  ↓
Polling loop (every 2 sec):
  ├→ setPresenceActive() — heartbeat
  └→ pollPresence() — fetch active users
  ↓
updatePresenceDisplay(users) — render circles
```

**Session Lifecycle:**
- **Created:** First heartbeat when user opens file
- **Updated:** Every 2 seconds via heartbeat
- **Cleaned:** After 5 minutes without heartbeat
- **Destroyed:** User closes browser/tab or navigates away

---

## Files Modified

### server.js (~1364 lines)
- Line 101: Changed `invite_id TEXT NOT NULL` to `invite_id TEXT`
- Line ~753: Added `POST /api/admin/annotations` endpoint
- Line ~1214: Added `GET /api/admin/files/:id/export-annotations` endpoint
- Line ~1310+: Added presence tracking (POST/GET /api/presence/*)

### public/admin.html
- Header: Added `<div id="presence-container"></div>`
- Styles: Added presence CSS (circles, tooltips, colors)
- Scripts: Added presence functions + polling logic
- selectFile(): Call `startPresenceTracking(fileId)`
- Export button: Added "📋 Export Annotations" (line 401)

### public/reviewer.html
- Header: Added `<div id="presence-container"></div>`
- Styles: Added presence CSS
- Scripts: Added presence functions + polling logic
- Boot: Call `startPresenceTracking(fileId)` after auth

### public/preview.html
- Header: Added `<div id="presence-container"></div>`
- Styles: Added presence CSS
- Scripts: Added presence functions + polling logic
- Boot: Call `startPresenceTracking(fileId)` after auth

---

## Testing & Verification

### Syntax Verification
```bash
node --check server.js          # ✓ OK
# HTML files load without errors
```

### Feature Testing

**Admin Annotations:**
- Text selection → toolbar appears
- Modal saves annotation
- Sidebar shows annotation with admin as reviewer
- Can accept/reject/apply changes

**Markdown Export:**
- Click button → markdown downloads
- File named `{docname}_annotations.md`
- Contains all accepted annotations
- Format is AI-readable

**Presence Indicators:**
- Multiple users on same file
- Profile circles show in header
- Tooltip shows on hover
- Circles disappear when user leaves
- Own profile not shown

---

## Performance Notes

- **Polling interval:** 2 seconds (balance between responsiveness and load)
- **Cleanup interval:** 30 seconds (prevents memory buildup)
- **Session timeout:** 5 minutes (auto-cleanup of inactive users)
- **In-memory storage:** No database persistence (sessions lost on server restart)
- **Scalability:** Current approach OK for small teams, would need optimization for large deployments

---

## Future Enhancements

- [ ] WebSocket instead of polling (real-time updates)
- [ ] Cursor position tracking (show where each user is looking)
- [ ] Rich presence (show current action: reviewing, typing, etc.)
- [ ] Activity indicators (idle/active/away states)
- [ ] Presence persistence (save to database)
- [ ] Notification when specific user joins file
- [ ] Do-not-disturb mode
