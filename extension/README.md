# Silent Changes Announcer for NVDA

A Chrome extension that announces dynamic UI changes to NVDA screen reader
users, with flood protection so a burst of notifications doesn't turn into
an uninterruptible wall of speech.

## Install (unpacked, for the demo)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension` folder.
4. Open the included `test-page/index.html` (double-click it, or drag it
   into Chrome) with NVDA running.

The extension only runs on pages that contain the specific dashboard
structure (`#notif-list`, `#toast`, `#info-modal`, `#btn-enlarge`). On any
other site it does nothing.

## Keyboard commands

| Shortcut | Action |
|---|---|
| **Alt+S** | Check for updates: how long since your last visit, plus a count of what changed (notifications, size changes, modals, pop-ups) since your last check |
| **Alt+M** | Mute / unmute automatic announcements (enlarge, modal, toast, small notification counts) |
| **Alt+Y** | Yes — read out a notification flood (only appears after a flood prompt) |
| **Alt+N** | No — leave the flood alone for now |
| **Alt+C** | Clear all notifications — available for a short window right after you choose to hear a flood |
| **Alt+H** | Hear the full command list again |

## How the flood protection works

- 1–2 notifications arrive within 2 seconds → each is read out automatically.
- 3 or more arrive within 2 seconds → nothing is read automatically. NVDA
  is told "there are new notifications, want to hear them?" and waits for
  Alt+Y or Alt+N.

## Why NVDA's own reading doesn't get stepped on

- Two separate `aria-live` regions are used: an `assertive` one for things
  you directly asked for (Alt+S, Alt+H, flood replies), and a `polite` one
  for automatic events, which is queued and paced so messages never
  overlap each other.
- `MutationObserver`s only watch the specific elements that change
  (`#notif-list`, `#btn-enlarge`, `#info-modal`, `#toast`) — never
  `document.body` — so the live regions this extension creates can never
  be picked up as a "page change" and re-announced, which would otherwise
  create a feedback loop.
