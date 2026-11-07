// ---- Endora Console's own part ------------------------------------------------------------
//
// Every other file in this folder is Endora's console, copied unchanged (see SOURCE.md); until
// the cutover, screen changes land in Endora and are copied here. This file is Console's own,
// and it is the only place Console differs:
//
//   1. `api` is the one way a screen reaches Core. Two of the old screens' calls are carried
//      onto the contract (Endora's docs/api/console-v1.md): an answer to a desk item goes to
//      `/v1/decisions/{id}`, which binds it, applies it once and keeps its stages; HQ's event
//      poll goes to `/v1/events`, which says when events were pruned.
//   2. `subscribeToActivity` listens to `/v1/events/stream` with a fetch signed in the header
//      (never a token in the URL), resumes with `Last-Event-ID`, and drops an event it has
//      already applied.
//   3. Each answer's stages (requested, accepted, executed, verified) show separately in a
//      tray, kept from Core's record, so a dropped connection never leaves "did it work?".
//   4. Speakers are Endora Audio's own page: here they show its status and a link, from Audio's
//      own health check. The Spotify player waits on the owner's decision (Endora ADR 0145).
//
// Function declarations: in one joined script the last declaration of a name is the one used,
// so these replace the copies above without editing them.

const CONSOLE = {
  decisions: [],      // the latest answers this browser has seen, newest first
  keys: {},           // one request key per item and choice, so a second press is the same request
  lastEvent: 0,       // the last stream event applied: the stream resumes after it
  backoff: 1000,
  refreshTimer: null,
  audio: null,
  closed: false,      // set when the page stops listening
};

