const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const TYPES = [
  "xmlhttprequest", "websocket", "script", "stylesheet",
  "image", "font", "media", "main_frame", "sub_frame", "ping", "other"
];
const DEFAULT_TYPES = new Set(["xmlhttprequest", "websocket"]);

const FORBIDDEN_FETCH_HEADERS = new Set([
  "accept-charset", "accept-encoding", "access-control-request-headers",
  "access-control-request-method", "connection", "content-length", "cookie",
  "cookie2", "date", "dnt", "expect", "host", "keep-alive", "origin",
  "referer", "te", "trailer", "transfer-encoding", "upgrade", "via"
]);

const METHOD_HELP = {
  GET:     ["GET",     "Read data from the server. Should not modify anything."],
  POST:    ["POST",    "Create a new resource (form submit, file upload, etc.)."],
  PUT:     ["PUT",     "Replace a resource entirely with the payload you send."],
  PATCH:   ["PATCH",   "Partially update an existing resource."],
  DELETE:  ["DELETE",  "Remove a resource."],
  HEAD:    ["HEAD",    "Same as GET but returns only the response headers, no body."],
  OPTIONS: ["OPTIONS", "CORS preflight — the browser asks the server what's allowed before sending the real request."]
};

const STATUS_HELP = {
  200: ["200 OK",                        "The request succeeded."],
  201: ["201 Created",                   "A new resource was created."],
  202: ["202 Accepted",                  "Accepted for processing, but not yet complete."],
  204: ["204 No Content",                "Success — the server intentionally returns no body."],
  206: ["206 Partial Content",           "Partial response (range request, e.g. video seeking)."],
  301: ["301 Moved Permanently",         "Resource has permanently moved to a new URL."],
  302: ["302 Found",                     "Temporary redirect to a different URL."],
  304: ["304 Not Modified",              "Cached version is still valid — no body returned."],
  307: ["307 Temporary Redirect",        "Temporary redirect, keep the same HTTP method."],
  308: ["308 Permanent Redirect",        "Permanent redirect, keep the same HTTP method."],
  400: ["400 Bad Request",               "The server couldn't parse the request (malformed payload, missing fields…)."],
  401: ["401 Unauthorized",              "Authentication required or invalid credentials."],
  403: ["403 Forbidden",                 "Authenticated, but not allowed to access this resource."],
  404: ["404 Not Found",                 "No resource exists at this URL."],
  405: ["405 Method Not Allowed",        "This HTTP method isn't allowed on this endpoint."],
  408: ["408 Request Timeout",           "The server timed out waiting for the request."],
  409: ["409 Conflict",                  "Request conflicts with current server state (duplicate, version mismatch…)."],
  410: ["410 Gone",                      "Resource used to exist but is permanently gone."],
  413: ["413 Payload Too Large",         "Request body exceeds the server's limit."],
  415: ["415 Unsupported Media Type",    "Server doesn't accept this Content-Type."],
  422: ["422 Unprocessable Entity",      "Request is well-formed but semantically invalid (validation errors)."],
  429: ["429 Too Many Requests",         "Rate limit exceeded — slow down or wait."],
  500: ["500 Internal Server Error",     "Generic server-side error — check the server logs."],
  501: ["501 Not Implemented",           "Server doesn't support this functionality."],
  502: ["502 Bad Gateway",               "Upstream server returned an invalid response."],
  503: ["503 Service Unavailable",       "Server is overloaded or down for maintenance."],
  504: ["504 Gateway Timeout",           "Upstream server didn't respond in time."]
};

const STATUS_BUCKET_HELP = {
  "1": ["Informational", "Provisional response — the final answer is coming."],
  "2": ["Success",       "The request was successful."],
  "3": ["Redirection",   "The browser needs to follow a different URL."],
  "4": ["Client Error",  "Something is wrong with the request you sent."],
  "5": ["Server Error",  "The server failed to handle the request."]
};

function statusHelp(e) {
  if (e.state === "error") return ["Network error", e.error || "Request failed before reaching the server."];
  if (e.status == null) return ["Pending", "Waiting for the response headers."];
  if (STATUS_HELP[e.status]) return STATUS_HELP[e.status];
  const bucket = String(e.status)[0];
  if (STATUS_BUCKET_HELP[bucket]) {
    const [name, sub] = STATUS_BUCKET_HELP[bucket];
    return [`${e.status} ${name}`, sub];
  }
  return [String(e.status), ""];
}

function errorPreview(e) {
  if (e.state === "error") {
    return { label: "Network", text: e.error || "Request failed" };
  }
  if (e.status != null && e.status >= 400) {
    const body = e.responseBody?.text;
    if (!body || e.responseBody.base64Encoded) return null;
    let text = body.trim();
    try {
      const j = JSON.parse(text);
      if (j && typeof j === "object") {
        const msg = j.message ?? j.error ?? j.error_description ?? j.detail ?? j.errors;
        if (msg != null) text = typeof msg === "string" ? msg : JSON.stringify(msg);
        else text = JSON.stringify(j);
      }
    } catch { /* not JSON, use raw */ }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > 160) text = text.slice(0, 160) + "…";
    return { label: "Response", text };
  }
  return null;
}

const state = {
  entries: [],
  byId: new Map(),
  expandedIds: new Set(),
  starred: new Set(),
  knownHosts: new Set(),
  paused: false,
  scope: "active",
  captureBodies: false,
  urlFilter: "",
  statusFilter: "",
  domainFilter: "",
  starredOnly: false,
  slowThreshold: 1000,
  decodeJwt: false,
  methods: new Set(METHODS),
  types: new Set(DEFAULT_TYPES),
  replays: new Map(),
  replayWithOpen: new Set(),
  replayDrafts: new Map(),
  decodedBase64: new Set()
};

