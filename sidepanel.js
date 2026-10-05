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
  decodedBase64: new Set(),
  searchBodies: false,
  flagSecrets: false,
  // On by default, like DevTools' sanitized HAR export.
  redactHar: true,
  showSize: false,
  showWaterfall: false,
  groupByDomain: false,
  collapsedHosts: new Set(),
  diffSelection: [],
  dropped: 0
};

const els = {
  list: document.getElementById("list"),
  pause: document.getElementById("pause"),
  clear: document.getElementById("clear"),
  copyAll: document.getElementById("copyAll"),
  exportHar: document.getElementById("exportHar"),
  importHar: document.getElementById("importHar"),
  harFileInput: document.getElementById("harFileInput"),
  diffBtn: document.getElementById("diffBtn"),
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
  searchBodies: document.getElementById("searchBodies"),
  flagSecrets: document.getElementById("flagSecrets"),
  redactHar: document.getElementById("redactHar"),
  showSize: document.getElementById("showSize"),
  showWaterfall: document.getElementById("showWaterfall"),
  groupByDomain: document.getElementById("groupByDomain"),
  methodChips: document.getElementById("methodChips"),
  typeChips: document.getElementById("typeChips"),
  counts: document.getElementById("counts"),
  themeToggle: document.getElementById("themeToggle"),
  donate: document.getElementById("donate"),
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
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
  upload: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  diff: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="6" y1="9" x2="6" y2="15"/><path d="M18 9a9 9 0 01-9 9M18 9V6a2 2 0 00-2-2h-3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 10-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 000-7.8z"/>'
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
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    try {
      const re = new RegExp(m[1], m[2]);
      return { test: (u) => re.test(u) };
    } catch { return null; }
  }
  // Space-separated terms: all positive terms must match (AND), any term
  // prefixed with "-" excludes. e.g. `api -analytics -.png`
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const pos = [], neg = [];
  for (const t of tokens) {
    if (t.startsWith("-") && t.length > 1) neg.push(t.slice(1));
    else pos.push(t);
  }
  return {
    test: (u) => {
      const s = u.toLowerCase();
      for (const n of neg) if (s.includes(n)) return false;
      for (const p of pos) if (!s.includes(p)) return false;
      return true;
    }
  };
}

