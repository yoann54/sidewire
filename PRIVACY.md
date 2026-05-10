# Sidewire — Privacy Policy

_Last updated: 2026-05-10_

Sidewire is a Chrome extension that displays the network traffic of the tabs you are actively capturing inside a side panel, as a developer tool.

## Summary

**Sidewire does not collect, transmit, sell, or share any of your data.** Everything observed by the extension stays inside your browser, on your machine.

## What the extension processes

While you have capture enabled, Sidewire reads the following from the tabs in scope:

- Request URL, method, resource type, status code, timings
- Request and response headers
- Request body (form data or raw, when present)
- Response body — **only** when you explicitly enable the "Capture response bodies (debugger)" toggle, which attaches `chrome.debugger` to the active tab and displays a persistent yellow banner while attached

This is the same kind of information you would see in Chrome's built-in DevTools Network panel.

## What the extension stores

- A rolling buffer of captured entries (capped at 2,000) is kept in `chrome.storage.session` so that the side panel survives service-worker restarts. `chrome.storage.session` is cleared automatically by Chrome when the browser closes.
- The extension does **not** write to `chrome.storage.local` or `chrome.storage.sync`.
- The extension does **not** use cookies, IndexedDB, or any other persistent client-side storage.

## What the extension transmits

**Nothing.** Sidewire has no backend, no analytics, no telemetry, no remote endpoints, no crash reporting, no update pings beyond the standard Chrome Web Store mechanism.

The only network requests Sidewire itself performs are:

- The "Replay" feature, which re-fires a captured request to its **original URL** at your explicit click. The response is shown locally; it is not sent anywhere else.
- The "HAR export" feature, which writes a `.har` file to your local file system via the browser's download dialog.

## Permissions

| Permission | Purpose |
|---|---|
| `webRequest` | Read request/response metadata (URL, headers, status, timings) from tabs in capture scope |
| `sidePanel` | Render the extension's UI in Chrome's side panel |
| `tabs` | Identify the active tab when "Active tab" scope is selected |
| `storage` | Persist the rolling buffer in `chrome.storage.session` |
| `debugger` | Optional — attached only while the "Capture response bodies" toggle is on, to read response bodies via the Chrome DevTools Protocol |
| `<all_urls>` host access | Allow the above to observe whichever site you choose to inspect |

## Third parties

Sidewire does not share, sell, or transfer any data to third parties. There are no third parties involved.

## Children's privacy

Sidewire is a developer tool. It does not knowingly collect any data from anyone, including children under 13.

## Changes

If this policy changes in a material way, the updated version will be published in the extension's repository and bundled with the next Web Store release.

## Contact

Questions about this policy: yoann.piconcely@skores.com