const els = {
  list: document.getElementById("list"),
  pause: document.getElementById("pause"),
  clear: document.getElementById("clear"),
  copyAll: document.getElementById("copyAll"),
  exportHar: document.getElementById("exportHar"),
  scope: document.getElementById("scope"),
  urlFilter: document.getElementById("urlFilter"),
  urlFilterIcon: document.getElementById("urlFilterIcon"),
  urlFilterClear: document.getElementById("urlFilterClear"),
  statusFilter: document.getElementById("statusFilter"),
  domainFilter: document.getElementById("domainFilter"),
  starredOnly: document.getElementById("starredOnly"),
  slowThreshold: document.getElementById("slowThreshold"),
  captureBodies: document.getElementById("captureBodies"),
  decodeJwtToggle: document.getElementById("decodeJwtToggle"),
  methodChips: document.getElementById("methodChips"),
  typeChips: document.getElementById("typeChips"),
  counts: document.getElementById("counts"),
  themeToggle: document.getElementById("themeToggle"),
  empty: null
};

// ─── utilities ───────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "star-filled": '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  "star-empty": '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  pencil: '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>'
};

function icon(name) {
  const path = ICONS[name];
  if (!path) return "";
  const filled = name === "play" || name === "pause" || name === "star-filled" || name === "sparkles" || name === "moon";
  const fillAttr = filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="ico" viewBox="0 0 24 24" ${fillAttr} aria-hidden="true">${path}</svg>`;
}

function getHeader(headers, name) {
  if (!headers) return null;
  const lower = name.toLowerCase();
  const h = headers.find((h) => h.name?.toLowerCase() === lower);
  return h?.value || null;
}

async function copyText(text, btn) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  if (!btn) return;
  const orig = btn.textContent;
  btn.classList.add("copied");
  btn.textContent = "✓";
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = orig;
  }, 600);
}

function tryHost(url) {
  try { return new URL(url).host; } catch { return null; }
}

function compileUrlFilter(raw) {
  if (!raw) return null;
  const m = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    try { return new RegExp(m[1], m[2]); } catch { return null; }
  }
  const lower = raw.toLowerCase();
  return { test: (u) => u.toLowerCase().includes(lower) };
}

function statusBucket(e) {
  if (e.state === "error") return "err";
  if (!e.status) return null;
  return String(e.status)[0];
}

function makeMatcher() {
  const urlF = compileUrlFilter(state.urlFilter);
  const statusF = state.statusFilter;
  const domain = state.domainFilter;
  return (e) => {
    if (state.starredOnly && !state.starred.has(e.id)) return false;
    if (!state.methods.has(e.method)) return false;
    if (!state.types.has(e.type)) return false;
    if (statusF && statusBucket(e) !== statusF) return false;
    if (urlF && !urlF.test(e.url)) return false;
    if (domain && tryHost(e.url) !== domain) return false;
    return true;
  };
}

// ─── body / GraphQL helpers ──────────────────────────────────────────────

function bodyToText(body) {
  if (!body) return "";
  if (body.kind === "raw") return body.text || "";
  if (body.kind === "formData") {
    return Object.entries(body.data)
      .flatMap(([k, vals]) => (Array.isArray(vals) ? vals : [vals]).map((v) => `${k}=${v}`))
      .join("\n");
  }
  if (body.kind === "error") return `[error: ${body.error}]`;
  return "";
}

function tryPrettyJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function decodeBase64Text(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function parseCookieHeader(value) {
  if (!value) return [];
  return value.split(/;\s*/).filter(Boolean).map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) return { name: pair.trim(), value: null, flag: true };
    return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), flag: false };
  });
}

function decodeJwt(value) {
  if (!value) return null;
  const token = String(value).replace(/^Bearer\s+/i, "").trim();
  if (!JWT_RE.test(token)) return null;
  try {
    const parts = token.split(".");
    const decodeSegment = (s) => {
      const pad = s.length % 4;
      const padded = pad ? s + "=".repeat(4 - pad) : s;
      const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    };
    const headerText = decodeSegment(parts[0]);
    const payloadText = decodeSegment(parts[1]);
    return {
      header: tryPrettyJson(headerText) || headerText,
      payload: tryPrettyJson(payloadText) || payloadText
    };
  } catch {
    return null;
  }
}

function gqlOp(e) {
  if (e.method !== "POST" || !e.requestBody) return null;
  const text = bodyToText(e.requestBody);
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || !parsed.query) return null;
    if (parsed.operationName) return parsed.operationName;
    const m = parsed.query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return m ? m[1] : "(anonymous)";
  } catch { return null; }
}

// ─── builders ────────────────────────────────────────────────────────────

function buildCurl(e) {
  const parts = [`curl '${e.url.replace(/'/g, "'\\''")}'`];
  if (e.method && e.method !== "GET") parts.push(`-X ${e.method}`);
  for (const h of e.requestHeaders || []) {
    if (h.name.startsWith(":")) continue;
    const v = (h.value ?? "").replace(/'/g, "'\\''");
    parts.push(`-H '${h.name}: ${v}'`);
  }
  const body = bodyToText(e.requestBody);
  if (body) parts.push(`--data-raw '${body.replace(/'/g, "'\\''")}'`);
  return parts.join(" \\\n  ");
}

function buildFetch(e) {
  const headers = {};
  for (const h of e.requestHeaders || []) {
    if (h.name.startsWith(":")) continue;
    headers[h.name] = h.value ?? "";
  }
  const init = { headers, method: e.method, mode: "cors", credentials: "include" };
  const body = bodyToText(e.requestBody);
  if (body && e.method !== "GET" && e.method !== "HEAD") init.body = body;
  return `fetch(${JSON.stringify(e.url)}, ${JSON.stringify(init, null, 2)});`;
}

