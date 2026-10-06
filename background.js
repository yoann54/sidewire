const MAX_ENTRIES = 2000;
const STORAGE_KEY = "sidewire-log";
const STARS_KEY = "sidewire-stars";
const STATE_KEY = "sidewire-state";
const BADGE_KEY = "sidewire-badges";
const MOCKS_KEY = "sidewire-mocks";
// Response bodies above this size are not kept: they would bloat memory in
// both the worker and the panel. Images, media and fonts are skipped outright.
const MAX_BODY_BYTES = 1024 * 1024;
const SKIPPED_BODY_TYPES = new Set(["Image", "Media", "Font"]);
// WebSocket / SSE messages: only the latest ones are kept per connection, and
// each payload is truncated.
const MAX_FRAMES = 500;
const MAX_FRAME_CHARS = 64 * 1024;
const MAX_MOCK_DELAY = 30000;
const MOCK_ACTIONS = new Set(["fulfill", "delay", "fail"]);
// Never sent back in a mocked response: the body we send is plain, unchunked.
const MOCK_DROPPED_HEADERS = new Set(["content-length", "content-encoding", "transfer-encoding"]);

const inflight = new Map();
const log = [];
const ports = new Set();
const starredIds = new Set();

let paused = false;
let scope = "active";
let activeTabId = null;
let captureBodies = false;
let attachedTabId = null;
let droppedCount = 0;
const cdpRequestUrls = new Map();
// What the attached debugger session currently has enabled, so reconfiguring
// only sends the commands that changed.
let networkEnabled = false;
let fetchPatternsKey = "null";

// Mock rules live in storage.local (they're user-authored config, not
// captured data). `mocksOn` is the master switch, kept per browser session so
// a restart never re-attaches the debugger on its own.
let mocks = [];
let compiledMocks = [];
let mocksOn = false;
const pendingMockMarks = [];

// WebSocket / SSE: CDP request id → captured entry the messages belong to.
const wsUrls = new Map();
const streamEntries = new Map();
const claimedStreams = new WeakSet();
const removedEntries = new WeakSet();

// Failed requests (4xx/5xx/network errors) per tab since its last navigation,
// shown as the toolbar icon badge.
const errorCounts = new Map();

let persistScheduled = false;
let restored = false;

// Response bodies (captured via the debugger) can be large and often hold the
// most sensitive payloads. They are kept in memory for the live session but
// stripped before writing to storage.session — this bounds the ~10MB quota and
// keeps sensitive bodies out of at-rest storage. They can't survive a
// service-worker restart anyway (the debugger detaches), so nothing is lost.
function serializeForStorage(e) {
  if (e.responseBody == null && e.frames == null) return e;
  const { responseBody, frames, ...rest } = e;
  return rest;
}

function persist() {
  // Never write before the saved buffer has been merged back in, or we'd
  // overwrite it with only the requests seen since the worker restarted.
  if (persistScheduled || !restored) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    chrome.storage.session.set({
      [STORAGE_KEY]: log.map(serializeForStorage),
      [STARS_KEY]: [...starredIds],
      [BADGE_KEY]: Object.fromEntries(errorCounts)
    }).catch((err) => {
      console.warn("sidewire: session persist failed (quota exceeded?)", err);
    });
  }, 500);
}

// Paused/scope survive a worker restart; capturing bodies does not, since the
// debugger session is gone with the worker.
function persistState() {
  chrome.storage.session.set({ [STATE_KEY]: { paused, scope, mocksOn } }).catch(() => {});
}

function broadcastState(extra) {
  broadcast({ type: "state", paused, scope, activeTabId, captureBodies, mocksOn, ...extra });
}

chrome.storage.session.get([STORAGE_KEY, STARS_KEY, STATE_KEY, BADGE_KEY]).then((res) => {
  const saved = res?.[STORAGE_KEY];
  if (Array.isArray(saved) && saved.length) {
    const seen = new Set(log.map((e) => e.id));
    const older = saved.filter((e) => !seen.has(e.id));
    for (const e of older) if (e.state === "pending") e.state = "completed";
    // Requests captured while we were restoring are newer: keep them last.
    log.unshift(...older);
  }
  const stars = res?.[STARS_KEY];
  if (Array.isArray(stars)) for (const id of stars) starredIds.add(id);
  const st = res?.[STATE_KEY];
  if (st) {
    paused = !!st.paused;
    scope = st.scope === "all" ? "all" : "active";
    mocksOn = !!st.mocksOn;
  }
  const badges = res?.[BADGE_KEY];
  if (badges && typeof badges === "object") {
    for (const [tabId, n] of Object.entries(badges)) {
      const id = Number(tabId);
      if (!errorCounts.has(id)) errorCounts.set(id, n);
      else errorCounts.set(id, errorCounts.get(id) + n);
    }
  }
  trimLog();
}).catch(() => {}).finally(() => {
  restored = true;
  persist();
  broadcast(snapshotMsg());
  syncDebugger();
});

