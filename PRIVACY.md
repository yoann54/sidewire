---
title: Sidewire — Privacy Policy
---

# Sidewire — Privacy Policy

_Last updated: 2026-10-06_

_Applies to Sidewire version 0.8.2._

Sidewire is a Chrome extension that displays the network traffic of the tabs you are actively capturing inside a side panel, as a developer tool.

## Summary

**Sidewire does not collect, transmit, sell, or share any of your data.** Everything observed by the extension stays inside your browser, on your machine.

## What the extension processes

While you have capture enabled, Sidewire reads the following from the tabs in scope:

- Request URL, method, resource type, status code, timings
- Request and response headers
- Request body (form data or raw, when present)
- Response body and WebSocket / Server-Sent Events messages — **only** when you explicitly enable the "Capture bodies & messages (debugger)" toggle, which attaches `chrome.debugger` to the active tab. The `debugger` permission is not granted at install time: Chrome asks you for it the first time you enable a feature that needs it. While attached, Chrome shows its built-in debugger notification bar on the inspected tab so you remain aware that a debugger session is active.
- Requests matching a mock rule — **only** while "Mocking active" is on. The debugger is then used to answer, delay or fail those requests locally, as your rules describe. Nothing is sent anywhere: a mocked response is produced inside your browser.

This is the same kind of information you would see in Chrome's built-in DevTools Network panel.

## What the extension stores

- A rolling buffer of captured entries (capped at 2,000) is kept in `chrome.storage.session` so that the side panel survives service-worker restarts. Response bodies and WebSocket/SSE messages are held in memory only and are **not** written to `chrome.storage.session`; bodies larger than 1 MB, as well as images, media and fonts, are not captured at all. The capture state (paused, scope, mocking on/off) and the per-tab failed-request counts shown on the toolbar badge are also kept there. `chrome.storage.session` is cleared automatically by Chrome when the browser closes.
- `chrome.storage.local` is used **only** to persist UI preferences — theme, display toggles, and the active filters (filter text you typed, selected status/methods/types, and — if you picked one — the selected domain in the domain filter) — and the mock rules you write (URL pattern, method, and the status, headers and body you entered). No captured requests, headers or bodies are written to it, except what you choose to copy into a mock rule.
- The extension does **not** write to `chrome.storage.sync`.
- The extension does **not** use cookies, IndexedDB, or any other persistent client-side storage.

## What the extension transmits

**Nothing.** Sidewire has no backend, no analytics, no telemetry, no remote endpoints, no crash reporting, no update pings beyond the standard Chrome Web Store mechanism.

The only network requests Sidewire itself performs are:

- The "Replay" and "Replay with…" features, which re-fire a captured request at your explicit click. By default the request is sent unchanged to its original URL; the "Replay with…" editor lets you modify query parameters and the request body before sending. Replaying an entry that came from an imported HAR file asks for confirmation first. The destination is always the original host of the captured request, and the response is shown locally — it is not sent anywhere else.
- The "HAR export" feature, which writes a `.har` file to your local file system via the browser's download dialog. By default, values of sensitive headers (Authorization, Cookie, Set-Cookie, API keys…) are replaced with `[redacted]` in the exported file.

The "HAR import" feature reads a `.har` file you select from your local file system and displays it in the panel. The file is parsed locally and never uploaded anywhere.

## Permissions

| Permission | Purpose |
|---|---|
| `webRequest` | Read request/response metadata (URL, headers, status, timings) from tabs in capture scope |
| `sidePanel` | Render the extension's UI in Chrome's side panel |
| `storage` | Persist the rolling buffer in `chrome.storage.session`, and UI preferences (theme, filters, display toggles) and mock rules in `chrome.storage.local` |
| `debugger` | Attached only while body capture or mocks are on, to read response bodies and WebSocket/SSE messages and to apply your mock rules via the Chrome DevTools Protocol |
| `<all_urls>` host access | Allow the above to observe whichever site you choose to inspect |

## Third parties

Sidewire does not share, sell, or transfer any data to third parties. There are no third parties involved.

## Children's privacy

Sidewire is a developer tool. It does not knowingly collect any data from anyone, including children under 13.

## Changes

If this policy changes in a material way, the updated version will be published in the extension's repository and bundled with the next Web Store release.

## Contact

Questions about this policy: yoann.piconcely@skores.com
