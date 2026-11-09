// ---- the home lab, media, smart home and music (plan phase 4) --------------
// What the handheld can do, on the web too: the web console is the full set (ADR 0099). These
// screens read the same typed endpoints the handheld does (`/v1/terminal/*`), and act through
// the same one action route, whose vocabulary the node allowlists. Music borrows Spotify's
// access token from the node, which keeps the sign-in.

// Why a page could not load, in words. The node answers "Home console: <category>".
function labTrouble(e) {
  const category = String((e && e.message) || e).replace(/^Home console:\s*/, "");
  if (category === "unconfigured" || category === "configuration") {
    return "Not set up yet. Add the service under Settings › Connections.";
  }
  if (category === "unavailable" || category === "upstream") return "The service did not answer. Try again in a moment.";
  return "Could not load this: " + category + ".";
}

// One page from the node, kept by name; a failure is kept too, so the screen can say why.
async function labLoad(name, path) {
  try { LAB[name] = await api("GET", path); } catch (e) { LAB[name] = { error: labTrouble(e) }; }
}

// Everything these screens fetch, by screen. Called when one opens and on a reload while it shows.
async function loadLab(v, id) {
  if (v === "lab") await labLoad("dashboard", "/v1/terminal/dashboard");
  if (v === "containers") await labLoad("containers", "/v1/terminal/containers");
  if (v === "logs" && id) await labLoad("logs", `/v1/terminal/logs/${encodeURIComponent(id)}`);
  if (v === "jobs") await labLoad("jobs", "/v1/terminal/jobs");
  if (v === "job" && id) await labLoad("job", `/v1/terminal/jobs/${encodeURIComponent(id)}`);
  if (v === "media") {
    await labLoad("requests", "/v1/terminal/media/requests");
    if (LAB.mediaQuery) await labLoad("found", `/v1/terminal/media?query=${encodeURIComponent(LAB.mediaQuery)}`);
  }
  if (v === "house") {
    await labLoad("favorites", "/v1/terminal/home");
    if (LAB.catalogQuery !== undefined) await labLoad("catalog", `/v1/terminal/home/catalog?query=${encodeURIComponent(LAB.catalogQuery)}`);
  }
  if (v === "music") await loadMusic();
}

// One action through the node, which checks it against its own list before doing anything.
// The id is new for each tap, so a retry of the same tap is never done twice.
async function labAct(kind, action, target) {
  const request_id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const op = await api("POST", "/v1/terminal/action", { request_id, kind, action, target, confirmed: true });
  flash(op.summary || op.state, op.state === "uncertain" ? "err" : "ok");
  return op;
}

const labItems = (page) => (page && Array.isArray(page.items) ? page.items : []);
const labError = (page) => (page && page.error ? `<div class="note">${esc(page.error)}</div>` : "");
const labCrumbs = (...rest) => crumbs([{ label: "HQ", act: "go:hq" }, ...rest]);
const stateClass = (state) =>
  state === "running" ? "concluded" : state === "unhealthy" ? "rejected" : state === "unknown" ? "" : "pending";