chrome.storage.local.get(MOCKS_KEY).then((res) => {
  setMocks(res?.[MOCKS_KEY], false);
  syncDebugger();
}).catch(() => {});

// Returns the evicted ids so the panel can drop them too.
function trimLog() {
  const evicted = [];
  while (log.length > MAX_ENTRIES) {
    // Prefer evicting the oldest unstarred entry; if everything is starred,
    // enforce the hard cap by dropping the oldest so the buffer stays bounded.
    let idx = log.findIndex((e) => !starredIds.has(e.id));
    if (idx === -1) idx = 0;
    const [gone] = log.splice(idx, 1);
    removedEntries.add(gone);
    evicted.push(gone.id);
    droppedCount++;
  }
  return evicted;
}

function snapshotMsg() {
  return {
    type: "snapshot",
    entries: log,
    paused, scope, activeTabId, captureBodies,
    mocks, mocksOn,
    starred: [...starredIds],
    dropped: droppedCount
  };
}

chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([t]) => {
  if (t) activeTabId = t.id;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  broadcastState();
  await syncDebugger();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [t] = await chrome.tabs.query({ active: true, windowId });
    if (!t || t.id === activeTabId) return;
    activeTabId = t.id;
    broadcastState();
    await syncDebugger();
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === attachedTabId) {
    attachedTabId = null;
    resetDebuggerSession();
  }
  if (errorCounts.delete(tabId)) persist();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidewire") return;
  ports.add(port);
  port.postMessage(snapshotMsg());
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "clear") {
      const kept = log.filter((e) => starredIds.has(e.id));
      for (const e of log) if (!starredIds.has(e.id)) removedEntries.add(e);
      log.length = 0;
      log.push(...kept);
      inflight.clear();
      droppedCount = 0;
      persist();
      broadcast({ type: "cleared", entries: log, dropped: droppedCount });
    } else if (msg.type === "setPaused") {
      paused = !!msg.value;
      persistState();
      broadcastState();
    } else if (msg.type === "setScope") {
      scope = msg.value === "all" ? "all" : "active";
      persistState();
      broadcastState();
    } else if (msg.type === "toggleStar") {
      if (starredIds.has(msg.id)) starredIds.delete(msg.id);
      else starredIds.add(msg.id);
      persist();
      broadcast({ type: "starred", ids: [...starredIds] });
    } else if (msg.type === "setCaptureBodies") {
      captureBodies = !!msg.value;
      const ok = await syncDebugger();
      if (!ok && captureBodies) captureBodies = false;
      broadcastState(ok ? {} : { debuggerError: true });
    } else if (msg.type === "setMocks") {
      setMocks(msg.mocks, true);
      const ok = await syncDebugger();
      broadcast({ type: "mocks", mocks, mocksOn });
      if (!ok) broadcastState({ debuggerError: true });
    } else if (msg.type === "setMocksOn") {
      mocksOn = !!msg.value;
      const ok = await syncDebugger();
      if (!ok && mocksOn && mocksActive()) mocksOn = false;
      persistState();
      broadcastState(ok ? {} : { debuggerError: true });
    } else if (msg.type === "importEntries") {
      const incoming = Array.isArray(msg.entries) ? msg.entries : [];
      for (const e of incoming) {
        if (e && e.id) log.push(e);
      }
      trimLog();
      persist();
      broadcast(snapshotMsg());
    }
  });
  port.onDisconnect.addListener(() => ports.delete(port));
});

function broadcast(msg) {
  for (const p of ports) {
    try { p.postMessage(msg); } catch { /* port closed */ }
  }
}

function shouldCapture(details) {
  if (paused) return false;
  if (details.tabId < 0) return false;
  if (scope === "active" && activeTabId !== null && details.tabId !== activeTabId) return false;
  return true;
}

