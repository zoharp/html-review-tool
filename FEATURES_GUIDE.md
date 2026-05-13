# Features Guide

## Feature 1: Admin Preview Annotations

Admins can add comments and suggest changes directly in preview mode, just like reviewers.

### How to Use

1. Click **Preview** button on a file in the admin dashboard
2. Select text in the document
3. A toolbar appears with **💬 Comment** and **✏️ Suggest Change** buttons
4. Click either button to open annotation form
5. Enter your comment or suggested text
6. Click **Save** to create the annotation
7. Manage annotations in the sidebar (accept, reject, reply, apply changes)

### Features
- ✅ Text selection with context extraction
- ✅ Comments and change suggestions
- ✅ Accept/reject/reply to own annotations
- ✅ Apply changes directly to document
- ✅ Export annotations for AI implementation

---

## Feature 2: Export Annotations as Markdown

Download all accepted annotations as a markdown file optimized for AI to read and implement changes.

### How to Use

1. Review and **accept** annotations in the admin dashboard
2. Click **📋 Export Annotations** button on the file
3. Markdown file downloads automatically
4. Share with AI assistant along with original HTML
5. Receive updated HTML with changes applied

### Markdown Format

```markdown
# Accepted Annotations

**File:** document.html
**Exported:** 2026-05-12T22:15:00.000Z

## Summary
- **Change suggestions:** N
- **Comments:** M

## Change Suggestions

### Change #1
**Reviewer:** John Doe
**Date:** 2026-05-11T14:30:00Z
**Location:** `context...`

**Find:** `original text`
**Replace with:** `replacement text`
**Note:** explanation

## Comments

### Comment #1
**Reviewer:** Jane Smith
**Date:** 2026-05-11T15:45:00Z
**Location:** `context...`

**Text:** `comment text`
**Note:** explanation
```

### Example AI Prompt

```
Here are the accepted review annotations from my HTML file:

[paste markdown content]

Original HTML:
[paste original HTML]

Please implement all the changes and return the updated HTML.
```

### What Gets Exported
- ✅ All accepted change suggestions
- ✅ All accepted comments
- ✅ Reviewer names and dates
- ✅ Full context (40 chars before/after)
- ❌ Pending or rejected annotations (not included)

---

## Feature 3: Real-time Presence Indicators

See who is currently viewing or reviewing each file in real-time, Google Docs-style.

### How It Works

1. When you select a file or open a reviewer invite, your presence is automatically tracked
2. Other users viewing the same file see your profile circle in the top bar
3. Hover over any profile circle to see their name and email
4. Your own profile is not shown (to avoid clutter)
5. Presence automatically updates as users join and leave

### Profile Circle Design

- **Size:** 32×32 pixels, circular
- **Content:** User's first initial in white, bold
- **Colors:** Rotating gradients (blue, pink, cyan, green, orange)
- **Location:** Top bar header, right side before Settings button
- **Tooltip:** Shows on hover — `{Name} ({email@example.com})`

### Example

```
Top bar: [📋 Title]  [header-info]  [🎨 Circle with J]  [🎨 Circle with S]  [⚙️ Settings]
                                         John Doe          Sarah Chen
                                     (john@example.com)  (sarah@example.com)
```

### Technical Details

- **Heartbeat:** Every 2 seconds (automatic)
- **Session timeout:** 5 minutes of inactivity
- **Cleanup:** Every 30 seconds
- **Scope:** File-specific only (no global tracking)
- **Privacy:** Presence is in-memory, not stored in database

### Works Everywhere

- ✅ Admin dashboard (file selection)
- ✅ Reviewer interface (when reviewing)
- ✅ Preview mode (when previewing)

---

## Testing All Features

### Feature 1: Admin Preview Annotations
- [ ] Select text in preview → toolbar appears
- [ ] Click "Comment" → modal opens
- [ ] Submit → annotation created in sidebar
- [ ] Can accept, reject, apply changes

### Feature 2: Export Annotations
- [ ] Click "📋 Export Annotations" → file downloads
- [ ] Filename is `{docname}_annotations.md`
- [ ] Markdown contains all accepted annotations
- [ ] Format is clean and AI-readable

### Feature 3: Presence Indicators
- [ ] Open same file in two browsers
- [ ] See other user's profile circle with initial
- [ ] Hover → tooltip shows name and email
- [ ] Your circle not shown in presence list
- [ ] Close browser → circle disappears after ~2-5 sec