// ---- Home lab ----------------------------------------------------------------
function viewLab() {
  const d = LAB.dashboard;
  const head = `${labCrumbs({ label: "Home lab" })}<h2>Home lab</h2>`;
  const nav = `
    <div class="card nav-list">
      <button class="ghost" data-act="go:containers">${icon("box")}<span class="grow" style="text-align:left;">Containers<span class="sub" style="display:block;font-weight:400;">start, stop, restart and read logs</span></span>${icon("chevron", 15)}</button>
      <button class="ghost" data-act="go:jobs">${icon("clock")}<span class="grow" style="text-align:left;">Jobs<span class="sub" style="display:block;font-weight:400;">the Ansible runs you allowed</span></span>${icon("chevron", 15)}</button>
    </div>`;
  if (!d) return `${head}${nav}<div class="note">Asking the home lab…</div>`;
  if (d.error) return `${head}${nav}${labError(d)}`;
  const stats = (d.stats || []).map((s) => `<span class="pill">${esc(s)}</span>`).join(" ");
  const groups = (d.groups || []).map((g) => {
    const services = g.services || [];
    const up = services.filter((s) => s.state === "running").length;
    const trouble = services.some((s) => s.state === "unhealthy" || s.state === "stopped");
    // Homepage's Alerts group holds firing alerts, which are counted, not "up".
    const firing = /^alerts?$/i.test(g.name) ? services.filter((s) => s.state === "unhealthy").length : null;
    const count = firing === null ? `${up} of ${services.length} up` : firing ? `${firing} firing` : "none firing";
    const rows = services.map((s) => `
      <div class="row" style="gap:8px;padding:6px 0;">
        <div class="grow"><div>${esc(s.name)}</div>${s.detail ? `<div class="sub">${esc(s.detail)}</div>` : ""}</div>
        <span class="pill ${stateClass(s.state)}">${esc(s.state)}</span>
        ${s.id ? `<button class="ghost" data-act="go:logs:${esc(s.id)}">Logs</button>` : ""}
      </div>`).join("");
    return `
      <details class="card"${trouble ? " open" : ""}>
        <summary><span class="title">${esc(g.name)}</span> <span class="pill${trouble ? " rejected" : ""}">${count}</span></summary>
        ${rows}
      </details>`;
  }).join("");
  return `${head}
    ${stats ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px;">${stats}</div>` : ""}
    ${nav}
    <h3>Services</h3>
    ${listOr(groups, "Homepage lists no services.")}`;
}

function viewContainers() {
  const page = LAB.containers;
  const head = `${labCrumbs({ label: "Home lab", act: "go:lab" }, { label: "Containers" })}<h2>Containers</h2>`;
  if (!page) return `${head}<div class="note">Asking Portainer…</div>`;
  if (page.error) return `${head}${labError(page)}`;
  // The ones that need you first.
  const items = labItems(page).slice().sort((a, b) =>
    Number(a.detail.startsWith("running")) - Number(b.detail.startsWith("running")));
  const rows = items.map((c) => {
    const running = c.detail.startsWith("running");
    const controls = c.protected
      ? `<span class="pill" title="Stopping it would cut the path to Endora">keeps Endora reachable</span>`
      : running
        ? `<button class="ghost" data-act="lab:container:restart:${esc(c.id)}">Restart</button>
           <button class="ghost danger" data-act="lab:container:stop:${esc(c.id)}">Stop</button>`
        : `<button class="ghost" data-act="lab:container:start:${esc(c.id)}">Start</button>`;
    return `
      <div class="card">
        <div class="row" style="gap:8px;"><div class="grow"><div class="title">${esc(c.label)}</div><div class="sub">${esc(c.detail)}</div></div></div>
        <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:6px;">
          <button class="ghost" data-act="go:logs:${esc(c.id)}">Logs</button>${controls}
        </div>
      </div>`;
  });
  return `${head}
    ${page.summary ? `<div class="note" style="margin-bottom:10px;">${esc(page.summary)}</div>` : ""}
    ${listOr(rows, "Portainer lists no containers.")}`;
}

function viewLogs() {
  const page = LAB.logs;
  const name = (labItems(LAB.containers).find((c) => c.id === NAV.id) || {}).label || "Logs";
  const head = `${labCrumbs({ label: "Home lab", act: "go:lab" }, { label: "Containers", act: "go:containers" }, { label: name })}
    <h2>${esc(name)}</h2>
    <div class="row" style="justify-content:flex-end;"><button class="ghost" data-act="lab:refresh">Refresh</button></div>`;
  if (!page) return `${head}<div class="note">Reading the last hundred lines…</div>`;
  if (page.error) return `${head}${labError(page)}`;
  return `${head}<pre class="step-out" style="max-height:none;margin:0;">${esc(page.summary || "(nothing logged)")}</pre>`;
}

function viewJobs() {
  const page = LAB.jobs;
  const head = `${labCrumbs({ label: "Home lab", act: "go:lab" }, { label: "Jobs" })}<h2>Jobs</h2>
    <div class="note" style="margin-bottom:10px;">Only the runs listed in the job agent's own configuration on the NAS. Each one is asked before it starts.</div>`;
  if (!page) return `${head}<div class="note">Asking the job agent…</div>`;
  // Its address and key are set by installing it, not under Connections.
  if (page.error && /^Not set up/.test(page.error)) {
    return `${head}<div class="note">The job agent is not installed on the NAS yet. The <code>endora_terminal_agent</code> role in ansible-nas installs it.</div>`;
  }
  if (page.error) return `${head}${labError(page)}`;
  const rows = labItems(page).map((j) => `
    <div class="card"><div class="row" style="gap:8px;">
      <div class="grow"><div class="title">${esc(j.label)}</div><div class="sub">${esc(j.detail)}</div></div>
      ${j.latest_id ? `<button class="ghost" data-act="go:job:${esc(j.latest_id)}">Last run</button>` : ""}
      <button class="ghost" data-act="lab:job:run:${esc(j.id)}">Run</button>
    </div></div>`);
  return `${head}${listOr(rows, "No jobs are allowed yet.")}`;
}