function decodeRequestBody(rb) {
  if (!rb) return null;
  if (rb.error) return { kind: "error", error: rb.error };
  if (rb.formData) return { kind: "formData", data: rb.formData };
  if (rb.raw) {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const parts = rb.raw.map((r) => {
        if (r.bytes) return decoder.decode(new Uint8Array(r.bytes));
        if (r.file) return `[file: ${r.file}]`;
        return "";
      });
      return { kind: "raw", text: parts.join("") };
    } catch (e) {
      return { kind: "error", error: String(e) };
    }
  }
  return null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type === "main_frame" && d.tabId >= 0) resetErrorCount(d.tabId);
    if (!shouldCapture(d)) return;
    const entry = {
      id: d.requestId,
      url: d.url,
      method: d.method,
      type: d.type,
      tabId: d.tabId,
      startedAt: d.timeStamp,
      headersReceivedAt: null,
      completedAt: null,
      status: null,
      duration: null,
      state: "pending",
      error: null,
      requestHeaders: null,
      requestBody: decodeRequestBody(d.requestBody),
      responseHeaders: null,
      responseBody: null
    };
    const mark = takeMockMark(entry);
    if (mark) entry.mock = mark;
    inflight.set(d.requestId, entry);
    log.push(entry);
    const evicted = trimLog();
    persist();
    broadcast({ type: "add", entry, evicted, dropped: droppedCount });
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    const e = inflight.get(d.requestId);
    if (!e) return;
    e.requestHeaders = d.requestHeaders || [];
    persist();
    broadcast({ type: "update", entry: e });
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    const e = inflight.get(d.requestId);
    if (!e) return;
    e.responseHeaders = d.responseHeaders || [];
    e.headersReceivedAt = d.timeStamp;
    e.status = d.statusCode;
    persist();
    broadcast({ type: "update", entry: e });
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (d.statusCode >= 400) bumpErrorCount(d);
    const e = inflight.get(d.requestId);
    if (!e) return;
    e.status = d.statusCode;
    e.completedAt = d.timeStamp;
    e.duration = Math.max(0, Math.round(d.timeStamp - e.startedAt));
    e.state = "completed";
    if (d.responseHeaders && !e.responseHeaders) e.responseHeaders = d.responseHeaders;
    persist();
    broadcast({ type: "update", entry: e });
    inflight.delete(d.requestId);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (d) => {
    // Aborted requests (navigation away, cancelled fetch) aren't failures.
    if (d.error !== "net::ERR_ABORTED") bumpErrorCount(d);
    const e = inflight.get(d.requestId);
    if (!e) return;
    e.error = d.error;
    e.completedAt = d.timeStamp;
    e.duration = Math.max(0, Math.round(d.timeStamp - e.startedAt));
    e.state = "error";
    persist();
    broadcast({ type: "update", entry: e });
    inflight.delete(d.requestId);
  },
  { urls: ["<all_urls>"] }
);

// ───── toolbar badge: failed requests per tab ─────

chrome.action.setBadgeBackgroundColor({ color: "#ea4335" }).catch(() => {});

function updateBadge(tabId) {
  const n = errorCounts.get(tabId) || 0;
  const text = n === 0 ? "" : n > 99 ? "99+" : String(n);
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setTitle({
    tabId,
    title: n === 0 ? "Sidewire" : `Sidewire — ${n} failed request${n === 1 ? "" : "s"} on this page`
  }).catch(() => {});
}

function resetErrorCount(tabId) {
  if (!errorCounts.has(tabId)) return;
  errorCounts.delete(tabId);
  updateBadge(tabId);
  persist();
}

function bumpErrorCount(d) {
  const tabId = d.tabId;
  // The browser's own favicon fetch 404s on many sites: not the page's fault.
  if (tabId < 0 || /\/favicon\.ico(\?|$)/.test(d.url)) return;
  errorCounts.set(tabId, (errorCounts.get(tabId) || 0) + 1);
  updateBadge(tabId);
  persist();
}

// ───── chrome.debugger: response bodies, WebSocket/SSE messages, mocks ─────

// Attach/detach calls are chained so rapid tab switches can't interleave and
// leave a tab attached that we no longer track (stuck debugger infobar).
let debuggerQueue = Promise.resolve();
function serialized(fn) {
  const run = debuggerQueue.then(fn, fn);
  debuggerQueue = run.catch(() => {});
  return run;
}