function consoleRequestKey(id, choice) {
  const k = `${id}:${choice}`;
  if (!CONSOLE.keys[k]) {
    CONSOLE.keys[k] = "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  return CONSOLE.keys[k];
}

// Where an old screen's call goes under the contract.
function consoleRoute(method, path, body) {
  const desk = method === "POST" && /^\/v1\/hq\/desk\/(\d+)$/.exec(path);
  if (desk) {
    const id = Number(desk[1]);
    const choice = (body && body.decision) || "";
    return {
      path: `/v1/decisions/${id}`,
      body: { choice, words: (body && body.answer) || "", request: consoleRequestKey(id, choice), channel: "console" },
      decision: { id, choice },
    };
  }
  const events = method === "GET" && /^\/v1\/hq\/events(\?[^#]*)?$/.exec(path);
  if (events) return { path: "/v1/events" + (events[1] || ""), body };
  return { path, body };
}

async function api(method, path, body) {
  const route = consoleRoute(method, path, body);
  if (route.decision) consoleDecisionSent(route.decision);
  const headers = signed(route.body !== undefined ? { "content-type": "application/json" } : {});
  const res = await fetch(route.path, {
    method,
    headers,
    body: route.body !== undefined ? JSON.stringify(route.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (res.status === 401) { NEEDS_TOKEN = true; render(); throw new Error("unauthorized"); }
  if (route.decision) consoleDecisionAnswered(route.decision, res.status, data);
  if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
  NEEDS_TOKEN = false;
  return data;
}

// ---- each answer's stages --------------------------------------------------------------------

function consoleDecisionSent(d) {
  CONSOLE.decisions = [{ id: d.id, choice: d.choice, sending: true, record: null, error: "" },
    ...CONSOLE.decisions.filter((x) => x.id !== d.id)].slice(0, 5);
  consoleTray();
}

function consoleDecisionAnswered(d, status, data) {
  const entry = CONSOLE.decisions.find((x) => x.id === d.id) || { id: d.id, choice: d.choice };
  entry.sending = false;
  entry.record = (data && data.decision) || entry.record || null;
  entry.error = status >= 400 ? ((data && data.error) || ("HTTP " + status)) : "";
  entry.duplicate = !!(data && data.duplicate);
  CONSOLE.decisions = [entry, ...CONSOLE.decisions.filter((x) => x.id !== d.id)].slice(0, 5);
  consoleTray();
}

// The four stages of one answer, each said on its own: never one "done".
function consoleStages(entry) {
  const s = (entry.record && entry.record.stages) || {};
  const mark = (stage, words) => {
    if (!stage) return `<span class="console-stage wait">${words}…</span>`;
    if (stage.ok === false) return `<span class="console-stage bad" title="${esc(stage.said || stage.how || "")}">${words} ✗</span>`;
    return `<span class="console-stage ok" title="${esc(stage.said || stage.how || "")}">${words} ✓</span>`;
  };
  const requested = entry.sending ? `<span class="console-stage wait">Requested…</span>` : mark(s.requested, "Requested");
  return requested + mark(s.accepted, "Accepted") + mark(s.executed, "Executed") + mark(s.verified, "Verified");
}

function consoleTrayHtml() {
  if (!CONSOLE.decisions.length) return "";
  const rows = CONSOLE.decisions.map((e) => `
    <div class="console-decision">
      <div><b>#${Number(e.id)}</b> ${esc(e.choice)}${e.duplicate ? ` <span class="sub">(already answered)</span>` : ""}</div>
      <div class="console-stages">${consoleStages(e)}</div>
      ${e.error ? `<div class="console-error">${esc(e.error)}</div>` : ""}
    </div>`).join("");
  return `<div class="console-tray-head"><span>Your answers</span>
      <button class="ghost" data-act="console:tray:clear" aria-label="Clear">✕</button></div>${rows}`;
}

function consoleTray() {
  if (typeof document === "undefined" || !document.body) return;
  let tray = document.getElementById("console-tray");
  if (!tray || !tray.setAttribute || tray.id !== "console-tray") {
    tray = document.createElement("aside");
    tray.id = "console-tray";
    tray.className = "console-tray";
    tray.setAttribute("aria-live", "polite");
    document.body.appendChild(tray);
    consoleStyle();
  }
  tray.innerHTML = consoleTrayHtml();
  tray.hidden = !CONSOLE.decisions.length;
}

function consoleStyle() {
  if (document.getElementById("console-style") && document.getElementById("console-style").id === "console-style") return;
  const style = document.createElement("style");
  style.id = "console-style";
  style.textContent = `
    .console-tray{position:fixed;right:12px;bottom:12px;max-width:min(360px,calc(100vw - 24px));z-index:50;
      background:var(--card,#1b1f24);color:inherit;border:1px solid var(--line,#333);border-radius:10px;padding:10px 12px;font-size:13px}
    .console-tray-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600}
    .console-decision{padding:6px 0;border-top:1px solid var(--line,#333)}
    .console-stages{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
    .console-stage{padding:1px 6px;border-radius:999px;border:1px solid currentColor;opacity:.9}
    .console-stage.wait{opacity:.55}.console-stage.bad{color:#e07070}.console-stage.ok{color:#6fc28b}
    .console-error{color:#e07070;margin-top:4px}`;
  document.body.appendChild(style);
}

// What was answered in the last ten minutes, from Core's record: the tray survives a reload.
async function consoleLoadDecisions() {
  try {
    const got = await api("GET", "/v1/decisions");
    const since = Date.now() - 10 * 60 * 1000;
    const recent = ((got && got.answered) || [])
      .filter((r) => r.stages && r.stages.requested && r.stages.requested.at >= since)
      .slice(0, 5)
      .map((r) => ({ id: r.id, choice: r.choice, sending: false, record: r, error: "" }));
    if (recent.length) { CONSOLE.decisions = recent; consoleTray(); }
  } catch (_) { /* Core not set up yet, or signed out: nothing to show */ }
}

// ---- one event stream ------------------------------------------------------------------------

function consoleParse(block) {
  const e = { event: "message", id: null, data: "" };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const at = line.indexOf(":");
    const field = at < 0 ? line : line.slice(0, at);
    const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
    if (field === "event") e.event = value;
    else if (field === "id") e.id = value;
    else if (field === "data") e.data += (e.data ? "\n" : "") + value;
  }
  return e;
}

// Applies one stream event; true if it was new. An event at or below the last applied id is
// a reconnect's catch-up of something already seen, and is dropped.
function consoleEvent(e) {
  if (e.event === "hq") {
    const id = Number(e.id);
    if (!Number.isFinite(id) || id <= CONSOLE.lastEvent) return false;
    CONSOLE.lastEvent = id;
    consoleRefresh(false);
    return true;
  }
  if (e.event === "changed") { consoleRefresh(false); return true; }
  if (e.event === "gap") { consoleRefresh(true); return true; }
  return false;
}

// A refresh never yanks unsaved work out from under the person (as the old feed's did not);
// a gap always reloads, since the screen's picture is known to be incomplete.
function consoleRefresh(force) {
  clearTimeout(CONSOLE.refreshTimer);
  CONSOLE.refreshTimer = setTimeout(() => {
    if (!force) {
      if (NAV.v === "settings" || NAV.v === "models") return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    }
    reload().catch(() => {});
  }, 300);
}

function subscribeToActivity() {
  consoleLoadDecisions();
  consoleStream().catch(() => {});
}

async function consoleStream() {
  while (!CONSOLE.closed) {
    try {
      if (!CONSOLE.lastEvent && HQ && HQ.last) CONSOLE.lastEvent = HQ.last;
      const headers = signed({ accept: "text/event-stream" });
      if (CONSOLE.lastEvent) headers["last-event-id"] = String(CONSOLE.lastEvent);
      const res = await fetch("/v1/events/stream", { headers, cache: "no-store" });
      if (res.status === 401) { NEEDS_TOKEN = true; render(); return; }
      if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
      CONSOLE.backoff = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          consoleEvent(consoleParse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 2);
        }
      }
    } catch (_) { /* reconnect below */ }
    await new Promise((r) => setTimeout(r, CONSOLE.backoff));
    CONSOLE.backoff = Math.min(CONSOLE.backoff * 2, 30000);
  }
}

// ---- Audio ----------------------------------------------------------------------------------
// Speakers are Endora Audio's own page. Music (the Spotify player) needs the Spotify token,
// which moves to Audio, and Audio's page has no player yet: that destination is the owner's
// decision (Endora ADR 0145), so Music shows Audio's status and says so. The home lab, media and
// smart home screens (45-lab.js) are Console's, through the contract's home area.

async function loadSound() {
  try {
    const res = await fetch("/console/audio", { cache: "no-store" });
    CONSOLE.audio = await res.json();
  } catch (_) {
    CONSOLE.audio = { configured: false, ok: false, link: "" };
  }
}

async function loadMusic() { await loadSound(); }

function consoleAudioCard(title, more) {
  const a = CONSOLE.audio;
  const said = !a ? "Asking Endora Audio…"
    : !a.configured ? "Endora Audio is not connected to this Console."
      : a.ok ? "Endora Audio is running." : `Endora Audio is not answering${a.error ? `: ${esc(a.error)}` : ""}.`;
  const link = a && a.link
    ? `<div class="row" style="margin-top:8px"><a class="primary" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Open Endora Audio</a></div>`
    : "";
  return `${crumbs([{ label: "HQ", act: "go:hq" }, { label: title }])}
    <div class="card"><div class="title">${esc(title)}</div>
      <div class="note">${said} ${more}</div>${link}</div>`;
}

function viewSound() { return consoleAudioCard("Speakers", "Speakers are Endora Audio's own page."); }
function viewMusic() {
  return consoleAudioCard("Music", "The Spotify player is not in Endora Console yet: where it goes is waiting on a decision. Endora's receiver still shows in the Spotify app as a device to play on.");
}

// The player's calls are Audio's (the Spotify token moves there); none is made from Console.
async function musicDispatch() { flash("The Spotify player is not in Endora Console yet.", "warn"); }
async function spotify() { throw new Error("The Spotify player is not in Endora Console yet."); }
async function spotifyToken() { throw new Error("The Spotify player is not in Endora Console yet."); }

async function soundDispatch(verb, noun) {
  if (verb === "console" && noun === "tray") { CONSOLE.decisions = []; consoleTray(); return true; }
  return false;
}
