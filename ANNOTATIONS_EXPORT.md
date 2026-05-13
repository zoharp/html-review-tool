# Export Annotations as Markdown — Feature Guide

## Overview

Admins can now export all accepted annotations (comments and change suggestions) as a **markdown file** formatted specifically for AI to read and implement changes.

## How to Use

### From Admin Dashboard

1. **Select a file** in the files list
2. Click the **📋 Export Annotations** button (next to "⬇ Export HTML")
3. Markdown file downloads automatically
   - Filename: `{document-name}_annotations.md`
   - Contains all accepted comments and change suggestions

## File Format

The exported markdown is structured for AI readability:

```markdown
# Accepted Annotations

**File:** document.html
**Exported:** 2026-05-12T22:15:00.000Z

## Summary
- **Change suggestions:** 3
- **Comments:** 2

## Change Suggestions

### Change #1
**Reviewer:** John Doe
**Date:** 2026-05-11T14:30:00Z
**Location:** `Welcome to our site. **We offer** excellent service...`

**Find:** `We offer`

**Replace with:** `We provide`

**Note:** "Offer" sounds less professional here

---

### Change #2
...

## Comments

### Comment #1
**Reviewer:** Jane Smith
**Date:** 2026-05-11T15:45:00Z
**Location:** `Contact us at **support@example.com** for help`

**Text being commented on:** `support@example.com`

**Comment:** Consider adding a phone number as well for urgent issues

---
```

## AI Implementation Guide

When providing this file to an AI assistant, you can ask:

> "Here are the accepted annotations from my HTML review. Please implement these changes and provide the updated HTML."

The markdown format includes:
- ✅ **Clear "Find" / "Replace with" format** for text changes
- ✅ **Context** showing where in the document each change applies
- ✅ **Reviewer information** for accountability
- ✅ **Notes/Comments** explaining the reasoning
- ✅ **Summary** showing total changes and comments

## Example AI Prompt

```
I have an HTML file with accepted review comments. Here are the annotations:

[paste markdown content]

Please:
1. Implement all the change suggestions
2. Consider the comments and make additional improvements if they suggest improvements
3. Return the complete updated HTML file

Original HTML:
[paste original HTML]
```

## What Gets Exported

**Included:**
- ✅ All **accepted** change suggestions
- ✅ All **accepted** comments
- ✅ Reviewer name and date for each annotation
- ✅ Original text and suggested replacement
- ✅ Full context (surrounding text)

**Not included:**
- ❌ Pending annotations (not yet reviewed)
- ❌ Rejected annotations
- ❌ Internal admin notes
- ❌ Discussion replies

## Technical Details

### Endpoint
```
GET /api/admin/files/:fileId/export-annotations
```

### Response
- **Content-Type:** `text/markdown; charset=utf-8`
- **Filename:** `{document}_annotations.md`
- Sorted by: changes first, then comments; both by creation date

### Format Structure
1. **Header** — File name and export timestamp
2. **Summary** — Count of changes and comments
3. **Change Suggestions** — Detailed list with Find/Replace
4. **Comments** — Detailed list with context

## Use Cases

### 1. **AI Implementation**
Export annotations → Send to Claude/ChatGPT → Get updated HTML

### 2. **External Review**
Share markdown with stakeholders who aren't in the tool

### 3. **Documentation**
Keep a record of what reviewers requested

### 4. **Batch Processing**
Combine multiple files' annotations for a comprehensive update

### 5. **Version Control**
Commit annotation exports with code reviews

## Example Workflow

```
1. Reviewers add comments and suggestions in the tool
2. Admin reviews and accepts relevant ones
3. Click "📋 Export Annotations" → annotations.md downloads
4. Share markdown with developer/AI assistant
5. Receive updated HTML
6. Preview, approve, and export as final HTML
```

## Tips

- **Format for Readability:** The markdown uses clear sections and formatting for easy scanning
- **Context is Key:** Location information helps identify exactly where each change applies
- **AI-Friendly:** Structure follows patterns AI models are trained to understand
- **Preserves Intent:** Notes from reviewers explain the reasoning, not just the changes

## Limitations

- Only exports **accepted** annotations (by design)
- Rejected comments are not included (they're dismissed)
- Pending annotations are not included (not yet approved)
- Internal replies/discussions not included (only original comment)

If you need rejected annotations or pending comments exported, modify the query in the server endpoint.
