# Admin Preview Annotation Feature — Changes Summary

## Overview
Modified the HTML Review Tool to allow admins to add comments and suggest changes directly in Preview mode, just like reviewers do.

## Changes Made

### 1. **server.js**

#### Schema Change (Line 101)
- Made `invite_id` column nullable in the `annotations` table
- Changed: `invite_id TEXT NOT NULL` → `invite_id TEXT`
- Reason: Admin annotations don't need to be linked to a specific reviewer invite

#### New Endpoint: POST `/api/admin/annotations` (After line 753)
```javascript
app.post('/api/admin/annotations', requireAdmin, (req, res) => {
```
- **Authentication**: Requires admin session (`requireAdmin`)
- **Request body**:
  - `fileId` (required) — which file to annotate
  - `type` (required) — 'comment' or 'change'
  - `selectedText` (required) — the text being annotated
  - `contextBefore`, `contextAfter` — context for matching
  - `comment` (if type='comment') — the comment text
  - `suggestedText` (if type='change') — the replacement text
- **Behavior**: Creates annotation with `reviewer_email='admin'` and `invite_id=NULL`
- **Returns**: The newly created annotation object

### 2. **public/preview.html**

#### New UI Elements
Added selection toolbar and annotation modal (identical to reviewer interface):
- **Toolbar**: Shows selected text + "Comment" and "Suggest Change" buttons
- **Modal**: Form to enter comment or suggested replacement text

#### New Functions

**`setupIframeSelectionListener()`**
- Attaches mouseup/touchend listeners to the iframe
- Detects when text is selected in the document

**`handleIframeSelection()`**
- Extracts selected text and surrounding context
- Calculates 40-char context before and after
- Shows toolbar near the selection with button options
- Stores pending selection in `pendingSelection` variable

**`openModal(type)`**
- Opens annotation modal for 'comment' or 'change' type
- Shows preview of selected text
- Focuses on appropriate textarea (comment or replacement)

**`closeModal()`**
- Closes modal and clears pending selection
- Clears iframe selection

**`submitAnnotation()`**
- Validates input (comment/suggested text required)
- Calls `POST /api/admin/annotations` with stored selection
- Reloads annotations after successful creation
- Shows success/error toast notification

#### Modified Boot Process
- Added `setupIframeSelectionListener()` call after iframe loads
- Now initializes text selection detection when preview opens

#### Keyboard Shortcuts
- `Escape` — Close modal
- `Ctrl/Cmd + Enter` — Submit annotation while modal open

## User Workflow

1. **Admin clicks Preview button** in admin.html
   - Opens preview.html in an overlay
   
2. **Admin selects text** in the rendered HTML
   - A dark toolbar appears above the selection
   - Shows selected text + "Comment" and "Suggest Change" buttons
   
3. **Admin clicks a button** to add comment or suggestion
   - Modal dialog opens with the selected text shown
   - Textarea for comment or suggested replacement
   
4. **Admin types and saves**
   - Click "Save" or press Ctrl/Cmd+Enter
   - Annotation is created via POST `/api/admin/annotations`
   
5. **Annotation appears in sidebar**
   - Shows as a pending annotation from "admin"
   - Can be viewed in discussion threads
   - Subject to same accept/reject workflow as reviewer annotations

## Technical Details

- **Admin annotations** have `reviewer_email='admin'` and `invite_id=NULL`
- **Notification**: No email notifications for admin annotations (fire-and-forget disabled)
- **Overlay**: Admin annotations automatically appear highlighted in the preview alongside reviewer annotations
- **Database**: `invite_id` is now nullable; existing code works fine with NULL values
- **Preview**: The `/api/admin/preview/file/:fileId` overlay endpoint automatically shows admin annotations via the existing annotation overlay script

## Compatibility

- ✅ Existing reviewer workflow unchanged
- ✅ Admin reject/accept/apply/reply operations work on admin annotations
- ✅ Export and version chain features work normally
- ✅ All existing tests should pass (no breaking changes)

## Files Modified

1. `/server.js` — Added endpoint, made schema change
2. `/public/preview.html` — Added UI and JavaScript functions

## Testing Notes

- Admin can select text in preview and see toolbar appear
- Modal opens with correct title/placeholder based on annotation type
- Annotations save with status='pending' and reviewer_email='admin'
- Admin annotations appear in sidebar filter with other annotations
- Can be accepted/rejected/replied-to like any other annotation