function harEntry(e) {
  let queryString = [];
  try {
    const u = new URL(e.url);
    queryString = [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch { /* ignore */ }
  const reqHeaders = (e.requestHeaders || []).map((h) => ({ name: h.name, value: h.value ?? "" }));
  const respHeaders = (e.responseHeaders || []).map((h) => ({ name: h.name, value: h.value ?? "" }));
  const reqBodyText = bodyToText(e.requestBody);
  const mimeType = getHeader(e.responseHeaders, "content-type") || "";

  const out = {
    startedDateTime: e.startedAt ? new Date(e.startedAt).toISOString() : new Date().toISOString(),
    time: e.duration ?? 0,
    request: {
      method: e.method,
      url: e.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: reqHeaders,
      queryString,
      headersSize: -1,
      bodySize: reqBodyText ? reqBodyText.length : 0
    },
    response: {
      status: e.status || 0,
      statusText: "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: respHeaders,
      content: {
        size: e.responseBody?.text?.length || -1,
        mimeType,
        text: e.responseBody?.text || ""
      },
      redirectURL: getHeader(e.responseHeaders, "location") || "",
      headersSize: -1,
      bodySize: -1
    },
    cache: {},
    timings: {
      send: 0,
      wait: e.headersReceivedAt && e.startedAt ? Math.round(e.headersReceivedAt - e.startedAt) : -1,
      receive: e.completedAt && e.headersReceivedAt ? Math.round(e.completedAt - e.headersReceivedAt) : -1
    }
  };
  if (e.responseBody?.base64Encoded) out.response.content.encoding = "base64";
  if (reqBodyText) {
    out.request.postData = {
      mimeType: getHeader(e.requestHeaders, "content-type") || "",
      text: reqBodyText
    };
  }
  return out;
}

function buildHAR(entries) {
  return {
    log: {
      version: "1.2",
      creator: { name: "Sidewire", version: "0.5.0" },
      entries: entries.map(harEntry)
    }
  };
}

// ─── replay ──────────────────────────────────────────────────────────────

async function replay(e, overrides = {}) {
  const method = overrides.method || e.method;
  const init = { method, headers: {}, credentials: "include" };
  for (const h of e.requestHeaders || []) {
    if (h.name.startsWith(":")) continue;
    if (FORBIDDEN_FETCH_HEADERS.has(h.name.toLowerCase())) continue;
    init.headers[h.name] = h.value ?? "";
  }
  const body = overrides.body != null ? overrides.body : bodyToText(e.requestBody);
  if (body && method !== "GET" && method !== "HEAD") init.body = body;
  const url = overrides.url || e.url;
  const start = performance.now();
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return {
      ok: true,
      status: res.status,
      duration: Math.round(performance.now() - start),
      headers: [...res.headers.entries()].map(([name, value]) => ({ name, value })),
      body: text
    };
  } catch (err) {
    return { ok: false, error: String(err), duration: Math.round(performance.now() - start) };
  }
}

// ─── rendering: filters ──────────────────────────────────────────────────

function renderChips(container, values, selected, kind) {
  container.innerHTML = "";
  for (const v of values) {
    const el = document.createElement("span");
    const kindCls = kind === "method" ? ` method-chip ${v}` : "";
    el.className = "chip" + kindCls + (selected.has(v) ? " on" : "");
    el.textContent = v;
    el.addEventListener("click", () => {
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      el.classList.toggle("on");
      renderList();
    });
    container.appendChild(el);
  }
}
renderChips(els.methodChips, METHODS, state.methods, "method");
renderChips(els.typeChips, TYPES, state.types);

els.clear.innerHTML = `${icon("trash")}<span>Clear</span>`;
els.copyAll.innerHTML = `${icon("copy")}<span>Copy URLs</span>`;
els.exportHar.innerHTML = `${icon("download")}<span>HAR</span>`;
els.urlFilterIcon.innerHTML = icon("search");
els.urlFilterClear.innerHTML = icon("close");

// ─── persisted UI prefs (theme, jwt decode) ─────────────────────────────
const THEME_KEY = "sidewire-theme";
const JWT_KEY = "sidewire-decode-jwt";

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.classList.toggle("theme-light", isLight);
  els.themeToggle.innerHTML = icon(isLight ? "moon" : "sun");
  els.themeToggle.title = isLight ? "Switch to dark theme" : "Switch to light theme";
}

let currentTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
applyTheme(currentTheme);

chrome.storage.local.get([THEME_KEY, JWT_KEY]).then((res) => {
  const stored = res?.[THEME_KEY];
  if (stored === "light" || stored === "dark") {
    currentTheme = stored;
    applyTheme(currentTheme);
  }
  if (res?.[JWT_KEY] === true) {
    state.decodeJwt = true;
    els.decodeJwtToggle.checked = true;
    renderList();
  }
}).catch(() => {});

els.themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  applyTheme(currentTheme);
  chrome.storage.local.set({ [THEME_KEY]: currentTheme }).catch(() => {});
});

els.decodeJwtToggle.addEventListener("change", () => {
  state.decodeJwt = els.decodeJwtToggle.checked;
  chrome.storage.local.set({ [JWT_KEY]: state.decodeJwt }).catch(() => {});
  renderList();
});

function refreshDomainOptions() {
  const current = state.domainFilter;
  const hosts = [...state.knownHosts].sort();
  els.domainFilter.innerHTML = `<option value="">All domains (${hosts.length})</option>` +
    hosts.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
  els.domainFilter.value = current;
}

// ─── replay with: drafts + editor ────────────────────────────────────────

function getOrInitDraft(e) {
  let draft = state.replayDrafts.get(e.id);
  if (draft) return draft;
  let params = [];
  try {
    const u = new URL(e.url);
    params = [...u.searchParams.entries()].map(([key, value]) => ({ key, value, enabled: true }));
  } catch { /* unparseable url */ }
  draft = { params, body: bodyToText(e.requestBody) };
  state.replayDrafts.set(e.id, draft);
  return draft;
}

