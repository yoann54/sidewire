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
  methods: new Set(METHODS),
  types: new Set(DEFAULT_TYPES),
  replays: new Map(),
  replayWithOpen: new Set(),
  replayDrafts: new Map()
};

const els = {
  list: document.getElementById("list"),
  pause: document.getElementById("pause"),
  clear: document.getElementById("clear"),
  copyAll: document.getElementById("copyAll"),
  exportHar: document.getElementById("exportHar"),
  scope: document.getElementById("scope"),
  urlFilter: document.getElementById("urlFilter"),
  statusFilter: document.getElementById("statusFilter"),
  domainFilter: document.getElementById("domainFilter"),
  starredOnly: document.getElementById("starredOnly"),
  slowThreshold: document.getElementById("slowThreshold"),
  captureBodies: document.getElementById("captureBodies"),
  methodChips: document.getElementById("methodChips"),
  typeChips: document.getElementById("typeChips"),
  counts: document.getElementById("counts")
};

// ─── utilities ───────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
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
      creator: { name: "Sidewire", version: "0.2.0" },
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

function renderChips(container, values, selected) {
  container.innerHTML = "";
  for (const v of values) {
    const el = document.createElement("span");
    el.className = "chip" + (selected.has(v) ? " on" : "");
    el.textContent = v;
    el.addEventListener("click", () => {
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      el.classList.toggle("on");
      renderList();
    });
    container.appendChild(el);
  }
}
renderChips(els.methodChips, METHODS, state.methods);
renderChips(els.typeChips, TYPES, state.types);

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
        <button class="mini" data-rw="param-remove" data-i="${i}" title="Remove">×</button>
      </div>`).join("");

  const bodySection = hasBody ? `
    <div class="rw-subhead">
      <span>Body</span>
      <button class="mini" data-rw="body-pretty" title="Pretty-print JSON">Pretty</button>
    </div>
    <textarea class="rw-body" data-rw="body" rows="8" spellcheck="false">${escapeHtml(draft.body)}</textarea>
    <div class="rw-note">Body sent as raw text. Adjust Content-Type if needed.</div>
  ` : "";

  return `
    <section class="detail-section rw-section">
      <header>
        <span>Replay with…</span>
        <button class="mini" data-rw="close" title="Close">✕</button>
      </header>
      <div class="detail-body">
        <div class="rw-subhead"><span>Query parameters</span></div>
        <div class="rw-params">${paramsHtml}</div>
        <button class="mini" data-rw="param-add">+ Add</button>
        ${bodySection}
        <div class="rw-send-row">
          <button class="mini rw-send" data-rw="send">▶ Send</button>
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

let sectionUid = 0;
const sectionTexts = new Map();

function section(title, copyValue, contentHtml) {
  const id = `sec-${++sectionUid}`;
  if (copyValue) sectionTexts.set(id, copyValue);
  const copyBtn = copyValue ? `<button class="mini" data-copy="${id}" title="Copy">⧉</button>` : "";
  return `
    <section class="detail-section">
      <header><span>${escapeHtml(title)}</span>${copyBtn}</header>
      <div class="detail-body">${contentHtml}</div>
    </section>`;
}