function mocksActive() {
  return mocksOn && compiledMocks.length > 0;
}

function needDebugger() {
  return captureBodies || mocksActive();
}

// Brings the debugger session in line with what's wanted: attached to the
// active tab with Network (bodies, messages) and/or Fetch (mocks) enabled, or
// detached. Resolves false if a wanted attach failed.
function syncDebugger() {
  return serialized(async () => {
    if (!needDebugger()) {
      await detachDebuggerNow();
      return true;
    }
    if (activeTabId == null) {
      try {
        const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (t) activeTabId = t.id;
      } catch {}
    }
    return attachDebuggerNow(activeTabId);
  });
}

function resetDebuggerSession() {
  cdpRequestUrls.clear();
  wsUrls.clear();
  streamEntries.clear();
  networkEnabled = false;
  fetchPatternsKey = "null";
}

async function attachDebuggerNow(tabId) {
  if (!tabId || tabId < 0) return false;
  // `debugger` is an optional permission: the API only exists once granted.
  if (!chrome.debugger) return false;
  setupDebuggerListeners();
  try {
    if (attachedTabId !== tabId) {
      if (attachedTabId) await detachDebuggerNow();
      await chrome.debugger.attach({ tabId }, "1.3");
      attachedTabId = tabId;
    }
    await configureDebuggerNow(tabId);
    return true;
  } catch (e) {
    console.warn("sidewire: debugger attach failed", e);
    return false;
  }
}

async function configureDebuggerNow(tabId) {
  const target = { tabId };
  if (captureBodies !== networkEnabled) {
    await chrome.debugger.sendCommand(target, captureBodies ? "Network.enable" : "Network.disable");
    networkEnabled = captureBodies;
  }
  const patterns = mocksActive() ? fetchPatterns() : null;
  const key = JSON.stringify(patterns);
  if (key !== fetchPatternsKey) {
    if (patterns) await chrome.debugger.sendCommand(target, "Fetch.enable", { patterns });
    else await chrome.debugger.sendCommand(target, "Fetch.disable");
    fetchPatternsKey = key;
  }
}

async function detachDebuggerNow() {
  if (!attachedTabId) return;
  const tabId = attachedTabId;
  attachedTabId = null;
  resetDebuggerSession();
  try { await chrome.debugger.detach({ tabId }); } catch {}
}

// Registered lazily: chrome.debugger is undefined until the optional
// permission is granted (requested by the panel when the toggle is enabled).
let debuggerListenersReady = false;
function setupDebuggerListeners() {
  if (debuggerListenersReady || !chrome.debugger) return;
  debuggerListenersReady = true;
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);
}
setupDebuggerListeners();
chrome.permissions.onAdded.addListener(setupDebuggerListeners);
chrome.permissions.onRemoved.addListener(({ permissions }) => {
  if (!permissions?.includes("debugger")) return;
  attachedTabId = null;
  resetDebuggerSession();
  captureBodies = false;
  mocksOn = false;
  persistState();
  broadcastState();
});