// Text a "search bodies/headers" filter matches against: URL + headers + bodies.
function entryHaystack(e) {
  const parts = [e.url];
  for (const h of e.requestHeaders || []) parts.push(h.name, h.value);
  for (const h of e.responseHeaders || []) parts.push(h.name, h.value);
  const rb = bodyToText(e.requestBody);
  if (rb) parts.push(rb);
  if (e.responseBody?.text && !e.responseBody.base64Encoded) parts.push(e.responseBody.text);
  return parts.filter(Boolean).join("\n");
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
    if (urlF && !urlF.test(state.searchBodies ? entryHaystack(e) : e.url)) return false;
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

// Body as it should go back on the wire (replay, cURL, fetch, HAR). webRequest
// decodes both urlencoded and multipart forms into formData; the original
// multipart boundary is lost, so forms are always re-sent urlencoded.
function wireBody(body) {
  if (body?.kind !== "formData") return bodyToText(body);
  const params = new URLSearchParams();
  for (const [k, vals] of Object.entries(body.data)) {
    for (const v of Array.isArray(vals) ? vals : [vals]) params.append(k, v);
  }
  return params.toString();
}

// Request headers to re-send: drops HTTP/2 pseudo-headers and, for formData
// bodies, swaps Content-Type to match what wireBody() produces.
function wireHeaders(e) {
  const isForm = e.requestBody?.kind === "formData";
  const out = [];
  for (const h of e.requestHeaders || []) {
    if (h.name.startsWith(":")) continue;
    if (isForm && h.name.toLowerCase() === "content-type") continue;
    out.push({ name: h.name, value: h.value ?? "" });
  }
  if (isForm) out.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
  return out;
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
  // Everything goes through shq(): header names may legally contain ' ` $ | &.
  const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const parts = [`curl ${shq(e.url)}`];
  if (e.method && e.method !== "GET") parts.push(`-X ${shq(e.method)}`);
  for (const h of wireHeaders(e)) parts.push(`-H ${shq(`${h.name}: ${h.value}`)}`);
  const body = wireBody(e.requestBody);
  if (body) parts.push(`--data-raw ${shq(body)}`);
  return parts.join(" \\\n  ");
}

function buildFetch(e) {
  const headers = {};
  for (const h of wireHeaders(e)) headers[h.name] = h.value;
  const init = { headers, method: e.method, mode: "cors", credentials: "include" };
  const body = wireBody(e.requestBody);
  if (body && e.method !== "GET" && e.method !== "HEAD") init.body = body;
  return `fetch(${JSON.stringify(e.url)}, ${JSON.stringify(init, null, 2)});`;
}

function buildPowerShell(e) {
  const psq = (s) => String(s).replace(/'/g, "''");
  const headers = wireHeaders(e);
  let prefix = "";
  if (headers.length) {
    const pairs = headers.map((h) => `  '${psq(h.name)}' = '${psq(h.value)}'`).join("\n");
    prefix = `$headers = @{\n${pairs}\n}\n`;
  }
  const parts = [`Invoke-WebRequest -Uri '${psq(e.url)}'`, `-Method '${psq(e.method)}'`];
  if (headers.length) parts.push(`-Headers $headers`);
  const body = wireBody(e.requestBody);
  if (body && e.method !== "GET" && e.method !== "HEAD") parts.push(`-Body '${psq(body)}'`);
  return prefix + parts.join(" `\n  ");
}

function buildNodeFetch(e) {
  const headers = {};
  for (const h of wireHeaders(e)) headers[h.name] = h.value;
  const init = { method: e.method, headers };
  const body = wireBody(e.requestBody);
  if (body && e.method !== "GET" && e.method !== "HEAD") init.body = body;
  return `// Node 18+ (global fetch)\n` +
    `const res = await fetch(${JSON.stringify(e.url)}, ${JSON.stringify(init, null, 2)});\n` +
    `const text = await res.text();\n` +
    `console.log(res.status, text);`;
}

function harEntry(e) {
  let queryString = [];
  try {
    const u = new URL(e.url);
    queryString = [...u.searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch { /* ignore */ }
  const harHeader = (h) => ({
    name: h.name,
    value: state.redactHar && SENSITIVE_HEADERS.has(h.name?.toLowerCase()) ? "[redacted]" : (h.value ?? "")
  });
  const reqHeaders = (e.requestHeaders || []).map(harHeader);
  const respHeaders = (e.responseHeaders || []).map(harHeader);
  const reqBodyText = wireBody(e.requestBody);
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
      mimeType: getHeader(wireHeaders(e), "content-type") || "",
      text: reqBodyText
    };
  }
  return out;
}

function buildHAR(entries) {
  return {
    log: {
      version: "1.2",
      creator: { name: "Sidewire", version: "0.7.0" },
      entries: entries.map(harEntry)
    }
  };
}

const HTTP_TOKEN_RE = /^[A-Za-z]+$/;

// Convert a parsed HAR log back into internal entry objects for display.
function harToEntries(har, stamp) {
  const list = har?.log?.entries;
  if (!Array.isArray(list)) return [];
  return list.map((h, i) => {
    const req = h.request || {};
    const res = h.response || {};
    const started = h.startedDateTime ? Date.parse(h.startedDateTime) : null;
    const startedAt = Number.isNaN(started) ? null : started;
    const time = typeof h.time === "number" && h.time >= 0 ? Math.round(h.time) : null;
    const t = h.timings || {};
    const send = typeof t.send === "number" && t.send > 0 ? t.send : 0;
    const wait = typeof t.wait === "number" && t.wait > 0 ? t.wait : 0;
    const headersAt = startedAt != null ? startedAt + send + wait : null;
    const content = res.content || {};
    const respText = content.text || "";
    const isB64 = content.encoding === "base64";
    const reqBodyText = req.postData?.text || "";
    const method = typeof req.method === "string" && HTTP_TOKEN_RE.test(req.method)
      ? req.method.toUpperCase() : "GET";
    let type = h._resourceType || "other";
    if (!TYPES.includes(type)) type = "other";
    const status = typeof res.status === "number" ? res.status : null;
    return {
      id: `har-${stamp}-${i}`,
      url: req.url || "",
      method,
      type,
      tabId: -2,
      startedAt,
      headersReceivedAt: headersAt,
      completedAt: (startedAt != null && time != null) ? startedAt + time : null,
      status: status === 0 ? null : status,
      duration: time,
      state: status === 0 ? "error" : "completed",
      error: status === 0 ? "imported (no response)" : null,
      requestHeaders: Array.isArray(req.headers) ? req.headers.map((x) => ({ name: x.name, value: x.value })) : [],
      requestBody: reqBodyText ? { kind: "raw", text: reqBodyText } : null,
      responseHeaders: Array.isArray(res.headers) ? res.headers.map((x) => ({ name: x.name, value: x.value })) : [],
      responseBody: respText ? { text: respText, base64Encoded: isB64 } : null,
      imported: true
    };
  });
}

// ─── replay ──────────────────────────────────────────────────────────────

// Imported entries come from an arbitrary file: replaying one sends a request
// to its URL with the user's cookies, so ask first.
function confirmImportedReplay(e) {
  if (!e.imported) return true;
  return confirm(`This request comes from an imported HAR file.\n\nSend ${e.method} ${e.url} with your browser cookies?`);
}

async function replay(e, overrides = {}) {
  const method = overrides.method || e.method;
  const init = { method, headers: {}, credentials: "include" };
  for (const h of wireHeaders(e)) {
    if (FORBIDDEN_FETCH_HEADERS.has(h.name.toLowerCase())) continue;
    init.headers[h.name] = h.value;
  }
  const body = overrides.body != null ? overrides.body : wireBody(e.requestBody);
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
    const el = document.createElement("button");
    el.type = "button";
    const kindCls = kind === "method" ? ` method-chip ${v}` : "";
    el.className = "chip" + kindCls + (selected.has(v) ? " on" : "");
    el.setAttribute("aria-pressed", String(selected.has(v)));
    el.textContent = v;
    el.addEventListener("click", () => {
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      el.classList.toggle("on");
      el.setAttribute("aria-pressed", String(selected.has(v)));
      savePrefs();
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
els.importHar.innerHTML = `${icon("upload")}<span>Import</span>`;
els.urlFilterIcon.innerHTML = icon("search");
els.urlFilterClear.innerHTML = icon("close");
els.donate.innerHTML = icon("heart");
els.donate.addEventListener("click", () => {
  // Just navigate to an external URL in a new tab — no remote code runs in the
  // extension, so this stays within MV3's CSP and Web Store policy.
  chrome.tabs.create({ url: "https://paypal.me/yoadadev" });
});

// ─── persisted UI prefs (theme, filters, toggles) ───────────────────────
const THEME_KEY = "sidewire-theme";
const PREFS_KEY = "sidewire-prefs";
const LEGACY_JWT_KEY = "sidewire-decode-jwt";

function applyTheme(theme) {
  const isLight = theme === "light";
  document.documentElement.classList.toggle("theme-light", isLight);
  els.themeToggle.innerHTML = icon(isLight ? "moon" : "sun");
  els.themeToggle.title = isLight ? "Switch to dark theme" : "Switch to light theme";
}

let currentTheme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
applyTheme(currentTheme);

function collectPrefs() {
  return {
    decodeJwt: state.decodeJwt,
    searchBodies: state.searchBodies,
    flagSecrets: state.flagSecrets,
    redactHar: state.redactHar,
    showSize: state.showSize,
    showWaterfall: state.showWaterfall,
    groupByDomain: state.groupByDomain,
    urlFilter: state.urlFilter,
    statusFilter: state.statusFilter,
    domainFilter: state.domainFilter,
    starredOnly: state.starredOnly,
    slowThreshold: state.slowThreshold,
    methods: [...state.methods],
    types: [...state.types]
  };
}

let savePrefsScheduled = false;
function savePrefs() {
  if (savePrefsScheduled) return;
  savePrefsScheduled = true;
  setTimeout(() => {
    savePrefsScheduled = false;
    chrome.storage.local.set({ [PREFS_KEY]: collectPrefs() }).catch(() => {});
  }, 300);
}

function syncPrefControls() {
  els.decodeJwtToggle.checked = state.decodeJwt;
  els.searchBodies.checked = state.searchBodies;
  els.flagSecrets.checked = state.flagSecrets;
  els.redactHar.checked = state.redactHar;
  els.showSize.checked = state.showSize;
  els.showWaterfall.checked = state.showWaterfall;
  els.groupByDomain.checked = state.groupByDomain;
  els.urlFilter.value = state.urlFilter;
  els.urlFilterClear.hidden = !state.urlFilter;
  els.statusFilter.value = state.statusFilter;
  els.starredOnly.checked = state.starredOnly;
  els.slowThreshold.value = state.slowThreshold;
  els.list.classList.toggle("show-size", state.showSize);
  els.list.classList.toggle("show-waterfall", state.showWaterfall);
}

function applyPrefs(p) {
  if (typeof p.decodeJwt === "boolean") state.decodeJwt = p.decodeJwt;
  if (typeof p.searchBodies === "boolean") state.searchBodies = p.searchBodies;
  if (typeof p.flagSecrets === "boolean") state.flagSecrets = p.flagSecrets;
  if (typeof p.redactHar === "boolean") state.redactHar = p.redactHar;
  if (typeof p.showSize === "boolean") state.showSize = p.showSize;
  if (typeof p.showWaterfall === "boolean") state.showWaterfall = p.showWaterfall;
  if (typeof p.groupByDomain === "boolean") state.groupByDomain = p.groupByDomain;
  if (typeof p.urlFilter === "string") state.urlFilter = p.urlFilter;
  if (typeof p.statusFilter === "string") state.statusFilter = p.statusFilter;
  if (typeof p.domainFilter === "string") state.domainFilter = p.domainFilter;
  if (typeof p.starredOnly === "boolean") state.starredOnly = p.starredOnly;
  if (typeof p.slowThreshold === "number") state.slowThreshold = p.slowThreshold;
  if (Array.isArray(p.methods) && p.methods.length) state.methods = new Set(p.methods);
  if (Array.isArray(p.types) && p.types.length) state.types = new Set(p.types);
  syncPrefControls();
  renderChips(els.methodChips, METHODS, state.methods, "method");
  renderChips(els.typeChips, TYPES, state.types);
  refreshDomainOptions();
  renderList();
}

chrome.storage.local.get([THEME_KEY, PREFS_KEY, LEGACY_JWT_KEY]).then((res) => {
  const stored = res?.[THEME_KEY];
  if (stored === "light" || stored === "dark") {
    currentTheme = stored;
    applyTheme(currentTheme);
  }
  const p = res?.[PREFS_KEY] || {};
  if (res?.[LEGACY_JWT_KEY] === true && p.decodeJwt === undefined) p.decodeJwt = true;
  applyPrefs(p);
}).catch(() => {});

els.themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  applyTheme(currentTheme);
  chrome.storage.local.set({ [THEME_KEY]: currentTheme }).catch(() => {});
});

els.decodeJwtToggle.addEventListener("change", () => {
  state.decodeJwt = els.decodeJwtToggle.checked;
  savePrefs();
  renderList();
});
els.searchBodies.addEventListener("change", () => {
  state.searchBodies = els.searchBodies.checked;
  savePrefs();
  renderList();
});
els.flagSecrets.addEventListener("change", () => {
  state.flagSecrets = els.flagSecrets.checked;
  savePrefs();
  renderList();
});
els.redactHar.addEventListener("change", () => {
  state.redactHar = els.redactHar.checked;
  savePrefs();
});
els.showSize.addEventListener("change", () => {
  state.showSize = els.showSize.checked;
  els.list.classList.toggle("show-size", state.showSize);
  savePrefs();
  renderList();
});
els.showWaterfall.addEventListener("change", () => {
  state.showWaterfall = els.showWaterfall.checked;
  els.list.classList.toggle("show-waterfall", state.showWaterfall);
  savePrefs();
  renderList();
});
els.groupByDomain.addEventListener("change", () => {
  state.groupByDomain = els.groupByDomain.checked;
  savePrefs();
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
  draft = { params, body: wireBody(e.requestBody) };
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
      renderList(e.id);
    } else if (kind === "param-add") {
      draft.params.push({ key: "", value: "", enabled: true });
      renderList(e.id);
    } else if (kind === "param-remove") {
      const i = +t.dataset.i;
      draft.params.splice(i, 1);
      renderList(e.id);
    } else if (kind === "body-pretty") {
      const pretty = tryPrettyJson(draft.body);
      if (pretty) { draft.body = pretty; renderList(e.id); }
    } else if (kind === "send") {
      if (!confirmImportedReplay(e)) return;
      state.replays.set(e.id, { pending: true });
      renderList(e.id);
      const url = composeUrlFromDraft(e, draft);
      const result = await replay(e, { url, body: draft.body });
      state.replays.set(e.id, result);
      renderList(e.id);
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

const SENSITIVE_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "set-cookie",
  "x-api-key", "api-key", "x-auth-token", "auth-token", "x-access-token",
  "x-session-token", "x-csrf-token", "x-xsrf-token", "x-secret"
]);

// For a Set-Cookie value, return the recommended flags it is missing.
function cookieSecurityWarnings(rawValue) {
  const v = rawValue.toLowerCase();
  const missing = [];
  if (!/;\s*secure/.test(v)) missing.push("Secure");
  if (!/;\s*httponly/.test(v)) missing.push("HttpOnly");
  return missing;
}

function headerBadges(lower, value) {
  if (!state.flagSecrets) return "";
  let out = "";
  if (SENSITIVE_HEADERS.has(lower)) {
    out += `<span class="secret-badge" title="Sensitive header — avoid sharing">${icon("shield")}secret</span>`;
  }
  if (lower === "set-cookie" && value) {
    const missing = cookieSecurityWarnings(value);
    if (missing.length) {
      out += `<span class="secret-badge warn" title="Cookie missing recommended flags">⚠ ${escapeHtml(missing.join(", "))}</span>`;
    }
  }
  return out;
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
    return `<dt>${escapeHtml(name)}${headerBadges(lower, value)}</dt>${dd}`;
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
    : e.responseBody.omitted
      ? section("Response body", "", `<div class="kv-empty">Not captured — ${escapeHtml(e.responseBody.omitted)}</div>`)
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
      <button class="mini" data-action="copy-powershell">${icon("copy")}<span>PowerShell</span></button>
      <button class="mini" data-action="copy-node">${icon("copy")}<span>node</span></button>
      <button class="mini" data-action="replay">${icon("play")}<span>Replay</span></button>
      <button class="mini ${editorOpen ? "active" : ""}" data-action="replay-with">${icon("pencil")}<span>Replay with…</span></button>
      <button class="mini ${state.diffSelection.includes(e.id) ? "active" : ""}" data-action="diff">${icon("diff")}<span>${state.diffSelection.includes(e.id) ? "Selected" : "Diff"}</span></button>
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
  wrap.querySelector('[data-action="copy-powershell"]').addEventListener("click", (ev) => {
    copyText(buildPowerShell(e), ev.currentTarget);
  });
  wrap.querySelector('[data-action="copy-node"]').addEventListener("click", (ev) => {
    copyText(buildNodeFetch(e), ev.currentTarget);
  });
  wrap.querySelector('[data-action="diff"]').addEventListener("click", () => {
    toggleDiffSelection(e.id);
  });
  wrap.querySelector('[data-action="replay"]').addEventListener("click", async () => {
    if (!confirmImportedReplay(e)) return;
    state.replays.set(e.id, { pending: true });
    renderList(e.id);
    const result = await replay(e);
    state.replays.set(e.id, result);
    renderList(e.id);
  });
  wrap.querySelector('[data-action="replay-with"]').addEventListener("click", () => {
    if (state.replayWithOpen.has(e.id)) state.replayWithOpen.delete(e.id);
    else state.replayWithOpen.add(e.id);
    renderList(e.id);
  });
  const decodeBtn = wrap.querySelector('[data-action="toggle-base64-decode"]');
  if (decodeBtn) {
    decodeBtn.addEventListener("click", () => {
      if (state.decodedBase64.has(e.id)) state.decodedBase64.delete(e.id);
      else state.decodedBase64.add(e.id);
      renderList(e.id);
    });
  }
  const editor = wrap.querySelector(".rw-section");
  if (editor) attachReplayEditorHandlers(editor, e);
  for (const btn of wrap.querySelectorAll("button.mini[data-copy]")) {
    // Take ownership of the text: the row may be reused across renders.
    const id = btn.getAttribute("data-copy");
    const text = sectionTexts.get(id) || "";
    sectionTexts.delete(id);
    btn.addEventListener("click", (ev) => copyText(text, ev.currentTarget));
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

function responseSize(e) {
  const cl = getHeader(e.responseHeaders, "content-length");
  if (cl) {
    const n = Number(cl);
    if (!Number.isNaN(n)) return n;
  }
  if (e.responseBody?.text != null) {
    return e.responseBody.base64Encoded
      ? Math.floor(e.responseBody.text.length * 0.75) // ~decoded byte size
      : e.responseBody.text.length;
  }
  return null;
}

function formatBytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Set by renderList() before rows are built, so the waterfall bars share a scale.
let renderMaxDur = 1;

function waterfallHtml(e) {
  if (e.duration == null) return `<span class="wf"></span>`;
  const total = e.duration;
  const barPct = Math.max(2, Math.min(100, Math.round((total / (renderMaxDur || 1)) * 100)));
  const wait = (e.headersReceivedAt && e.startedAt) ? Math.max(0, e.headersReceivedAt - e.startedAt) : 0;
  const waitPct = total > 0 ? Math.min(100, Math.round((wait / total) * 100)) : 0;
  return `<span class="wf" title="${total}ms (TTFB ${Math.round(wait)}ms)">` +
    `<span class="wf-bar" style="width:${barPct}%">` +
    `<span class="wf-wait" style="width:${waitPct}%"></span></span></span>`;
}

function entryRow(e) {
  const li = document.createElement("li");
  const isExpanded = state.expandedIds.has(e.id);
  const isSlow = e.duration != null && e.duration >= state.slowThreshold;
  const isStarred = state.starred.has(e.id);
  const isError = e.state === "error" || (e.status != null && e.status >= 400);
  const isDiffSel = state.diffSelection.includes(e.id);
  li.className = "entry"
    + (isExpanded ? " expanded" : "")
    + (isError ? " error" : "")
    + (isSlow ? " slow" : "")
    + (isStarred ? " starred" : "")
    + (isDiffSel ? " diff-selected" : "");
  li.dataset.id = e.id;

  const sb = statusBucket(e);
  const statusText = e.state === "error" ? "ERR"
    : e.status != null ? e.status
    : "···";
  const op = gqlOp(e);
  const wfCell = state.showWaterfall ? waterfallHtml(e) : "";
  const sizeCell = state.showSize ? `<span class="size">${escapeHtml(formatBytes(responseSize(e)))}</span>` : "";

  const main = document.createElement("div");
  main.className = "row-main";
  main.tabIndex = 0;
  main.setAttribute("role", "button");
  main.setAttribute("aria-expanded", String(isExpanded));
  main.setAttribute("aria-label", `${e.method} ${e.url} — ${statusText}`);
  main.innerHTML = `
    <span class="caret">${icon(isExpanded ? "chevron-down" : "chevron-right")}</span>
    <span class="star" role="button" tabindex="0" aria-pressed="${isStarred}" aria-label="Star (kept across Clear)" title="Star (kept across Clear)">${icon(isStarred ? "star-filled" : "star-empty")}</span>
    <span class="method ${escapeHtml(e.method)}" data-tip-method="${escapeHtml(e.method)}">${escapeHtml(e.method)}</span>
    <span class="status ${sb ? "s" + sb : ""}" data-tip-status="${escapeHtml(e.id)}">${escapeHtml(statusText)}</span>
    <span class="url" title="${escapeHtml(e.url)}">${fmtUrl(e.url)}${op ? `<span class="gql-op">${escapeHtml(op)}</span>` : ""}</span>
    ${wfCell}
    ${sizeCell}
    <span class="duration">${e.duration != null ? e.duration + "ms" : ""}</span>
  `;

  main.addEventListener("click", (ev) => {
    if (ev.target.closest(".url") || ev.target.closest(".star")) return;
    if (state.expandedIds.has(e.id)) state.expandedIds.delete(e.id);
    else state.expandedIds.add(e.id);
    renderList(e.id);
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
  main.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    if (ev.target.closest(".star")) safePost({ type: "toggleStar", id: e.id });
    else main.click();
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

// Rows are cached and only rebuilt when their entry changed (dirtyIds) or when
// something affecting every row changed (filters, toggles, stars…): any call
// without an id. On a busy page this avoids rebuilding 2000 rows — and any
// expanded JSON tree — on every network event.
const rowCache = new Map();
let diffCache = null; // { ids, li }
const dirtyIds = new Set();
let fullRenderPending = true;

let renderScheduled = false;
function renderList(changedId, retry = false) {
  if (changedId != null) dirtyIds.add(changedId);
  else if (!retry) fullRenderPending = true;
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
      setTimeout(() => { renderScheduled = false; renderList(null, true); }, 500);
      return;
    }
    sectionTexts.clear();
    const matcher = makeMatcher();
    const visible = state.entries.filter(matcher);
    const maxDur = visible.reduce((m, e) => (e.duration != null && e.duration > m ? e.duration : m), 1);
    // Waterfall bars share a scale: a new maximum changes every row.
    if (state.showWaterfall && maxDur !== renderMaxDur) fullRenderPending = true;
    renderMaxDur = maxDur;
    if (fullRenderPending) {
      rowCache.clear();
      diffCache = null;
    } else {
      for (const id of dirtyIds) rowCache.delete(id);
      if (diffCache && diffCache.ids.some((id) => dirtyIds.has(id))) diffCache = null;
    }
    fullRenderPending = false;
    dirtyIds.clear();
    const wasAtBottom =
      els.list.scrollTop + els.list.clientHeight >= els.list.scrollHeight - 20;
    // Emptying the list blurs whatever row had keyboard focus, even when the
    // same (cached) node is put back: remember it and restore it afterwards.
    const focus = focusedListTarget();
    els.list.innerHTML = "";

    const diffPanel = renderDiffPanel();
    if (diffPanel) els.list.appendChild(diffPanel);

    if (visible.length === 0) {
      els.list.appendChild(renderEmptyState(state.entries.length === 0));
    } else if (state.groupByDomain) {
      els.list.appendChild(renderGrouped(visible));
      if (wasAtBottom && state.expandedIds.size === 0) els.list.scrollTop = els.list.scrollHeight;
    } else {
      const frag = document.createDocumentFragment();
      for (const e of visible) frag.appendChild(cachedRow(e));
      els.list.appendChild(frag);
      if (wasAtBottom && state.expandedIds.size === 0) {
        els.list.scrollTop = els.list.scrollHeight;
      }
    }
    if (focus) restoreListFocus(focus);
    els.counts.textContent =
      `${visible.length} shown · ${state.entries.length} captured · ${state.starred.size} starred` +
      (state.dropped ? ` · ${state.dropped} dropped` : "") +
      (state.paused ? " · PAUSED" : "");
    updateDiffButton();
  });
}

function focusedListTarget() {
  const a = document.activeElement;
  if (!a || !els.list.contains(a)) return null;
  if (a.classList.contains("group-header")) return { host: a.dataset.host };
  const li = a.closest(".entry");
  if (!li) return null;
  if (a.classList.contains("star")) return { id: li.dataset.id, sel: ".star" };
  if (a.classList.contains("row-main")) return { id: li.dataset.id, sel: ".row-main" };
  return null; // focus inside a detail panel: cached node, left alone
}

function restoreListFocus(f) {
  let el = null;
  if (f.host != null) {
    el = [...els.list.querySelectorAll(".group-header")].find((h) => h.dataset.host === f.host);
  } else {
    const li = [...els.list.querySelectorAll(".entry")].find((x) => x.dataset.id === f.id);
    el = li?.querySelector(f.sel);
  }
  el?.focus({ preventScroll: true });
}

function cachedRow(e) {
  let li = rowCache.get(e.id);
  if (!li) {
    li = entryRow(e);
    rowCache.set(e.id, li);
  }
  return li;
}

function renderGrouped(visible) {
  const frag = document.createDocumentFragment();
  const groups = new Map();
  for (const e of visible) {
    const h = tryHost(e.url) || "(no host)";
    if (!groups.has(h)) groups.set(h, []);
    groups.get(h).push(e);
  }
  for (const [host, entries] of groups) {
    const collapsed = state.collapsedHosts.has(host);
    const header = document.createElement("li");
    header.className = "group-header" + (collapsed ? " collapsed" : "");
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", String(!collapsed));
    header.dataset.host = host;
    header.innerHTML =
      `<span class="group-caret">${icon(collapsed ? "chevron-right" : "chevron-down")}</span>` +
      `<span class="group-host">${escapeHtml(host)}</span>` +
      `<span class="group-count">${entries.length}</span>`;
    header.addEventListener("click", () => {
      if (state.collapsedHosts.has(host)) state.collapsedHosts.delete(host);
      else state.collapsedHosts.add(host);
      renderList();
    });
    header.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      header.click();
    });
    frag.appendChild(header);
    if (!collapsed) for (const e of entries) frag.appendChild(cachedRow(e));
  }
  return frag;
}

// ─── diff of two selected requests ─────────────────────────────────────────

function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  // LCS is O(n*m) in space — fall back to a naive block diff for huge inputs.
  if (n > 1500 || m > 1500) {
    return [...A.map((s) => ({ t: "del", s })), ...B.map((s) => ({ t: "add", s }))];
  }
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "eq", s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", s: A[i] }); i++; }
    else { out.push({ t: "add", s: B[j] }); j++; }
  }
  while (i < n) out.push({ t: "del", s: A[i++] });
  while (j < m) out.push({ t: "add", s: B[j++] });
  return out;
}

function diffBlockHtml(title, aText, bText) {
  if ((aText || "") === (bText || "")) {
    return `<div class="diff-block"><div class="diff-title">${escapeHtml(title)} <span class="diff-same">identical</span></div></div>`;
  }
  const rows = lineDiff(aText || "", bText || "");
  const body = rows.map((r) => {
    const sign = r.t === "add" ? "+" : r.t === "del" ? "−" : " ";
    return `<div class="diff-line ${r.t}">${sign} ${escapeHtml(r.s)}</div>`;
  }).join("");
  return `<div class="diff-block"><div class="diff-title">${escapeHtml(title)}</div><div class="diff-lines">${body}</div></div>`;
}

function entryHeadersText(headers) {
  return (headers || []).map((h) => `${h.name}: ${h.value ?? ""}`).join("\n");
}

function entryBodyPretty(e, which) {
  const raw = which === "req" ? bodyToText(e.requestBody) : (e.responseBody?.text || "");
  return tryPrettyJson(raw) || raw;
}

function shortUrl(url) {
  try { const u = new URL(url); return u.host + u.pathname; } catch { return url; }
}

function renderDiffPanel() {
  // Drop any selected ids that no longer exist (cleared/re-imported).
  state.diffSelection = state.diffSelection.filter((id) => state.byId.has(id));
  if (state.diffSelection.length !== 2) return null;
  if (diffCache && diffCache.ids.join() === state.diffSelection.join()) return diffCache.li;
  const [a, b] = state.diffSelection.map((id) => state.byId.get(id));
  const li = document.createElement("li");
  li.className = "diff-panel";
  li.innerHTML = `
    <div class="diff-head">
      <span class="diff-head-title">${icon("diff")}Diff</span>
      <span class="diff-legend"><b class="diff-a">A</b> ${escapeHtml(a.method)} ${escapeHtml(shortUrl(a.url))} &nbsp;·&nbsp; <b class="diff-b">B</b> ${escapeHtml(b.method)} ${escapeHtml(shortUrl(b.url))}</span>
      <button class="mini diff-close" title="Close diff">${icon("close")}</button>
    </div>
    <div class="diff-body">
      ${diffBlockHtml("Status", `${a.method} ${a.status ?? a.state}`, `${b.method} ${b.status ?? b.state}`)}
      ${diffBlockHtml("URL", a.url, b.url)}
      ${diffBlockHtml("Request headers", entryHeadersText(a.requestHeaders), entryHeadersText(b.requestHeaders))}
      ${diffBlockHtml("Response headers", entryHeadersText(a.responseHeaders), entryHeadersText(b.responseHeaders))}
      ${diffBlockHtml("Request body", entryBodyPretty(a, "req"), entryBodyPretty(b, "req"))}
      ${diffBlockHtml("Response body", entryBodyPretty(a, "resp"), entryBodyPretty(b, "resp"))}
    </div>`;
  li.querySelector(".diff-close").addEventListener("click", () => {
    state.diffSelection = [];
    renderList();
  });
  diffCache = { ids: [...state.diffSelection], li };
  return li;
}

function trackHost(e) {
  const h = tryHost(e.url);
  if (h && !state.knownHosts.has(h)) {
    state.knownHosts.add(h);
    refreshDomainOptions();
  }
}

function removeEntries(ids) {
  const gone = new Set(ids);
  state.entries = state.entries.filter((e) => !gone.has(e.id));
  for (const id of gone) {
    state.byId.delete(id);
    rowCache.delete(id);
    state.expandedIds.delete(id);
    state.replays.delete(id);
    state.replayWithOpen.delete(id);
    state.replayDrafts.delete(id);
    state.decodedBase64.delete(id);
  }
  // No render here: the caller's upsert() renders right after, and evicted
  // rows simply drop out of the visible list.
}

function upsert(entry) {
  const existing = state.byId.get(entry.id);
  if (existing) Object.assign(existing, entry);
  else {
    state.byId.set(entry.id, entry);
    state.entries.push(entry);
    trackHost(entry);
  }
  renderList(entry.id);
}

// ─── port ────────────────────────────────────────────────────────────────
// The background service worker is shut down after ~30s of inactivity in MV3.
// When that happens, our port is invalidated. We reconnect right away: the
// connect wakes the worker back up and it answers with a fresh snapshot, so
// the panel keeps receiving live updates.

let port = null;
let reconnectTimer = null;

function handlePortMessage(msg) {
  if (msg.type === "snapshot") {
    state.entries = msg.entries.slice();
    state.byId = new Map(state.entries.map((e) => [e.id, e]));
    state.knownHosts = new Set(state.entries.map((e) => tryHost(e.url)).filter(Boolean));
    state.starred = new Set(msg.starred || []);
    state.paused = msg.paused;
    state.scope = msg.scope;
    state.captureBodies = !!msg.captureBodies;
    if (typeof msg.dropped === "number") state.dropped = msg.dropped;
    syncControls();
    refreshDomainOptions();
    renderList();
  } else if (msg.type === "add" || msg.type === "update") {
    if (typeof msg.dropped === "number") state.dropped = msg.dropped;
    if (msg.evicted?.length) removeEntries(msg.evicted);
    upsert(msg.entry);
  } else if (msg.type === "cleared") {
    if (typeof msg.dropped === "number") state.dropped = msg.dropped;
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
  port.onDisconnect.addListener(() => {
    port = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { if (!port) connectPort(); }, 250);
  });
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
  savePrefs();
  renderList();
});
els.urlFilterClear.addEventListener("click", () => {
  els.urlFilter.value = "";
  state.urlFilter = "";
  els.urlFilterClear.hidden = true;
  els.urlFilter.focus();
  savePrefs();
  renderList();
});
els.statusFilter.addEventListener("change", () => {
  state.statusFilter = els.statusFilter.value;
  savePrefs();
  renderList();
});
els.domainFilter.addEventListener("change", () => {
  state.domainFilter = els.domainFilter.value;
  savePrefs();
  renderList();
});
els.starredOnly.addEventListener("change", () => {
  state.starredOnly = els.starredOnly.checked;
  savePrefs();
  renderList();
});
els.slowThreshold.addEventListener("input", () => {
  state.slowThreshold = Number(els.slowThreshold.value) || 0;
  savePrefs();
  renderList();
});
els.captureBodies.addEventListener("change", async () => {
  const want = els.captureBodies.checked;
  if (want) {
    // `debugger` is optional: ask for it on first use. Must run directly in the
    // user gesture, before any other await.
    let granted = false;
    try { granted = await chrome.permissions.request({ permissions: ["debugger"] }); } catch {}
    if (!granted) {
      els.captureBodies.checked = false;
      return;
    }
  }
  safePost({ type: "setCaptureBodies", value: want });
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

// ─── HAR import ──────────────────────────────────────────────────────────

function flashImport(msg) {
  els.importHar.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  setTimeout(() => {
    els.importHar.innerHTML = `${icon("upload")}<span>Import</span>`;
  }, 1400);
}

els.importHar.addEventListener("click", () => els.harFileInput.click());
els.harFileInput.addEventListener("change", async () => {
  const file = els.harFileInput.files?.[0];
  els.harFileInput.value = ""; // let the same file be re-imported later
  if (!file) return;
  try {
    const har = JSON.parse(await file.text());
    const entries = harToEntries(har, Date.now());
    if (!entries.length) { flashImport("Empty HAR"); return; }
    // Make imported resource types visible even if their chip was off.
    for (const e of entries) state.types.add(e.type);
    renderChips(els.typeChips, TYPES, state.types);
    savePrefs();
    safePost({ type: "importEntries", entries });
    flashImport(`+${entries.length} imported`);
  } catch (err) {
    console.warn("sidewire: HAR import failed", err);
    flashImport("Invalid HAR");
  }
});

// ─── diff selection ──────────────────────────────────────────────────────

function toggleDiffSelection(id) {
  const idx = state.diffSelection.indexOf(id);
  if (idx !== -1) state.diffSelection.splice(idx, 1);
  else {
    state.diffSelection.push(id);
    if (state.diffSelection.length > 2) state.diffSelection.shift();
  }
  renderList();
}

function updateDiffButton() {
  const n = state.diffSelection.length;
  els.diffBtn.hidden = n === 0;
  els.diffBtn.innerHTML = `${icon("diff")}<span>Diff ${n}/2</span>`;
  els.diffBtn.classList.toggle("active", n === 2);
}

els.diffBtn.addEventListener("click", () => {
  if (state.diffSelection.length === 2) return; // panel already shown
  state.diffSelection = [];
  renderList();
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
      els.urlFilterClear.hidden = true;
      savePrefs();
      renderList();
      els.urlFilter.blur();
    }
  } else if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && ev.target.matches(".row-main, .group-header")) {
    // Move between rows (and group headers) with the arrow keys.
    ev.preventDefault();
    const items = [...els.list.querySelectorAll(".row-main, .group-header")];
    const i = items.indexOf(ev.target);
    const next = items[i + (ev.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      next.focus();
      next.scrollIntoView({ block: "nearest" });
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
