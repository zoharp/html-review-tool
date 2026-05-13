# Developer Reference — Admin Annotation Feature

## Architecture Overview

The feature reuses the existing annotation infrastructure:
- Same database table (`annotations`)
- Same approval/rejection logic
- Same overlay rendering
- New endpoint to create admin annotations
- New UI in preview mode for text selection

## Code Changes

### server.js Changes

#### 1. Schema Change (Line 101)
```javascript
// Before
invite_id TEXT NOT NULL,

// After  
invite_id TEXT,
```
Makes `invite_id` nullable. Admin annotations set `invite_id=NULL`.

#### 2. New Endpoint
```javascript
app.post('/api/admin/annotations', requireAdmin, (req, res) => {
  const { fileId, type, selectedText, contextBefore, contextAfter, comment, suggestedText } = req.body;
  // Validation...
  const id = uuid();
  dbRun(`INSERT INTO annotations(...) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, fileId, null, 'admin', 'admin', type, selectedText, contextBefore||null, contextAfter||null, comment||null, suggestedText||null]);
  // Returns new annotation
});
```

**Key points:**
- `requireAdmin` middleware validates session
- `invite_id` is explicitly set to `null`
- `reviewer_email` and `reviewer_name` both set to `'admin'`
- No notification triggered (fire-and-forget disabled)
- Returns the created annotation object

### preview.html Changes

#### 1. Global Variables
```javascript
var pendingSelection = null;  // Current text selection
var modalType = null;         // 'comment' or 'change'
```

#### 2. Iframe Selection Detection
```javascript
function setupIframeSelectionListener() {
  var frame = document.getElementById('preview-frame');
  if(!frame) return;
  frame.addEventListener('load', function(){
    try {
      var doc = frame.contentDocument;
      if(!doc) return;
      doc.addEventListener('mouseup', handleIframeSelection);
      doc.addEventListener('touchend', handleIframeSelection);
    } catch(e) {}
  });
}
```

Attaches to iframe's mouseup/touchend to detect selections.

#### 3. Selection Handler
```javascript
function handleIframeSelection() {
  var selection = doc.getSelection();
  if(!selection || !selection.toString().trim()) {
    hideToolbar();
    return;
  }
  
  var selectedText = selection.toString();
  var range = selection.getRangeAt(0);
  
  // Extract context (40 chars before/after)
  var preRange = doc.createRange();
  preRange.selectNodeContents(doc.body);
  preRange.setEnd(range.startContainer, range.startOffset);
  var contextBefore = preRange.toString().slice(-40);
  
  var postRange = doc.createRange();
  postRange.selectNodeContents(doc.body);
  postRange.setStart(range.endContainer, range.endOffset);
  var contextAfter = postRange.toString().slice(0, 40);
  
  pendingSelection = { selectedText, contextBefore, contextAfter };
  
  // Position toolbar
  var rect = range.getBoundingClientRect();
  var frameRect = frame.getBoundingClientRect();
  var toolbar = document.getElementById('sel-toolbar');
  toolbar.style.left = (frameRect.left + rect.left) + 'px';
  toolbar.style.top = (frameRect.top + rect.top - 50) + 'px';
  toolbar.style.display = 'flex';
}
```

**Behavior:**
- Gets selected text from iframe
- Calculates 40-char context (for matching during apply)
- Positions toolbar near selection
- Stores selection data in `pendingSelection`

#### 4. Modal Functions
```javascript
function openModal(type) {
  // Validate selection exists
  // Set modal title and preview
  // Show appropriate textarea (comment or change)
  // Focus on input field
}

function closeModal() {
  // Hide modal
  // Clear iframe selection
  // Clear pendingSelection
}

async function submitAnnotation() {
  // Validate input
  // POST to /api/admin/annotations
  // Reload annotations
  // Show toast notification
}
```

#### 5. HTML Elements
```html
<div id="sel-toolbar">
  <span class="sel-text" id="sel-preview"></span>
  <button onclick="openModal('comment')">💬 Comment</button>
  <button onclick="openModal('change')">✏️ Suggest Change</button>