function viewJob() {
  const page = LAB.job;
  const head = `${labCrumbs({ label: "Home lab", act: "go:lab" }, { label: "Jobs", act: "go:jobs" }, { label: "Run" })}<h2>Job run</h2>
    <div class="row" style="justify-content:flex-end;"><button class="ghost" data-act="lab:refresh">Refresh</button></div>`;
  if (!page) return `${head}<div class="note">Reading its output…</div>`;
  if (page.error) return `${head}${labError(page)}`;
  return `${head}<div class="note">${esc(page.state || "")}</div>
    <pre class="step-out" style="max-height:none;margin:0;">${esc(page.summary || "(no output yet)")}</pre>`;
}

// ---- Media -------------------------------------------------------------------
function viewMedia() {
  const head = `${labCrumbs({ label: "Media" })}<h2>Media</h2>`;
  const search = `
    <div class="form" style="margin-bottom:10px;">
      <input id="media-q" type="search" placeholder="a film or a show" autocomplete="off" value="${esc(LAB.mediaQuery || "")}" />
      <button class="primary" data-act="media:search">Search</button>
    </div>`;
  const found = LAB.found;
  const results = !LAB.mediaQuery ? "" : !found ? `<div class="note">Searching…</div>` : found.error ? labError(found)
    : listOr(labItems(found).map((m) => {
      const open = /not requested/i.test(m.detail);
      return `<div class="card"><div class="row" style="gap:8px;">
        <div class="grow"><div class="title">${esc(m.label)}</div><div class="sub">${esc(m.detail)}</div></div>
        ${open && m.media_type ? `<button class="ghost" data-act="media:request:${esc(m.media_type)}:${esc(m.id)}">Request</button>` : ""}
      </div></div>`;
    }), "Nothing by that name.");
  const recent = LAB.requests;
  const requests = !recent ? `<div class="note">Asking Overseerr…</div>` : recent.error ? labError(recent)
    : listOr(labItems(recent).map((m) => `<div class="card"><div class="title">${esc(m.label)}</div><div class="sub">${esc(m.detail)}</div></div>`),
      "No requests yet.");
  return `${head}${search}${results}<h3>Recent requests</h3>${requests}`;
}

// ---- Smart home --------------------------------------------------------------
// Favorites are the only things this screen switches: the node refuses an entity that is not
// one, so choosing favorites is choosing what may be switched from a phone.
function houseControls(item) {
  const [domain] = String(item.id || "").split(".");
  const now = String(item.detail || "").trim();
  if (domain === "scene") return `<button class="ghost" data-act="house:home:scene:${esc(item.id)}">Set</button>`;
  if (!["light", "switch", "input_boolean"].includes(domain)) return "";
  return `<button class="${now === "on" ? "primary" : "ghost"}" data-act="house:home:on:${esc(item.id)}">On</button>
    <button class="${now === "off" ? "primary" : "ghost"}" data-act="house:home:off:${esc(item.id)}">Off</button>`;
}