function composeUrlFromDraft(e, draft) {
  try {
    const u = new URL(e.url);
    u.search = "";
    for (const p of draft.params) {
      if (p.enabled && p.key) u.searchParams.append(p.key, p.value);
    }
    return u.toString();
  } catch {
    return e.url;
  }
}

function buildReplayEditor(e) {
  const draft = getOrInitDraft(e);
  const hasBody = e.method !== "GET" && e.method !== "HEAD";

  const paramsHtml = draft.params.length === 0
    ? `<div class="kv-empty">No parameters — use + Add</div>`
    : draft.params.map((p, i) => `
      <div class="rw-param-row">
        <input type="checkbox" data-rw="param-enabled" data-i="${i}" ${p.enabled ? "checked" : ""}>
        <input type="text" data-rw="param-key" data-i="${i}" value="${escapeHtml(p.key)}" placeholder="key">
        <input type="text" data-rw="param-value" data-i="${i}" value="${escapeHtml(p.value)}" placeholder="value">
        <button class="mini rw-param-remove" data-rw="param-remove" data-i="${i}" title="Remove">${icon("close")}</button>
      </div>`).join("");

  const bodySection = hasBody ? `
    <div class="rw-subhead">
      <span>Body</span>
      <button class="mini" data-rw="body-pretty" title="Pretty-print JSON">${icon("sparkles")}<span>Pretty</span></button>
    </div>
    <textarea class="rw-body" data-rw="body" rows="8" spellcheck="false">${escapeHtml(draft.body)}</textarea>
    <div class="rw-note">Body sent as raw text. Adjust Content-Type if needed.</div>
  ` : "";

  return `
    <section class="detail-section rw-section">
      <header>
        <span>Replay with…</span>
        <button class="mini rw-close" data-rw="close" title="Close">${icon("close")}</button>
      </header>
      <div class="detail-body">
        <div class="rw-subhead"><span>Query parameters</span></div>
        <div class="rw-params">${paramsHtml}</div>
        <button class="mini" data-rw="param-add">${icon("plus")}<span>Add</span></button>
        ${bodySection}
        <div class="rw-send-row">
          <button class="mini rw-send" data-rw="send">${icon("play")}<span>Send</span></button>
        </div>
      </div>
    </section>`;
}

function attachReplayEditorHandlers(root, e) {
  const draft = getOrInitDraft(e);

  root.addEventListener("input", (ev) => {
    const t = ev.target;
    const kind = t.dataset.rw;
    if (!kind) return;
    if (kind === "param-key" || kind === "param-value") {
      const i = +t.dataset.i;
      draft.params[i][kind === "param-key" ? "key" : "value"] = t.value;
    } else if (kind === "body") {
      draft.body = t.value;
    }
  });

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.rw === "param-enabled") {
      const i = +t.dataset.i;
      draft.params[i].enabled = t.checked;
    }
  });

  root.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-rw]");
    if (!t) return;
    const kind = t.dataset.rw;
    if (kind === "close") {
      state.replayWithOpen.delete(e.id);
      renderList();
    } else if (kind === "param-add") {
      draft.params.push({ key: "", value: "", enabled: true });
      renderList();
    } else if (kind === "param-remove") {
      const i = +t.dataset.i;
      draft.params.splice(i, 1);
      renderList();
    } else if (kind === "body-pretty") {
      const pretty = tryPrettyJson(draft.body);
      if (pretty) { draft.body = pretty; renderList(); }
    } else if (kind === "send") {
      state.replays.set(e.id, { pending: true });
      renderList();
      const url = composeUrlFromDraft(e, draft);
      const result = await replay(e, { url, body: draft.body });
      state.replays.set(e.id, result);
      renderList();
    }
  });
}

// ─── rendering: detail panel ─────────────────────────────────────────────