</div>

<div id="ann-modal">
  <!-- Form with comment/change textareas -->
</div>
```

## Data Flow

### Creating an Admin Annotation

```
User selects text in iframe
    ↓
handleIframeSelection() triggers
    ↓
Toolbar appears, selection stored in pendingSelection
    ↓
User clicks "Comment" or "Suggest Change"
    ↓
openModal('comment'|'change')
    ↓
User enters text and clicks Save
    ↓
submitAnnotation() builds request body:
  {
    fileId: current file ID,
    type: 'comment'|'change',
    selectedText: text,
    contextBefore: 40 chars,
    contextAfter: 40 chars,
    comment: text (if type=comment),
    suggestedText: text (if type=change)
  }
    ↓
POST /api/admin/annotations
    ↓
Server validates and creates row with:
  - invite_id = NULL
  - reviewer_email = 'admin'
  - reviewer_name = 'admin'
    ↓
Returns annotation object
    ↓
preview.html reloads annotations
    ↓
Annotation appears in sidebar
```

### Displaying Admin Annotations

```
Annotation overlay script loads in preview
    ↓
Calls GET /api/admin/annotations?fileId=X
    ↓
Returns ALL annotations (including those with invite_id=NULL)
    ↓
Script highlights each annotation in document
    ↓
Admin and reviewer annotations both visible
    ↓
Admin can click to focus annotation in sidebar
```

## Integration Points

### Existing Endpoints Used

- `GET /api/admin/annotations?fileId=X` — Already works with `invite_id=NULL`
- `PATCH /api/admin/annotations/:id` — Accept/reject admin annotations
- `POST /api/admin/annotations/:id/replies` — Reply to admin annotations
- `POST /api/admin/annotations/:id/apply` — Apply admin changes to document
- `GET /api/admin/files/:id/export` — Include admin changes in export

All existing admin endpoints automatically support admin annotations.

### Overlay Behavior

The annotation overlay script (injected by `/api/admin/preview/file/:fileId`) already:
- Loads all annotations via `/api/admin/annotations?fileId=`
- Highlights them by wrapping text in spans
- Handles styling (comment vs change colors)
- Responds to click events

Admin annotations appear automatically because they're returned by the same GET endpoint.

## Error Handling

### Client-Side Validation
- Text must be selected (toast: "Please select some text first")
- Comment must be non-empty (toast: "Please enter a comment")
- Suggested text must be non-empty (toast: "Please enter your suggested replacement")

### Server-Side Validation
- fileId, type, selectedText required
- comment required if type='comment'
- suggestedText required if type='change'
- File must exist
- Admin must be authenticated

### Request Failures
- Toast shows error message from server response
- Modal stays open, user can retry
- Button re-enabled after request completes

## Testing Checklist

- [ ] Admin can select text in preview iframe
- [ ] Toolbar appears at correct position
- [ ] Clicking "Comment" opens comment modal
- [ ] Clicking "Suggest Change" opens change modal
- [ ] Modal shows correct selected text preview
- [ ] Escaping modal closes it and clears selection
- [ ] Submitting valid annotation creates database entry
- [ ] Annotation appears in sidebar immediately
- [ ] Admin annotations show reviewer_email='admin'
- [ ] Admin annotations have invite_id=NULL
- [ ] Can accept/reject admin annotations
- [ ] Can reply to admin annotations
- [ ] Admin changes can be applied to document
- [ ] Admin annotations show in export
- [ ] No email notifications for admin annotations
- [ ] Existing reviewer workflow unaffected

## Performance Considerations

- **Text selection detection**: Low overhead, DOM-based
- **Context extraction**: O(n) but limited to 40 chars
- **Modal rendering**: Minimal, reuses existing modal
- **Database**: Single INSERT per annotation (existing approach)
- **Overlay**: Uses existing highlight mechanism

## Future Enhancements

- Email notification option for admin annotations
- Admin role/name customization (instead of hardcoded 'admin')
- Bulk annotation from suggestions
- Annotation templates
- Auto-apply accepted admin annotations
