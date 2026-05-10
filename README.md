# Sidewire

Chrome extension that logs network requests in a side panel — without opening DevTools.

## Install (dev)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Pin the extension, click its icon to open the side panel

## Features

- **Capture** in active tab (default) or all tabs, pause/resume, clear (preserves starred entries)
- **Filters**: URL (substring or `/regex/`), HTTP method, resource type, status bucket (2xx/3xx/4xx/5xx/errors), domain dropdown auto-populated from captured hosts, "★ only" toggle
- **Slow-request highlight** with configurable threshold (orange accent)
- **Star** entries (☆/★) — kept across Clear
- **GraphQL operationName** auto-extracted from POST bodies, shown as a purple badge in the row
- **Click row** → expand details: query params, request/response headers (parsed), request body (formData or raw, JSON pretty-printed), response body (when capture enabled), timing breakdown
- **Click URL** → copies URL to clipboard
- **Per-section copy** buttons + **Copy URL** / **Copy as cURL** / **Copy as fetch**
- **Copy URLs** → copies all visible (filtered) URLs
- **HAR export** → downloads visible entries as `.har` (openable in DevTools, Postman, Insomnia, …)
- **Replay** → re-fires captured request with the same headers/body and shows the new response inline
- **Response body capture** (toggle) — attaches `chrome.debugger` to the active tab. Yellow banner appears while attached.
- **Persistence** — buffer kept in `chrome.storage.session`, survives service worker restarts
- **Hotkeys**: `/` focus URL filter, `Esc` clear filter, `p` pause/resume

## Limitations

- Response bodies require the `chrome.debugger` toggle (yellow banner). Correlation between webRequest and CDP is by URL match, so identical concurrent requests may have their bodies attached to the wrong entry.
- Replay runs from the extension origin; some headers (`Cookie`, `Origin`, `Host`, `Referer`, …) are forbidden by the fetch spec and silently dropped.
- Buffer capped at 2000 entries; oldest non-starred dropped first.
- `chrome.storage.session` quota is ~10MB; very large response bodies may cause persistence to fail silently.