async function onDebuggerEvent(source, method, params) {
  if (source.tabId !== attachedTabId) return;
  if (method === "Fetch.requestPaused") {
    await onRequestPaused(source.tabId, params);
  } else if (method === "Network.webSocketCreated") {
    wsUrls.set(params.requestId, params.url);
  } else if (method === "Network.webSocketFrameSent" || method === "Network.webSocketFrameReceived") {
    const r = params.response || {};
    addFrame(source.tabId, params.requestId, wsUrls.get(params.requestId), true, {
      dir: method === "Network.webSocketFrameSent" ? "out" : "in",
      opcode: r.opcode,
      data: r.payloadData || ""
    });
  } else if (method === "Network.webSocketFrameError") {
    addFrame(source.tabId, params.requestId, wsUrls.get(params.requestId), true, {
      dir: "err",
      data: params.errorMessage || "error"
    });
  } else if (method === "Network.webSocketClosed") {
    wsUrls.delete(params.requestId);
    streamEntries.delete(params.requestId);
  } else if (method === "Network.eventSourceMessageReceived") {
    addFrame(source.tabId, params.requestId, cdpRequestUrls.get(params.requestId)?.url, false, {
      dir: "in",
      event: params.eventName || "message",
      data: params.data || ""
    });
  } else if (method === "Network.requestWillBeSent") {
    cdpRequestUrls.set(params.requestId, {
      url: params.request?.url,
      method: params.request?.method,
      type: params.type,
      // CDP wallTime is epoch seconds; webRequest timeStamp is epoch ms.
      wallTime: params.wallTime != null ? params.wallTime * 1000 : null
    });
  } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    const info = cdpRequestUrls.get(params.requestId);
    cdpRequestUrls.delete(params.requestId);
    streamEntries.delete(params.requestId);
    if (!info || !info.url || method === "Network.loadingFailed") return;
    if (SKIPPED_BODY_TYPES.has(info.type)) return;
    const tooLarge = params.encodedDataLength > MAX_BODY_BYTES;
    try {
      const res = tooLarge ? null : await chrome.debugger.sendCommand(
        { tabId: source.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
      // Correlate CDP → webRequest: the two use different id spaces, so match on
      // (tab, url, method) and, among candidates, pick the one whose start time
      // is closest to the CDP wallTime. Disambiguates concurrent same-URL calls.
      let entry = null;
      let bestDelta = Infinity;
      for (const e of log) {
        if (e.tabId !== source.tabId) continue;
        if (e.url !== info.url) continue;
        if (e.responseBody != null) continue;
        if (info.method && e.method && e.method !== info.method) continue;
        const delta = (info.wallTime != null && e.startedAt != null)
          ? Math.abs(e.startedAt - info.wallTime) : 0;
        if (delta <= bestDelta) { bestDelta = delta; entry = e; }
      }
      if (entry) {
        const text = res?.body || "";
        entry.responseBody = (tooLarge || text.length > MAX_BODY_BYTES)
          ? { text: "", base64Encoded: false, omitted: "too large (> 1 MB)" }
          : { text, base64Encoded: !!res.base64Encoded };
        persist();
        broadcast({ type: "update", entry });
      }
    } catch {
      // body unavailable (cleared from cache, etc.)
    }
  }
}

// The user dismissed Chrome's debugger bar (or DevTools took over): turn both
// debugger features off rather than re-attaching behind their back.
function onDebuggerDetach(source, reason) {
  if (source.tabId === attachedTabId) {
    attachedTabId = null;
    resetDebuggerSession();
    captureBodies = false;
    mocksOn = false;
    persistState();
    broadcastState({ detachReason: reason });
  }
}

// ───── WebSocket / SSE messages ─────

// Messages are matched to the webRequest entry of their connection: same tab
// and URL, most recent one not already claimed by another connection.
function streamEntryFor(tabId, cdpId, url, isWebSocket) {
  const known = streamEntries.get(cdpId);
  if (known) return removedEntries.has(known) ? null : known;
  if (!url) return null;
  const stop = Math.max(0, log.length - 500);
  for (let i = log.length - 1; i >= stop; i--) {
    const e = log[i];
    if (e.tabId !== tabId || e.url !== url || claimedStreams.has(e)) continue;
    if (isWebSocket && e.type !== "websocket") continue;
    claimedStreams.add(e);
    streamEntries.set(cdpId, e);
    return e;
  }
  return null;
}

function addFrame(tabId, cdpId, url, isWebSocket, frame) {
  const e = streamEntryFor(tabId, cdpId, url, isWebSocket);
  if (!e) return;
  const size = frame.data.length;
  if (size > MAX_FRAME_CHARS) {
    frame.data = frame.data.slice(0, MAX_FRAME_CHARS);
    frame.truncated = true;
  }
  e.frameCount = (e.frameCount || 0) + 1;
  Object.assign(frame, { n: e.frameCount, t: Date.now(), size });
  if (!e.frames) e.frames = [];
  e.frames.push(frame);
  if (e.frames.length > MAX_FRAMES) e.frames.splice(0, e.frames.length - MAX_FRAMES);
  broadcast({ type: "frame", id: e.id, frame });
}

// ───── mocks (CDP Fetch domain) ─────

function sanitizeMock(m) {
  const status = Math.round(Number(m?.status));
  const delay = Math.round(Number(m?.delay));
  return {
    id: typeof m?.id === "string" && m.id ? m.id : crypto.randomUUID(),
    enabled: m?.enabled !== false,
    pattern: typeof m?.pattern === "string" ? m.pattern.trim() : "",
    method: typeof m?.method === "string" ? m.method.toUpperCase() : "",
    action: MOCK_ACTIONS.has(m?.action) ? m.action : "fulfill",
    status: status >= 100 && status <= 599 ? status : 200,
    headers: Array.isArray(m?.headers)
      ? m.headers
          .filter((h) => h && typeof h.name === "string" && h.name.trim())
          .map((h) => ({ name: h.name.trim(), value: String(h.value ?? "") }))
      : [],
    body: typeof m?.body === "string" ? m.body : "",
    delay: delay >= 0 ? Math.min(delay, MAX_MOCK_DELAY) : 2000
  };
}

// Same syntax as the panel's URL filter: substring (case-sensitive here, to
// line up with CDP's glob patterns) or /regex/.
function compileMock(rule) {
  if (!rule.enabled || !rule.pattern) return null;
  const m = rule.pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    try {
      // g/y make test() stateful across calls.
      const re = new RegExp(m[1], m[2].replace(/[gy]/g, ""));
      return { rule, regex: true, test: (u) => re.test(u) };
    } catch { return null; }
  }
  return { rule, regex: false, test: (u) => u.includes(rule.pattern) };
}