function kvList(pairs) {
  if (!pairs || !pairs.length) return `<div class="kv-empty">—</div>`;
  return `<dl class="kv">${pairs
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v ?? "")}</dd>`)
    .join("")}</dl>`;
}

function renderJwtBlock(jwt, extraClass = "") {
  return `
    <div class="jwt-block ${extraClass}">
      <div class="jwt-label">JWT header</div>
      <pre class="code jwt-pre">${escapeHtml(jwt.header)}</pre>
      <div class="jwt-label">JWT payload</div>
      <pre class="code jwt-pre">${escapeHtml(jwt.payload)}</pre>
    </div>`;
}

function renderCookieList(value) {
  const cookies = parseCookieHeader(value);
  if (!cookies.length) return escapeHtml(value);
  return `<div class="cookies">` + cookies.map((c) => {
    if (c.flag) {
      return `<div class="cookie-row cookie-flag"><span class="cookie-name">${escapeHtml(c.name)}</span></div>`;
    }
    const jwt = state.decodeJwt ? decodeJwt(c.value) : null;
    return `
      <div class="cookie-row">
        <span class="cookie-name">${escapeHtml(c.name)}</span>
        <span class="cookie-value">${escapeHtml(c.value)}</span>
        ${jwt ? renderJwtBlock(jwt, "cookie-jwt") : ""}
      </div>`;
  }).join("") + `</div>`;
}

function renderHeadersList(headers) {
  if (!headers || !headers.length) return `<div class="kv-empty">—</div>`;
  return `<dl class="kv">` + headers.map((h) => {
    const name = h.name ?? "";
    const value = h.value ?? "";
    const lower = name.toLowerCase();
    let dd;
    if ((lower === "cookie" || lower === "set-cookie") && value) {
      dd = `<dd>${renderCookieList(value)}</dd>`;
    } else {
      const jwt = state.decodeJwt ? decodeJwt(value) : null;
      dd = `<dd>${escapeHtml(value)}${jwt ? renderJwtBlock(jwt) : ""}</dd>`;
    }
    return `<dt>${escapeHtml(name)}</dt>${dd}`;
  }).join("") + `</dl>`;
}

let sectionUid = 0;
const sectionTexts = new Map();

function section(title, copyValue, contentHtml) {
  const id = `sec-${++sectionUid}`;
  if (copyValue) sectionTexts.set(id, copyValue);
  const copyBtn = copyValue ? `<button class="mini" data-copy="${id}" title="Copy">${icon("copy")}</button>` : "";
  return `
    <section class="detail-section">
      <header><span>${escapeHtml(title)}</span>${copyBtn}</header>
      <div class="detail-body">${contentHtml}</div>
    </section>`;
}

function renderBase64Section(e, rawText) {
  const decoded = state.decodedBase64.has(e.id);
  let body, copyValue, title;
  if (decoded) {
    const r = decodeBase64Text(rawText);
    if (r.ok) {
      const pretty = tryPrettyJson(r.text);
      body = pretty || r.text;
      copyValue = body;
      title = "Response body · decoded";
    } else {
      body = `[decode error: ${r.error}]`;
      copyValue = "";
      title = "Response body · decode failed";
    }
  } else {
    body = rawText;
    copyValue = rawText;
    title = "Response body (base64)";
  }
  const id = `sec-${++sectionUid}`;
  if (copyValue) sectionTexts.set(id, copyValue);
  const decodeBtn = `<button class="mini ${decoded ? "active" : ""}" data-action="toggle-base64-decode" title="Toggle base64 decoding">${decoded ? "Show raw" : "Decode"}</button>`;
  const copyBtn = copyValue ? `<button class="mini" data-copy="${id}" title="Copy">${icon("copy")}</button>` : "";
  return `
    <section class="detail-section">
      <header>
        <span>${escapeHtml(title)}</span>
        <span class="section-actions">${decodeBtn}${copyBtn}</span>
      </header>
      <div class="detail-body"><pre class="code">${escapeHtml(body)}</pre></div>
    </section>`;
}

function jsonValueHtml(value) {
  if (value === null) return `<span class="jv-null">null</span>`;
  const t = typeof value;
  if (t === "string") return `<span class="jv-string">${escapeHtml(JSON.stringify(value))}</span>`;
  if (t === "number") return `<span class="jv-number">${escapeHtml(String(value))}</span>`;
  if (t === "boolean") return `<span class="jv-bool">${value}</span>`;
  return `<span>${escapeHtml(String(value))}</span>`;
}

function jsonKeyHtml(key) {
  if (key === undefined) return "";
  const isIndex = typeof key === "number";
  const cls = isIndex ? "jv-key jv-index" : "jv-key";
  const text = isIndex ? String(key) : JSON.stringify(key);
  return `<span class="${cls}">${escapeHtml(text)}</span><span class="jv-punct">: </span>`;
}

function jsonNode(value, key) {
  if (value !== null && typeof value === "object") {
    const isArr = Array.isArray(value);
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
    const open = isArr ? "[" : "{";
    const close = isArr ? "]" : "}";
    const keyHtml = jsonKeyHtml(key);
    if (entries.length === 0) {
      return `<div class="jv-line">${keyHtml}<span class="jv-punct">${open}${close}</span></div>`;
    }
    const count = entries.length;
    const label = isArr
      ? `${count} ${count === 1 ? "item" : "items"}`
      : `${count} ${count === 1 ? "key" : "keys"}`;
    const children = entries.map(([k, v]) => jsonNode(v, isArr ? k : k)).join("");
    return `
      <div class="jv-node">
        <div class="jv-line jv-header">
          <span class="jv-toggle"></span>${keyHtml}<span class="jv-punct">${open}</span><span class="jv-preview"> ${label} ${close}</span>
        </div>
        <div class="jv-children">${children}</div>
        <div class="jv-line jv-footer"><span class="jv-punct">${close}</span></div>
      </div>`;
  }
  return `<div class="jv-line">${jsonKeyHtml(key)}${jsonValueHtml(value)}</div>`;
}

function renderJsonTree(parsed) {
  return `<div class="jv">${jsonNode(parsed, undefined)}</div>`;
}

function bodyHtml(text, contentType) {
  if (!text) return `<div class="kv-empty">—</div>`;
  const looksJson = (contentType && /json|graphql/i.test(contentType)) || tryPrettyJson(text) !== null;
  if (looksJson) {
    try {
      return renderJsonTree(JSON.parse(text.trim()));
    } catch { /* fall through to <pre> */ }
  }
  return `<pre class="code">${escapeHtml(text)}</pre>`;
}

function fmtBodySection(title, bodyText, headers) {
  if (!bodyText) {
    return section(title, "", `<div class="kv-empty">—</div>`);
  }
  const ct = getHeader(headers, "content-type") || "";
  const copyText = tryPrettyJson(bodyText) || bodyText;
  return section(title, copyText, bodyHtml(bodyText, ct));
}

function fmtTiming(e) {
  const rows = [];
  if (e.startedAt && e.headersReceivedAt) {
    rows.push(["Waiting (TTFB)", `${Math.round(e.headersReceivedAt - e.startedAt)} ms`]);
  }
  if (e.headersReceivedAt && e.completedAt) {
    rows.push(["Receiving", `${Math.round(e.completedAt - e.headersReceivedAt)} ms`]);
  }
  if (e.duration != null) rows.push(["Total", `${e.duration} ms`]);
  if (e.startedAt) rows.push(["Started at", new Date(e.startedAt).toISOString()]);
  return kvList(rows);
}

function buildDetail(e) {
  const wrap = document.createElement("div");
  wrap.className = "detail";

  let queryRows = [];
  try {
    const u = new URL(e.url);
    queryRows = [...u.searchParams.entries()];
  } catch { /* ignore */ }

  const queryText = queryRows.map(([k, v]) => `${k}=${v}`).join("\n");
  const reqHeadersText = (e.requestHeaders || []).map((h) => `${h.name}: ${h.value ?? ""}`).join("\n");
  const respHeadersText = (e.responseHeaders || []).map((h) => `${h.name}: ${h.value ?? ""}`).join("\n");
  const reqBodyText = bodyToText(e.requestBody);
  const respBodyText = e.responseBody?.text || "";
  const respIsBase64 = !!e.responseBody?.base64Encoded;

  const reqBodySection = e.requestBody?.kind === "formData"
    ? section("Request body", reqBodyText, kvList(Object.entries(e.requestBody.data).flatMap(([k, vals]) =>
        (Array.isArray(vals) ? vals : [vals]).map((v) => [k, v]))))
    : fmtBodySection("Request body", reqBodyText, e.requestHeaders);

  const respBodySection = e.responseBody == null
    ? section("Response body", "",
        `<div class="kv-empty">${state.captureBodies ? "(not captured)" : "Enable response body capture to see this"}</div>`)
    : respIsBase64
      ? renderBase64Section(e, respBodyText)
      : fmtBodySection("Response body", respBodyText, e.responseHeaders);

  const replayResult = state.replays.get(e.id);
  const replaySection = replayResult ? renderReplay(replayResult) : "";

  const editorOpen = state.replayWithOpen.has(e.id);
  wrap.innerHTML = `
    <div class="detail-toolbar">
      <button class="mini" data-action="copy-url">${icon("copy")}<span>Copy URL</span></button>
      <button class="mini" data-action="copy-curl">${icon("copy")}<span>cURL</span></button>
      <button class="mini" data-action="copy-fetch">${icon("copy")}<span>fetch</span></button>
      <button class="mini" data-action="replay">${icon("play")}<span>Replay</span></button>
      <button class="mini ${editorOpen ? "active" : ""}" data-action="replay-with">${icon("pencil")}<span>Replay with…</span></button>
    </div>
    ${editorOpen ? buildReplayEditor(e) : ""}
    ${section("URL", e.url, `<div class="code">${escapeHtml(e.url)}</div>`)}
    ${section("Query parameters", queryText, kvList(queryRows))}
    ${section("Request headers", reqHeadersText, renderHeadersList(e.requestHeaders))}
    ${reqBodySection}
    ${section("Response headers", respHeadersText, renderHeadersList(e.responseHeaders))}
    ${respBodySection}
    ${section("Timing", "", fmtTiming(e))}
    ${replaySection}
  `;

  wrap.querySelector('[data-action="copy-url"]').addEventListener("click", (ev) => {
    copyText(e.url, ev.currentTarget);
  });
  wrap.querySelector('[data-action="copy-curl"]').addEventListener("click", (ev) => {
    copyText(buildCurl(e), ev.currentTarget);
  });
  wrap.querySelector('[data-action="copy-fetch"]').addEventListener("click", (ev) => {
    copyText(buildFetch(e), ev.currentTarget);
  });
  wrap.querySelector('[data-action="replay"]').addEventListener("click", async () => {
    state.replays.set(e.id, { pending: true });
    renderList();
    const result = await replay(e);
    state.replays.set(e.id, result);
    renderList();
  });
  wrap.querySelector('[data-action="replay-with"]').addEventListener("click", () => {
    if (state.replayWithOpen.has(e.id)) state.replayWithOpen.delete(e.id);
    else state.replayWithOpen.add(e.id);
    renderList();
  });
  const decodeBtn = wrap.querySelector('[data-action="toggle-base64-decode"]');
  if (decodeBtn) {
    decodeBtn.addEventListener("click", () => {
      if (state.decodedBase64.has(e.id)) state.decodedBase64.delete(e.id);
      else state.decodedBase64.add(e.id);
      renderList();
    });
  }
  const editor = wrap.querySelector(".rw-section");
  if (editor) attachReplayEditorHandlers(editor, e);
  for (const btn of wrap.querySelectorAll("button.mini[data-copy]")) {
    btn.addEventListener("click", (ev) => {
      const id = btn.getAttribute("data-copy");
      copyText(sectionTexts.get(id) || "", ev.currentTarget);
    });
  }
  wrap.addEventListener("click", (ev) => {
    const header = ev.target.closest(".jv-header");
    if (header && wrap.contains(header) && !window.getSelection()?.toString()) {
      header.parentElement.classList.toggle("collapsed");
    }
  });
  return wrap;
}

function renderReplay(r) {
  if (r.pending) {
    return `<section class="detail-section replay-section">
      <header><span>Replaying…</span></header>
      <div class="detail-body"><div class="kv-empty">⏳ in flight</div></div>
    </section>`;
  }
  if (!r.ok) {
    return `<section class="detail-section replay-section">
      <header><span>Replay error · ${r.duration}ms</span></header>
      <div class="detail-body"><pre class="code error">${escapeHtml(r.error)}</pre></div>
    </section>`;
  }
  const ct = (r.headers || []).find((h) => h.name?.toLowerCase() === "content-type")?.value || "";
  return `<section class="detail-section replay-section">
    <header><span>Replay result · ${r.status} · ${r.duration}ms</span></header>
    <div class="detail-body">
      ${kvList(r.headers.map((h) => [h.name, h.value]))}
      ${bodyHtml(r.body, ct)}
    </div>
  </section>`;
}

// ─── rendering: row ──────────────────────────────────────────────────────

function fmtUrl(url) {
  try {
    const u = new URL(url);
    return `<span class="host">${escapeHtml(u.host)}</span><span class="path">${escapeHtml(u.pathname + u.search)}</span>`;
  } catch {
    return escapeHtml(url);
  }
}

function entryRow(e) {
  const li = document.createElement("li");
  const isExpanded = state.expandedIds.has(e.id);
  const isSlow = e.duration != null && e.duration >= state.slowThreshold;
  const isStarred = state.starred.has(e.id);
  const isError = e.state === "error" || (e.status != null && e.status >= 400);
  li.className = "entry"
    + (isExpanded ? " expanded" : "")
    + (isError ? " error" : "")
    + (isSlow ? " slow" : "")
    + (isStarred ? " starred" : "");
  li.dataset.id = e.id;

  const sb = statusBucket(e);
  const statusText = e.state === "error" ? "ERR"
    : e.status != null ? e.status
    : "···";
  const op = gqlOp(e);

  const main = document.createElement("div");
  main.className = "row-main";
  main.innerHTML = `
    <span class="caret">${icon(isExpanded ? "chevron-down" : "chevron-right")}</span>
    <span class="star" title="Star (kept across Clear)">${icon(isStarred ? "star-filled" : "star-empty")}</span>
    <span class="method ${e.method}" data-tip-method="${e.method}">${e.method}</span>
    <span class="status ${sb ? "s" + sb : ""}" data-tip-status="${escapeHtml(e.id)}">${escapeHtml(statusText)}</span>
    <span class="url" title="${escapeHtml(e.url)}">${fmtUrl(e.url)}${op ? `<span class="gql-op">${escapeHtml(op)}</span>` : ""}</span>
    <span class="duration">${e.duration != null ? e.duration + "ms" : ""}</span>
  `;

  main.addEventListener("click", (ev) => {
    if (ev.target.closest(".url") || ev.target.closest(".star")) return;
    if (state.expandedIds.has(e.id)) state.expandedIds.delete(e.id);
    else state.expandedIds.add(e.id);
    renderList();
  });
  main.querySelector(".url").addEventListener("click", async (ev) => {
    ev.stopPropagation();
    await navigator.clipboard.writeText(e.url);
    main.classList.add("copied");
    setTimeout(() => main.classList.remove("copied"), 400);
  });
  main.querySelector(".star").addEventListener("click", (ev) => {
    ev.stopPropagation();
    safePost({ type: "toggleStar", id: e.id });
  });

  li.appendChild(main);

  if (!isExpanded) {
    const hint = errorPreview(e);
    if (hint) {
      const hintEl = document.createElement("div");
      hintEl.className = "row-hint";
      hintEl.innerHTML = `<span class="label">${escapeHtml(hint.label)}</span>${escapeHtml(hint.text)}`;
      li.appendChild(hintEl);
    }
  }

  if (isExpanded) li.appendChild(buildDetail(e));
  return li;
}

function renderEmptyState(noEntries) {
  const li = document.createElement("li");
  li.className = "empty";
  if (noEntries) {
    li.innerHTML = `
      <span class="empty-icon">${icon("inbox")}</span>
      <div class="empty-title">Waiting for requests</div>
      <div class="empty-hint">Browse a site to start capturing.<br>Press <kbd>P</kbd> to pause · <kbd>/</kbd> to filter</div>
    `;
  } else {
    li.innerHTML = `
      <span class="empty-icon">${icon("search")}</span>
      <div class="empty-title">No matches</div>
      <div class="empty-hint">Try clearing filters or check the methods/types section.</div>
    `;
  }
  return li;
}

let renderScheduled = false;
function renderList() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    const active = document.activeElement;
    const isTextField = active && (
      active.tagName === "TEXTAREA" ||
      (active.tagName === "INPUT" && (active.type === "text" || !active.type))
    );
    if (isTextField && active.closest(".rw-section")) {
      renderScheduled = true;
      setTimeout(() => { renderScheduled = false; renderList(); }, 500);
      return;
    }
    sectionTexts.clear();
    sectionUid = 0;
    const matcher = makeMatcher();
    const visible = state.entries.filter(matcher);
    const wasAtBottom =
      els.list.scrollTop + els.list.clientHeight >= els.list.scrollHeight - 20;
    els.list.innerHTML = "";
    if (visible.length === 0) {
      els.list.appendChild(renderEmptyState(state.entries.length === 0));
    } else {
      const frag = document.createDocumentFragment();
      for (const e of visible) frag.appendChild(entryRow(e));
      els.list.appendChild(frag);
      if (wasAtBottom && state.expandedIds.size === 0) {
        els.list.scrollTop = els.list.scrollHeight;
      }
    }
    els.counts.textContent =
      `${visible.length} shown · ${state.entries.length} captured · ${state.starred.size} starred` +
      (state.paused ? " · PAUSED" : "");
  });
}

function trackHost(e) {
  const h = tryHost(e.url);
  if (h && !state.knownHosts.has(h)) {
    state.knownHosts.add(h);
    refreshDomainOptions();
  }
}

function upsert(entry) {
  const existing = state.byId.get(entry.id);
  if (existing) Object.assign(existing, entry);
  else {
    state.byId.set(entry.id, entry);
    state.entries.push(entry);
    trackHost(entry);
  }
  renderList();
}

// ─── port ────────────────────────────────────────────────────────────────
// The background service worker is shut down after ~30s of inactivity in MV3.
// When that happens, our port is invalidated. We reconnect on demand.

let port = null;

function handlePortMessage(msg) {
  if (msg.type === "snapshot") {
    state.entries = msg.entries.slice();
    state.byId = new Map(state.entries.map((e) => [e.id, e]));
    state.knownHosts = new Set(state.entries.map((e) => tryHost(e.url)).filter(Boolean));
    state.starred = new Set(msg.starred || []);
    state.paused = msg.paused;
    state.scope = msg.scope;
    state.captureBodies = !!msg.captureBodies;
    syncControls();
    refreshDomainOptions();
    renderList();
  } else if (msg.type === "add" || msg.type === "update") {
    upsert(msg.entry);
  } else if (msg.type === "cleared") {
    state.entries = (msg.entries || []).slice();
    state.byId = new Map(state.entries.map((e) => [e.id, e]));
    state.expandedIds = new Set([...state.expandedIds].filter((id) => state.byId.has(id)));
    state.replays = new Map([...state.replays].filter(([id]) => state.byId.has(id)));
    state.replayWithOpen = new Set([...state.replayWithOpen].filter((id) => state.byId.has(id)));
    state.replayDrafts = new Map([...state.replayDrafts].filter(([id]) => state.byId.has(id)));
    state.decodedBase64 = new Set([...state.decodedBase64].filter((id) => state.byId.has(id)));
    renderList();
  } else if (msg.type === "starred") {
    state.starred = new Set(msg.ids || []);
    renderList();
  } else if (msg.type === "state") {
    state.paused = msg.paused;
    state.scope = msg.scope;
    state.captureBodies = !!msg.captureBodies;
    if (msg.detachReason) console.info("debugger detached:", msg.detachReason);
    syncControls();
    renderList();
  }
}

function connectPort() {
  port = chrome.runtime.connect({ name: "sidewire" });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => { port = null; });
  return port;
}

function safePost(msg) {
  try {
    if (!port) connectPort();
    port.postMessage(msg);
  } catch {
    // port was alive but got killed between check and send — reconnect once
    try {
      connectPort();
      port.postMessage(msg);
    } catch (e) {
      console.warn("sidewire: failed to send to background", e);
    }
  }
}

connectPort();

function syncControls() {
  els.pause.innerHTML = state.paused
    ? `${icon("play")}<span>Resume</span>`
    : `${icon("pause")}<span>Pause</span>`;
  els.pause.classList.toggle("active", state.paused);
  els.scope.value = state.scope;
  els.captureBodies.checked = state.captureBodies;
}

// ─── controls ────────────────────────────────────────────────────────────

els.pause.addEventListener("click", () => {
  safePost({ type: "setPaused", value: !state.paused });
});
els.clear.addEventListener("click", () => safePost({ type: "clear" }));
els.scope.addEventListener("change", () => {
  safePost({ type: "setScope", value: els.scope.value });
});
els.urlFilter.addEventListener("input", () => {
  state.urlFilter = els.urlFilter.value;
  els.urlFilterClear.hidden = !els.urlFilter.value;
  renderList();
});
els.urlFilterClear.addEventListener("click", () => {
  els.urlFilter.value = "";
  state.urlFilter = "";
  els.urlFilterClear.hidden = true;
  els.urlFilter.focus();
  renderList();
});
els.statusFilter.addEventListener("change", () => {
  state.statusFilter = els.statusFilter.value;
  renderList();
});
els.domainFilter.addEventListener("change", () => {
  state.domainFilter = els.domainFilter.value;
  renderList();
});
els.starredOnly.addEventListener("change", () => {
  state.starredOnly = els.starredOnly.checked;
  renderList();
});
els.slowThreshold.addEventListener("input", () => {
  state.slowThreshold = Number(els.slowThreshold.value) || 0;
  renderList();
});
els.captureBodies.addEventListener("change", () => {
  safePost({ type: "setCaptureBodies", value: els.captureBodies.checked });
});
els.copyAll.addEventListener("click", async () => {
  const urls = state.entries.filter(makeMatcher()).map((e) => e.url).join("\n");
  if (!urls) return;
  await navigator.clipboard.writeText(urls);
  els.copyAll.innerHTML = `${icon("check")}<span>Copied</span>`;
  setTimeout(() => {
    els.copyAll.innerHTML = `${icon("copy")}<span>Copy URLs</span>`;
  }, 800);
});
els.exportHar.addEventListener("click", () => {
  const visible = state.entries.filter(makeMatcher());
  if (!visible.length) return;
  const har = buildHAR(visible);
  const blob = new Blob([JSON.stringify(har, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sidewire-${new Date().toISOString().replace(/[:.]/g, "-")}.har`;
  a.click();
  URL.revokeObjectURL(url);
});