function fmtBodySection(title, bodyText, headers) {
  if (!bodyText) {
    return section(title, "", `<div class="kv-empty">—</div>`);
  }
  const ct = getHeader(headers, "content-type") || "";
  const isJson = /json|graphql/i.test(ct) || tryPrettyJson(bodyText) !== null;
  const pretty = isJson ? tryPrettyJson(bodyText) : null;
  const display = pretty || bodyText;
  return section(title, display, `<pre class="code">${escapeHtml(display)}</pre>`);
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
      ? section("Response body (base64)", respBodyText, `<pre class="code">${escapeHtml(respBodyText)}</pre>`)
      : fmtBodySection("Response body", respBodyText, e.responseHeaders);

  const replayResult = state.replays.get(e.id);
  const replaySection = replayResult ? renderReplay(replayResult) : "";

  const editorOpen = state.replayWithOpen.has(e.id);
  wrap.innerHTML = `
    <div class="detail-toolbar">
      <button class="mini" data-action="copy-url">Copy URL</button>
      <button class="mini" data-action="copy-curl">Copy as cURL</button>
      <button class="mini" data-action="copy-fetch">Copy as fetch</button>
      <button class="mini" data-action="replay">▶ Replay</button>
      <button class="mini ${editorOpen ? "active" : ""}" data-action="replay-with">✎ Replay with…</button>
    </div>
    ${editorOpen ? buildReplayEditor(e) : ""}
    ${section("URL", e.url, `<div class="code">${escapeHtml(e.url)}</div>`)}
    ${section("Query parameters", queryText, kvList(queryRows))}
    ${section("Request headers", reqHeadersText, kvList((e.requestHeaders || []).map((h) => [h.name, h.value])))}
    ${reqBodySection}
    ${section("Response headers", respHeadersText, kvList((e.responseHeaders || []).map((h) => [h.name, h.value])))}
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
  const editor = wrap.querySelector(".rw-section");
  if (editor) attachReplayEditorHandlers(editor, e);
  for (const btn of wrap.querySelectorAll("button.mini[data-copy]")) {
    btn.addEventListener("click", (ev) => {
      const id = btn.getAttribute("data-copy");
      copyText(sectionTexts.get(id) || "", ev.currentTarget);
    });
  }
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
  const pretty = tryPrettyJson(r.body) || r.body;
  return `<section class="detail-section replay-section">
    <header><span>Replay result · ${r.status} · ${r.duration}ms</span></header>
    <div class="detail-body">
      ${kvList(r.headers.map((h) => [h.name, h.value]))}
      <pre class="code">${escapeHtml(pretty)}</pre>
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
  li.className = "entry"
    + (isExpanded ? " expanded" : "")
    + (isSlow ? " slow" : "")
    + (isStarred ? " starred" : "");
  li.dataset.id = e.id;

  const sb = statusBucket(e);
  const statusText = e.state === "error" ? (e.error || "ERR")
    : e.status != null ? e.status
    : "···";
  const op = gqlOp(e);

  const main = document.createElement("div");
  main.className = "row-main";
  main.innerHTML = `
    <span class="caret">${isExpanded ? "▼" : "▶"}</span>
    <span class="star" title="Star (kept across Clear)">${isStarred ? "★" : "☆"}</span>
    <span class="method ${e.method}">${e.method}</span>
    <span class="status ${sb ? "s" + sb : ""}">${escapeHtml(statusText)}</span>
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
    port.postMessage({ type: "toggleStar", id: e.id });
  });

  li.appendChild(main);
  if (isExpanded) li.appendChild(buildDetail(e));
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
    const frag = document.createDocumentFragment();
    for (const e of visible) frag.appendChild(entryRow(e));
    els.list.appendChild(frag);
    if (wasAtBottom && state.expandedIds.size === 0) {
      els.list.scrollTop = els.list.scrollHeight;
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

const port = chrome.runtime.connect({ name: "sidewire" });
port.onMessage.addListener((msg) => {
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
});

function syncControls() {
  els.pause.textContent = state.paused ? "▶ Resume" : "⏸ Pause";
  els.pause.classList.toggle("active", state.paused);
  els.scope.value = state.scope;
  els.captureBodies.checked = state.captureBodies;
}

// ─── controls ────────────────────────────────────────────────────────────

els.pause.addEventListener("click", () => {
  port.postMessage({ type: "setPaused", value: !state.paused });
});
els.clear.addEventListener("click", () => port.postMessage({ type: "clear" }));
els.scope.addEventListener("change", () => {
  port.postMessage({ type: "setScope", value: els.scope.value });
});
els.urlFilter.addEventListener("input", () => {
  state.urlFilter = els.urlFilter.value;
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
  port.postMessage({ type: "setCaptureBodies", value: els.captureBodies.checked });
});
els.copyAll.addEventListener("click", async () => {
  const urls = state.entries.filter(makeMatcher()).map((e) => e.url).join("\n");
  if (!urls) return;
  await navigator.clipboard.writeText(urls);
  els.copyAll.textContent = "✓ Copied";
  setTimeout(() => (els.copyAll.textContent = "⧉ Copy URLs"), 800);
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
    port.postMessage({ type: "setPaused", value: !state.paused });
  }
});
