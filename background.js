const MAX_ENTRIES = 2000;
const STORAGE_KEY = "sidewire-log";
const STARS_KEY = "sidewire-stars";
const STATE_KEY = "sidewire-state";
// Response bodies above this size are not kept: they would bloat memory in
// both the worker and the panel. Images, media and fonts are skipped outright.
const MAX_BODY_BYTES = 1024 * 1024;
const SKIPPED_BODY_TYPES = new Set(["Image", "Media", "Font"]);

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

let persistScheduled = false;
let restored = false;

// Response bodies (captured via the debugger) can be large and often hold the
// most sensitive payloads. They are kept in memory for the live session but
// stripped before writing to storage.session — this bounds the ~10MB quota and
// keeps sensitive bodies out of at-rest storage. They can't survive a
// service-worker restart anyway (the debugger detaches), so nothing is lost.
function serializeForStorage(e) {
  if (e.responseBody == null) return e;
  const { responseBody, ...rest } = e;
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
      [STARS_KEY]: [...starredIds]
    }).catch((err) => {
      console.warn("sidewire: session persist failed (quota exceeded?)", err);
    });
  }, 500);
}

// Paused/scope survive a worker restart; capturing bodies does not, since the
// debugger session is gone with the worker.
function persistState() {
  chrome.storage.session.set({ [STATE_KEY]: { paused, scope } }).catch(() => {});
}

function broadcastState(extra) {
  broadcast({ type: "state", paused, scope, activeTabId, captureBodies, ...extra });
}

chrome.storage.session.get([STORAGE_KEY, STARS_KEY, STATE_KEY]).then((res) => {
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
  }
  trimLog();
}).catch(() => {}).finally(() => {
  restored = true;
  persist();
  broadcast(snapshotMsg());
});

// Returns the evicted ids so the panel can drop them too.
function trimLog() {
  const evicted = [];
  while (log.length > MAX_ENTRIES) {
    // Prefer evicting the oldest unstarred entry; if everything is starred,
    // enforce the hard cap by dropping the oldest so the buffer stays bounded.
    let idx = log.findIndex((e) => !starredIds.has(e.id));
    if (idx === -1) idx = 0;
    evicted.push(log.splice(idx, 1)[0].id);
    droppedCount++;
  }
  return evicted;
}

function snapshotMsg() {
  return {
    type: "snapshot",
    entries: log,
    paused, scope, activeTabId, captureBodies,
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
  if (captureBodies) await attachDebugger(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [t] = await chrome.tabs.query({ active: true, windowId });
    if (!t || t.id === activeTabId) return;
    activeTabId = t.id;
    broadcastState();
    if (captureBodies) await attachDebugger(t.id);
  } catch {}
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === attachedTabId) {
    attachedTabId = null;
    cdpRequestUrls.clear();
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidewire") return;
  ports.add(port);
  port.postMessage(snapshotMsg());
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "clear") {
      const kept = log.filter((e) => starredIds.has(e.id));
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
      const want = !!msg.value;
      if (want && !captureBodies) {
        const ok = await attachDebugger(activeTabId);
        captureBodies = ok;
      } else if (!want && captureBodies) {
        await detachDebugger();
        captureBodies = false;
      }
      broadcastState();
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

// ───── chrome.debugger for response bodies ─────

// Attach/detach calls are chained so rapid tab switches can't interleave and
// leave a tab attached that we no longer track (stuck debugger infobar).
let debuggerQueue = Promise.resolve();
function serialized(fn) {
  const run = debuggerQueue.then(fn, fn);
  debuggerQueue = run.catch(() => {});
  return run;
}

function attachDebugger(tabId) {
  return serialized(() => attachDebuggerNow(tabId));
}

function detachDebugger() {
  return serialized(detachDebuggerNow);
}

async function attachDebuggerNow(tabId) {
  if (!tabId || tabId < 0) return false;
  // `debugger` is an optional permission: the API only exists once granted.
  if (!chrome.debugger) return false;
  setupDebuggerListeners();
  if (attachedTabId === tabId) return true;
  if (attachedTabId) await detachDebuggerNow();
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    attachedTabId = tabId;
    return true;
  } catch (e) {
    console.warn("sidewire: debugger attach failed", e);
    return false;
  }
}

async function detachDebuggerNow() {
  if (!attachedTabId) return;
  const tabId = attachedTabId;
  attachedTabId = null;
  cdpRequestUrls.clear();
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
  cdpRequestUrls.clear();
  captureBodies = false;
  broadcastState();
});

async function onDebuggerEvent(source, method, params) {
  if (source.tabId !== attachedTabId) return;
  if (method === "Network.requestWillBeSent") {
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

function onDebuggerDetach(source, reason) {
  if (source.tabId === attachedTabId) {
    attachedTabId = null;
    cdpRequestUrls.clear();
    captureBodies = false;
    broadcastState({ detachReason: reason });
  }
}