function setMocks(list, save) {
  mocks = Array.isArray(list) ? list.map(sanitizeMock) : [];
  compiledMocks = mocks.map(compileMock).filter(Boolean);
  if (save) chrome.storage.local.set({ [MOCKS_KEY]: mocks }).catch(() => {});
}

// Only pause requests that can match a rule. A regex can't be expressed as a
// CDP glob, so any regex rule means pausing everything and matching here.
function fetchPatterns() {
  if (compiledMocks.some((c) => c.regex)) return [{ urlPattern: "*" }];
  return compiledMocks.map((c) => ({ urlPattern: `*${c.rule.pattern.replace(/[\\*?]/g, "\\$&")}*` }));
}

function matchMock(url, method) {
  for (const c of compiledMocks) {
    const r = c.rule;
    if (r.method ? r.method !== method : method === "OPTIONS") continue; // never answer a CORS preflight unless asked to
    if (c.test(url)) return r;
  }
  return null;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function onRequestPaused(tabId, params) {
  const target = { tabId };
  const { requestId, request } = params;
  const rule = mocksActive() ? matchMock(request.url, request.method) : null;
  try {
    if (!rule) {
      await chrome.debugger.sendCommand(target, "Fetch.continueRequest", { requestId });
      return;
    }
    markMocked(tabId, request.url, request.method, rule);
    if (rule.action === "fail") {
      await chrome.debugger.sendCommand(target, "Fetch.failRequest", { requestId, errorReason: "BlockedByClient" });
    } else if (rule.action === "delay") {
      await new Promise((r) => setTimeout(r, rule.delay));
      await chrome.debugger.sendCommand(target, "Fetch.continueRequest", { requestId });
    } else {
      await chrome.debugger.sendCommand(target, "Fetch.fulfillRequest", {
        requestId,
        responseCode: rule.status,
        responseHeaders: rule.headers.filter((h) => !MOCK_DROPPED_HEADERS.has(h.name.toLowerCase())),
        body: utf8ToBase64(rule.body)
      });
    }
  } catch (err) {
    console.warn("sidewire: mock failed, letting the request through", err);
    // A paused request that is never resumed hangs the page.
    try { await chrome.debugger.sendCommand(target, "Fetch.continueRequest", { requestId }); } catch {}
  }
}

// Flags the captured entry as mocked. The CDP pause usually comes after
// webRequest's onBeforeRequest, but not always: unmatched marks are kept a few
// seconds for onBeforeRequest to pick up.
function markMocked(tabId, url, method, rule) {
  const info = { ruleId: rule.id, action: rule.action };
  const stop = Math.max(0, log.length - 200);
  for (let i = log.length - 1; i >= stop; i--) {
    const e = log[i];
    if (e.tabId === tabId && e.url === url && e.method === method && e.state === "pending" && !e.mock) {
      e.mock = info;
      persist();
      broadcast({ type: "update", entry: e });
      return;
    }
  }
  pendingMockMarks.push({ tabId, url, method, info, at: Date.now() });
}

function takeMockMark(entry) {
  const now = Date.now();
  while (pendingMockMarks.length && now - pendingMockMarks[0].at > 5000) pendingMockMarks.shift();
  const i = pendingMockMarks.findIndex((m) =>
    m.tabId === entry.tabId && m.url === entry.url && m.method === entry.method);
  if (i === -1) return null;
  return pendingMockMarks.splice(i, 1)[0].info;
}
