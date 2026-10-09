# Chrome Web Store — listing copy

All texts to paste into the Web Store developer dashboard. Wording is factual and matches the actual code; review before publishing.

---

## Name

```
Sidewire
```

## Short description (≤ 132 chars)

```
Log and inspect network requests in a side panel — without opening DevTools.
```
(75 chars)

## Category

```
Developer Tools
```

## Language

```
English (en)
```

---

## Detailed description

```
Sidewire shows your network traffic in a Chrome side panel — no DevTools required.

Capture, filter, replay and export requests while keeping your browser layout intact. Everything stays on your machine: no account, no tracking, no remote server.

FEATURES
• Capture in the active tab (default) or all tabs, with pause/resume and clear (starred entries are kept)
• Filters: URL terms with AND + "-" exclusion (e.g. "api -analytics -.png") or /regex/, HTTP method, resource type, status bucket (2xx/3xx/4xx/5xx/errors), domain dropdown, "★ only" toggle
• Search inside headers and request/response bodies (optional toggle), not just the URL
• Group requests by domain in collapsible sections
• Optional response-size column and a compact request timeline (waterfall) with a shared time scale
• Flag secrets — highlight sensitive headers (Authorization, Cookie, API keys…) and Set-Cookie values missing Secure/HttpOnly
• Slow-request highlight with a configurable threshold
• Star entries (☆/★) — preserved across Clear
• GraphQL operationName auto-extracted from POST bodies and shown as a badge
• Click a row to expand: query params, parsed request/response headers, request body (formData or raw, JSON pretty-printed), response body (when capture enabled), timing breakdown
• Diff two requests side by side (headers + bodies, line-level)
• Copy URL, Copy as cURL, Copy as fetch, Copy as PowerShell, Copy as node fetch, Copy all visible URLs
• HAR export and HAR import — round-trip with DevTools, Postman, Insomnia…
• Sensitive header values (Authorization, Cookie, API keys…) redacted in exported HAR files by default
• Mocks — answer matching requests with your own status, headers and body, delay them, or make them fail; create a rule from any captured request in one click (uses chrome.debugger)
• WebSocket and Server-Sent Events messages listed under each connection (with response-body capture on)
• Error badge on the toolbar icon: failed requests (4xx/5xx/network errors) on the current page, reset on navigation
• Navigation separators mark each page load in the list
• Redirect chains — each hop of a redirect (301/302/307/308…) is shown as its own row with its status and target; the request details list the whole chain, and a click jumps to any hop
• Replay — re-fire a captured request and see the response inline
• Replay with… — open an inline editor to toggle/edit/add query parameters and edit the body (JSON pretty-print) before re-firing
• Decode base64 response bodies in one click; JSON pretty-printed automatically when decoded
• Optional JWT decoding — auto-shows the decoded header/payload JSON under any JWT-shaped header value (Authorization: Bearer …, etc.)
• Light / dark theme — toggle in the title bar, follows OS preference by default
• Optional response-body capture via chrome.debugger — only attached while body capture or mocks are on (Chrome shows its built-in debugger notification bar on the inspected tab while attached)
• Filters and display preferences are remembered between sessions
• Persistence — request buffer kept in chrome.storage.session, survives service-worker restarts (response bodies stay in memory only, never written to storage)
• Keyboard: / focus URL filter, Esc clear filter, P pause/resume, arrow keys between rows, Enter/Space to expand rows and JSON nodes

PRIVACY
Sidewire does not send any data anywhere. Captured request/response metadata stays inside your browser's session storage and is discarded when the browser closes. No analytics, no telemetry, no remote endpoints.

LIMITATIONS
• Response bodies require enabling the chrome.debugger toggle (Chrome's built-in debugger notification bar will appear on the inspected tab while attached). Correlation between webRequest and CDP matches on tab, URL, method and closest request time — a heuristic, so identical concurrent requests to the same URL may still occasionally have their bodies attached to the wrong entry.
• Replay runs from the extension origin; some headers (Cookie, Origin, Host, Referer, …) are forbidden by the fetch spec and silently dropped.
• Response bodies larger than 1 MB, and image/media/font bodies, are not captured.
• Buffer capped at 2000 entries; oldest non-starred dropped first (a "dropped" counter is shown once eviction starts).

SUPPORT
Sidewire is free and every feature is available to everyone. If it saves you time, there's an optional "tip" button (heart icon in the title bar) that opens paypal.me/yoadadev in a new tab. Donations are entirely optional and unlock nothing.
```

---

## Single purpose (required field)

```
Sidewire captures network requests from the user's tabs and presents them in the browser's side panel for inspection, filtering, replay, mocking and export — providing DevTools-like network debugging without requiring DevTools to be open.
```

---

## Permission justifications

Paste one justification per permission in the corresponding field of the dashboard.

### `webRequest`
```
Required to observe HTTP/HTTPS request and response metadata (URL, method, status, headers, timings) from tabs the user is currently capturing. This is the core data the extension shows in the side panel. No bodies are read through this API.
```

### `sidePanel`
```
The extension's entire UI lives in a Chrome side panel. This permission is required to register and open that panel.
```

### `storage`
```
Used to persist the request buffer in chrome.storage.session so that the side panel survives service-worker restarts during a browsing session (response bodies are held in memory only and are never written to storage). Also used to persist non-sensitive UI preferences (theme, active filters, and display toggles) and the mock rules the user writes in chrome.storage.local — no captured request data is written there. Nothing is written to chrome.storage.sync.
```

### `debugger`
```
Never used by default: the debugger is attached to the active tab only while the user has turned on "Capture bodies & messages" or "Mocks", for two uses: (1) reading response bodies and WebSocket / Server-Sent Events messages (Network domain), which Chrome's webRequest API does not expose; (2) answering, delaying or failing requests that match mock rules the user wrote (Fetch domain) — webRequest in Manifest V3 cannot modify responses. Chrome's built-in debugger notification bar is displayed on the inspected tab for as long as the debugger session is active, so the user is always aware. Detached automatically when both features are turned off; dismissing the notification bar turns them off.
```

### Host permissions: `<all_urls>`
```
Network capture must be able to observe requests across whatever site the user is browsing — there is no way to know in advance which origin the user wants to inspect. The extension does not inject content scripts and does not read page DOM; <all_urls> is used solely to scope the webRequest listener and the user-enabled debugger attach.
```

---

## Data usage disclosures (Privacy practices tab)

Tick / answer the dashboard form as follows:

**Does this item collect or use any of the following user data?**

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | No | |
| Authentication information | No | Auth headers may appear in captured requests but are kept local; never transmitted |
| Personal communications | No | |
| Location | No | |
| Web history | No | The extension shows network requests for tabs the user is actively capturing; this data is never persisted beyond `chrome.storage.session` and never transmitted off-device |
| User activity | No | Same as above |
| Website content | No | Response bodies and WebSocket/SSE messages (when the user explicitly enables debugger capture) are kept in memory only and never transmitted |

**Certifications** (tick all three):

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Privacy policy

A privacy policy URL is required by the Web Store form. Host the file below on GitHub (e.g. as `PRIVACY.md` in the repo, linked via the raw URL or the repo's GitHub Pages), then paste that URL into the dashboard.

See `PRIVACY.md` (provided alongside this file).