// ─── hotkeys ─────────────────────────────────────────────────────────────

document.addEventListener("keydown", (ev) => {
  const inField = ev.target.matches("input, textarea, select");
  if (ev.key === "/" && !inField) {
    ev.preventDefault();
    els.urlFilter.focus();
    els.urlFilter.select();
  } else if (ev.key === "Escape") {
    if (document.activeElement === els.urlFilter) {
      els.urlFilter.value = "";
      state.urlFilter = "";
      renderList();
      els.urlFilter.blur();
    }
  } else if (ev.key === "p" && !inField) {
    safePost({ type: "setPaused", value: !state.paused });
  }
});

// ───── Help tooltip (method / status) ─────
let tooltipEl = null;
function getTooltipEl() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "sw-tooltip";
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}
function showTooltip(target, title, sub) {
  const el = getTooltipEl();
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ""}`;
  el.classList.add("visible");
  const r = target.getBoundingClientRect();
  const tr = el.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 6;
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("visible");
}
document.addEventListener("mouseover", (ev) => {
  const t = ev.target.closest("[data-tip-method], [data-tip-status]");
  if (!t) return;
  const method = t.dataset.tipMethod;
  if (method) {
    const help = METHOD_HELP[method];
    if (help) showTooltip(t, help[0], help[1]);
    else showTooltip(t, method, "Custom HTTP method.");
    return;
  }
  const statusId = t.dataset.tipStatus;
  if (statusId) {
    const entry = state.byId.get(statusId);
    if (entry) {
      const [title, sub] = statusHelp(entry);
      showTooltip(t, title, sub);
    }
  }
});
document.addEventListener("mouseout", (ev) => {
  const from = ev.target.closest?.("[data-tip-method], [data-tip-status]");
  if (!from) return;
  const to = ev.relatedTarget && ev.relatedTarget.closest?.("[data-tip-method], [data-tip-status]");
  if (to) return; // moving to another tip target — let mouseover reposition
  hideTooltip();
});
window.addEventListener("scroll", hideTooltip, true);
