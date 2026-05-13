# Real-time Presence Indicators — Feature Guide

## Overview

Users can now see who else is currently working on a file in real-time. Profile circles with user initials appear in the top bar of the admin, reviewer, and preview interfaces, showing which users are actively viewing or editing.

## How It Works

### For Users

1. When you select a file in admin dashboard or open a reviewer invite, your presence is automatically tracked
2. Other users viewing the same file see your profile circle in the top bar
3. Hover over any profile circle to see the user's full name and email
4. Your own profile is not shown (to avoid clutter)

### Technical Implementation

**Server-side (server.js)**:
- Two new endpoints manage presence:
  - `POST /api/presence/set-active` — Mark current user as active on a file
  - `GET /api/presence/active/:fileId` — Get list of active users for a file
- In-memory tracking with automatic cleanup of stale sessions (5 minutes timeout)
- Sessions refresh every 2 seconds via client heartbeat

**Client-side (admin.html, reviewer.html, preview.html)**:
- Presence functions deployed to all three interfaces
- Polls active users every 2 seconds
- Heartbeat sent to mark user as active
- Profile circles render with color-coded gradients
- Tooltip shows name and email on hover

## Files Modified

### Backend
- **server.js** — New endpoints + presence tracking logic (lines ~1310+)

### Frontend
- **public/admin.html** — Presence container in header + polling/display functions
- **public/reviewer.html** — Presence container in header + polling/display functions
- **public/preview.html** — Presence container in header + polling/display functions

## API Endpoints

### POST /api/presence/set-active
Mark current user as active on a file.

**Request:**
```json
{
  "fileId": "file-uuid"
}
```

**Response:**
```json
{
  "ok": true
}
```

**Authentication:** Requires valid session (httpOnly cookie or token)

### GET /api/presence/active/:fileId
Get list of active users for a file.

**Response:**
```json
[
  {
    "userId": "u_random123",
    "name": "John Doe",
    "email": "john@example.com",
    "initial": "J"
  },
  ...
]
```

**No authentication required** — Public endpoint (shows only users actively present)

## User Experience

### Profile Circle Styling
- **Size:** 32x32 pixels
- **Colors:** Rotates through 5 vibrant gradients (blue, pink, cyan, green, orange)
- **Font:** 13px bold white text with user initial
- **Positioning:** Top bar header, right side before Settings button
- **Spacing:** 8px gap between circles

### Hover Tooltip
- **Content:** `{Name} ({email@example.com})`
- **Position:** Appears above profile circle with arrow pointer
- **Animation:** Smooth fade-in on hover
- **Background:** Dark (#2c3e50) with white text
- **Font:** 12px, bold weight for name, no weight for email

### Example Tooltip
```
    John Doe (john@example.com)
         ↓
    [32×32 circle with 'J']
```

## Data Flow

```
User opens file
      ↓
startPresenceTracking(fileId) called
      ↓
User ID generated/retrieved from localStorage
      ↓
setPresenceActive() POST (immediate)
      ↓
Polling loop starts (every 2 seconds):
  ├→ setPresenceActive() — Heartbeat
  └→ pollPresence() — Fetch active users
      ↓
updatePresenceDisplay(users) — Render circles
```

## Cleanup & Timeout

- **Session timeout:** 5 minutes without heartbeat
- **Cleanup frequency:** Every 30 seconds
- **Client heartbeat:** Every 2 seconds (redundancy for network issues)

Users are automatically removed if:
1. Browser closes or tab navigates away
2. No heartbeat received for 5 minutes (network loss, app crash)
3. User explicitly closes the tool

## Testing Checklist

- [ ] Open same file in two browsers/tabs
- [ ] See own user NOT shown in presence list
- [ ] See other user's profile circle with initial
- [ ] Hover over profile circle → tooltip shows name & email
- [ ] Close other browser → circle disappears after ~2-5 seconds
- [ ] Works in admin dashboard
- [ ] Works in reviewer interface
- [ ] Works in preview mode
- [ ] Color cycles correctly with multiple users

## Future Enhancements

- [ ] Rich presence: show current action (reviewing, editing, commenting)
- [ ] Cursor positions: show where each user is looking in the document
- [ ] Activity status: idle/active/away states
- [ ] Click to focus: jump to user's current location
- [ ] Do-not-disturb mode: hide presence if desired
- [ ] Notifications: alert when specific user joins a file
- [ ] Presence history: see who has reviewed a file

## Privacy Notes

- Presence is file-scoped (shows only users on same file)
- No global "who's online" tracking
- Sessions timeout quickly if inactive
- Email shown on hover is already visible to reviewers/admins
- Presence data is not stored in database (in-memory only)
