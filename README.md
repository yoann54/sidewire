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
- **HAR export** → downloads visible entries as `.har` (openable in DevTools, Postman, Insomnia, …); sensitive header values are redacted by default (toggle "Redact secrets in HAR")
- **HAR import** → loads a `.har` file into the panel; replaying an imported entry asks for confirmation
- **Replay** → re-fires captured request with the same headers/body and shows the new response inline
- **Replay with…** → opens an inline editor: toggle/edit/add query parameters, edit the body (with JSON pretty-print) before re-firing
- **Decode base64** button on base64-encoded response bodies (one click → readable text, JSON auto pretty-printed)
- **JWT decoding** (opt-in toggle) — auto-shows decoded `header` + `payload` JSON under any JWT-shaped header value (works for `Authorization: Bearer …` and similar)
- **Light / dark theme** — toggle in the title bar, follows OS preference by default, persisted across sessions
- **Response body capture** (toggle) — attaches `chrome.debugger` to the active tab. Chrome shows its built-in debugger notification bar on the inspected tab while attached.
- **WebSocket / SSE messages** — with body capture on, sent/received WebSocket frames and Server-Sent Events are listed under the connection's row (newest first, click a message for the full payload, JSON pretty-printed); the row shows a message count
- **Mocks** — rules that intercept matching requests in the active tab (CDP `Fetch` domain): *Respond with* a custom status/headers/body, *Delay* the real request, or *Fail* it. URL pattern uses the filter syntax (substring or `/regex/`), optionally restricted to a method. **Mock** on a captured request pre-fills a rule with its URL and response. Rules are saved; the "Mocking active" master switch is per browser session. Mocked rows get a MOCK / DELAYED / BLOCKED badge
- **Error badge** on the toolbar icon: number of failed requests (4xx/5xx/network errors) on the current page, reset on navigation, even with the panel closed
- **Redirect chains** — each hop of a redirect (301/302/307/…) is its own row with a `→ target` badge; the detail lists the whole chain (click a hop to jump to it)
- **Navigation separators** — a line marks each page load in the list
- **Persistence** — buffer kept in `chrome.storage.session`, survives service worker restarts
- **Hotkeys**: `/` focus URL filter, `Esc` clear filter, `p` pause/resume, `↑`/`↓` between rows, `Enter`/`Space` to expand rows and JSON tree nodes

## Limitations

- Response bodies require the `chrome.debugger` toggle (Chrome's built-in debugger notification bar will appear on the inspected tab while attached). Correlation between webRequest and CDP is by URL match, so identical concurrent requests may have their bodies attached to the wrong entry.
- Replay runs from the extension origin; some headers (`Cookie`, `Origin`, `Host`, `Referer`, …) are forbidden by the fetch spec and silently dropped.
- Response bodies larger than 1 MB, and image/media/font bodies, are not captured (keeps memory bounded).
- WebSocket/SSE messages are kept for the live session only (latest 500 per connection, payloads truncated at 64 KB), and only while body capture is on. Matching a connection to its row is by tab + URL.
- Mocked responses are answered by the browser itself: for cross-origin requests the rule must include the CORS headers the page needs (`Access-Control-Allow-Origin`, and `…-Credentials` for credentialed requests — `*` won't do there). CORS preflights (`OPTIONS`) are only mocked by a rule explicitly set to `OPTIONS`.
- Mocks and body capture follow the active tab, like the debugger they rely on; dismissing Chrome's debugger bar turns both off.
- Navigation separators are based on `main_frame` requests: client-side (SPA) route changes don't produce one.
- Buffer capped at 2000 entries; oldest non-starred dropped first.
- `chrome.storage.session` quota is ~10MB; very large response bodies may cause persistence to fail silently.