function viewHouse() {
  const head = `${labCrumbs({ label: "Smart home" })}<h2>Smart home</h2>`;
  const page = LAB.favorites;
  const favorites = !page ? `<div class="note">Asking Home Assistant…</div>` : page.error ? labError(page)
    : listOr(labItems(page).map((f) => `<div class="card"><div class="row" style="gap:8px;">
        <div class="grow"><div class="title">${esc(f.label)}</div><div class="sub">${esc(f.detail)}</div></div>
        ${houseControls(f)}
      </div></div>`), "No favorites yet. Choose some below.");
  const catalog = LAB.catalog;
  const choices = LAB.catalogQuery === undefined ? "" : !catalog ? `<div class="note">Asking Home Assistant…</div>` : catalog.error ? labError(catalog)
    : listOr(labItems(catalog).map((c) => `<div class="row" style="gap:8px;padding:6px 0;">
        <div class="grow"><div>${esc(c.label)}</div><div class="sub">${esc(c.id)} · ${esc(c.detail)}</div></div>
        <button class="${c.favorite ? "primary" : "ghost"}" data-act="house:favorite:${c.favorite ? "remove" : "add"}:${esc(c.id)}">${c.favorite ? "Favorite" : "Add"}</button>
      </div>`), "Nothing by that name.");
  return `${head}${favorites}
    <details class="card" style="margin-top:12px;"${LAB.catalogQuery !== undefined ? " open" : ""}>
      <summary class="title">Choose favorites</summary>
      <div class="form" style="margin:8px 0;">
        <input id="house-q" type="search" placeholder="a light, a switch, a scene (blank for all)" autocomplete="off" value="${esc(LAB.catalogQuery || "")}" />
        <button class="ghost" data-act="house:search">Show</button>
      </div>
      ${choices}
    </details>`;
}

// ---- Music -------------------------------------------------------------------
// Not here: Music is Console's own screen (48-console.js), a link to the Spotify app and to
// Endora Audio's status. The copied player borrowed a Spotify token and wired speakers through
// the sound hub, both of which the contract keeps with Audio, so it was removed.

// ---- actions -----------------------------------------------------------------
// The verbs these screens use. Returns true when it handled one.
async function labDispatch(verb, noun, id, arg) {
  if (verb === "lab" && noun === "refresh") { await loadLab(NAV.v, NAV.id); render(); return true; }
  if (verb === "lab" && noun === "container") {
    const name = (labItems(LAB.containers).find((c) => c.id === arg) || {}).label || "this container";
    if (id !== "start" && !confirm(`${id === "stop" ? "Stop" : "Restart"} ${name}?`)) return true;
    try { await labAct("container", id, arg); } catch (e) { flash(labTrouble(e), "err"); }
    await loadLab("containers"); render(); return true;
  }
  if (verb === "lab" && noun === "job") {
    const job = (labItems(LAB.jobs).find((j) => j.id === arg) || {}).label || arg;
    if (!confirm(`Run "${job}" on the NAS now?`)) return true;
    try { await labAct("job", "run", arg); } catch (e) { flash(labTrouble(e), "err"); }
    await loadLab("jobs"); render(); return true;
  }
  if (verb === "media" && noun === "search") {
    const field = document.getElementById("media-q");
    LAB.mediaQuery = field ? field.value.trim() : "";
    LAB.found = null; render();
    await loadLab("media"); render(); return true;
  }
  if (verb === "media" && noun === "request") {
    const title = (labItems(LAB.found).find((m) => m.id === arg) || {}).label || "it";
    if (!confirm(`Request ${title}?`)) return true;
    try { await labAct("media", id, arg); } catch (e) { flash(labTrouble(e), "err"); }
    await loadLab("media"); render(); return true;
  }
  if (verb === "house" && noun === "search") {
    const field = document.getElementById("house-q");
    LAB.catalogQuery = field ? field.value.trim() : "";
    LAB.catalog = null; render();
    await loadLab("house"); render(); return true;
  }
  if (verb === "house" && (noun === "home" || noun === "favorite")) {
    try { await labAct(noun, id, arg); } catch (e) { flash(labTrouble(e), "err"); }
    await loadLab("house"); render(); return true;
  }
  if (verb === "music") { await musicDispatch(noun, id); return true; }
  return false;
}
