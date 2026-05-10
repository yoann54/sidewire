const MAX_ENTRIES = 2000;
const STORAGE_KEY = "watch-network-log";
const STARS_KEY = "watch-network-stars";

const inflight = new Map();
const log = [];
const ports = new Set();
const starredIds = new Set();

let paused = false;
let scope = "active";
let activeTabId = null;
let captureBodies = false;
let attachedTabId = null;
const cdpRequestUrls = new Map();

let persistScheduled = false;
function persist() {
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    chrome.storage.session.set({
      [STORAGE_KEY]: log,
      [STARS_KEY]: [...starredIds]
    }).catch(() => {});
  }, 500);
}

chrome.storage.session.get([STORAGE_KEY, STARS_KEY]).then((res) => {
  const saved = res?.[STORAGE_KEY];
  if (Array.isArray(saved) && saved.length) {
    for (const e of saved) {
      if (e.state === "pending") e.state = "completed";
      log.push(e);
    }
  }
  const stars = res?.[STARS_KEY];
  if (Array.isArray(stars)) for (const id of stars) starredIds.add(id);
  broadcast({ type: "snapshot", entries: log, paused, scope, activeTabId, captureBodies, starred: [...starredIds] });
}).catch(() => {});

chrome.tabs.query({ active: true, lastFocusedWindow: true }, ([t]) => {
  if (t) activeTabId = t.id;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  broadcast({ type: "state", paused, scope, activeTabId, captureBodies });
  if (captureBodies) await attachDebugger(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === attachedTabId) {
    attachedTabId = null;
    cdpRequestUrls.clear();
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "watch-network") return;
  ports.add(port);
  port.postMessage({
    type: "snapshot",
    entries: log,
    paused, scope, activeTabId, captureBodies,
    starred: [...starredIds]
  });
  port.onMessage.addListener(async (msg) => {
    if (msg.type === "clear") {
      const kept = log.filter((e) => starredIds.has(e.id));
      log.length = 0;
      log.push(...kept);
      inflight.clear();
      persist();
      broadcast({ type: "cleared", entries: log });
    } else if (msg.type === "setPaused") {
      paused = !!msg.value;
      broadcast({ type: "state", paused, scope, activeTabId, captureBodies });
    } else if (msg.type === "setScope") {
      scope = msg.value === "all" ? "all" : "active";
      broadcast({ type: "state", paused, scope, activeTabId, captureBodies });
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
      broadcast({ type: "state", paused, scope, activeTabId, captureBodies });
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
  if (scope === "active" && details.tabId !== activeTabId) return false;
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
    while (log.length > MAX_ENTRIES) {
      const dropped = log.shift();
      if (starredIds.has(dropped?.id)) log.unshift(dropped);
    }
    persist();
    broadcast({ type: "add", entry });
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

async function attachDebugger(tabId) {
  if (!tabId || tabId < 0) return false;
  if (attachedTabId === tabId) return true;
  if (attachedTabId) await detachDebugger();
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    attachedTabId = tabId;
    return true;
  } catch (e) {
    console.warn("watch-network: debugger attach failed", e);
    return false;
  }
}

async function detachDebugger() {
  if (!attachedTabId) return;
  const tabId = attachedTabId;
  attachedTabId = null;
  cdpRequestUrls.clear();
  try { await chrome.debugger.detach({ tabId }); } catch {}
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source.tabId !== attachedTabId) return;
  if (method === "Network.requestWillBeSent") {
    cdpRequestUrls.set(params.requestId, params.request?.url);
  } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    const url = cdpRequestUrls.get(params.requestId);
    cdpRequestUrls.delete(params.requestId);
    if (!url || method === "Network.loadingFailed") return;
    try {
      const res = await chrome.debugger.sendCommand(
        { tabId: source.tabId },
        "Network.getResponseBody",
        { requestId: params.requestId }
      );
      const entry = [...log].reverse().find(
        (e) => e.url === url && e.responseBody == null && e.tabId === source.tabId
      );
      if (entry) {
        entry.responseBody = {
          text: res.body || "",
          base64Encoded: !!res.base64Encoded
        };
        persist();
        broadcast({ type: "update", entry });
      }
    } catch {
      // body unavailable (cleared from cache, etc.)
    }
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === attachedTabId) {
    attachedTabId = null;
    cdpRequestUrls.clear();
    captureBodies = false;
    broadcast({ type: "state", paused, scope, activeTabId, captureBodies, detachReason: reason });
  }
});
