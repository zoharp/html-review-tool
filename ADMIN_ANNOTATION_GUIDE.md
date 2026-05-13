# Admin Annotation Feature — Quick Guide

## What's New?

Admin users can now add comments and suggest changes **directly in the Preview mode**, just like reviewers do. Previously, admins could only view and manage reviewer annotations.

## How It Works

### Step 1: Open Preview
From the admin dashboard, click the **Preview** button on a file
- Preview overlay opens showing the document + all current annotations
- Admin annotation sidebar is visible on the right

### Step 2: Select Text
Click and drag to select any text in the document
- A dark toolbar appears above the selection
- Shows a snippet of the selected text

### Step 3: Choose Annotation Type
The toolbar shows two options:
- **💬 Comment** — Add a comment about the selected text
- **✏️ Suggest Change** — Propose replacement text

### Step 4: Fill in the Form
A modal dialog opens:
- Shows the selected text in a preview box
- Text area for your comment or replacement
- Click **Save** to create the annotation (or Ctrl/Cmd+Enter)

### Step 5: Annotation Appears
Your new annotation shows in the sidebar as:
- **From**: "admin"
- **Status**: "Pending review" (same as reviewer annotations)
- Can be **accepted**, **rejected**, or **replied to**

## Key Points

| Feature | Details |
|---------|---------|
| **Access** | Admins only; requires login |
| **Scope** | Only visible in Preview mode (not in admin dashboard list) |
| **Status** | Starts as "pending"; admin can accept/reject own or others' annotations |
| **Display** | Shows highlighted in document; listed in sidebar like all annotations |
| **Reply** | Can discuss via threaded replies |
| **Apply** | Can be applied directly to document or included in export |

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Close modal | `Esc` |
| Submit annotation | `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac) |

## Example Workflow

1. Admin opens Preview for a document being reviewed
2. Reviews the document and spots an issue
3. Selects the problem text → toolbar appears
4. Clicks "💬 Comment" and adds feedback
5. Clicks "✏️ Suggest Change" on another section and proposes wording
6. Both annotations appear in sidebar as from "admin"
7. Reviewers see admin's comments and suggestions
8. Admin can accept, reject, or export with changes applied

## Differences from Reviewer Annotations

| Aspect | Reviewer | Admin |
|--------|----------|-------|
| **Create in Preview** | ✗ No | ✓ Yes |
| **Create in Dashboard** | N/A | N/A |
| **Can Edit Own** | ✓ Before review | ✓ Before review |
| **Can Accept/Reject** | ✗ No | ✓ Yes (all annotations) |
| **Can Delete Own** | ✓ If pending | ✓ If pending |
| **Shows in Export** | ✓ As "reviewer" | ✓ As "admin" |
| **Email Notifications** | ✓ Yes | ✗ No (fire-and-forget) |

## Technical Notes

- Admin annotations have `reviewer_email='admin'` and `invite_id=NULL`
- They follow the same accept/reject/apply/export logic as reviewer annotations
- The annotation overlay automatically highlights them in preview mode
- They're included in version chain comparisons and diffs

## Troubleshooting

**Toolbar doesn't appear when I select text**
- Make sure the text is in the document iframe
- Text must be at least 1 character
- Clear spaces/whitespace-only selections won't show toolbar

**Modal won't open**
- Check that you clicked "Comment" or "Suggest Change" button
- The text might have been deselected

**Annotation didn't save**
- Verify comment or suggestion text was entered
- Check browser console for error messages
- Ensure you're logged in as admin

**Can't see my annotations in sidebar**
- Filter is set to "Accepted"/"Rejected" — click "All" filter
- Reload the preview with F5
- Check that the annotation was created (should see brief success message)
