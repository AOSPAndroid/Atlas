/* Live Inbox request tools: health, performance, AD groups and deployment for a request's
   machine and sender, shown beside the message instead of switching to Workspace.
   Nothing runs without a click; ending a process and rebooting still ask first. The full
   Remote Admin, Active Directory and Workspace views stay one click away, with a button
   back to Live Inbox. */
(() => {
  const TABS = [
    ["health", "Health", "machine"],
    ["performance", "Performance", "machine"],
    ["machine-groups", "PC groups", "machine"],
    ["user-groups", "User groups", "user"],
    ["deploy", "Deploy", "machine"],
  ];
  const TOOLS = [["msra", "MSRA"], ["cshare", "C$"], ["rdp", "Remote Desktop"], ["compmgmt", "Computer Management"]];
  const MEMBERSHIP = { Direct: 0, Primary: 1, Nested: 2 };
  const state = { machine: "", user: null, tab: "health", done: {}, performance: null, groups: {}, docked: false };
  let dock = null, home = null, back = null, inboxClick = false;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const account = (user) => user?.user_name || user?.email || "";
  const inbox = () => document.getElementById("inbox");
  const pane = (tab) => dock.querySelector(`[data-work-pane="${tab}"]`);
  const number = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
  const percent = (value) => (number(value) === null ? "–" : Math.round(number(value)) + "%");
  const gib = (bytes) => (number(bytes) === null ? "–" : (number(bytes) / 1024 ** 3).toFixed(1));
  const tone = (value, warn, high) => (number(value) === null ? "" : value >= high ? "bad" : value >= warn ? "warn" : "good");
  const busy = (host, text) => { host.setAttribute("aria-busy", "true"); host.innerHTML = `<p class="inbox-work-muted" role="status">${esc(text)}</p>`; };
  const failed = (host, error) => { host.innerHTML = `<p class="inbox-work-error" role="alert">${esc(error.message)}</p><button type="button" data-work-rescan>Try again</button>`; };

  function build() {
    dock = document.createElement("aside");
    dock.id = "inboxWork";
    dock.className = "inbox-work";
    dock.hidden = true;
    dock.setAttribute("aria-label", "Request tools");
    dock.innerHTML = `<div class="inbox-work-head"><div><small>Request tools · without leaving Live Inbox</small><h2 data-work-title></h2></div><button type="button" class="inbox-work-close" data-work-close aria-label="Close request tools" title="Close">×</button></div>
<div class="inbox-work-quick" role="group" aria-label="Remote support">${TOOLS.map(([id, label]) => `<button type="button" data-work-tool="${id}" data-needs="machine">${label}</button>`).join("")}<button type="button" data-work-reboot data-needs="machine">Reboot…</button><button type="button" data-work-workspace>Workspace ↗</button></div>
<div class="inbox-work-tabs" role="tablist" aria-label="Request tools">${TABS.map(([id, label]) => `<button type="button" role="tab" id="inboxWorkTab-${id}" data-work-tab="${id}" aria-controls="inboxWorkPane-${id}" aria-selected="false">${label}</button>`).join("")}</div>
${TABS.map(([id]) => `<section class="inbox-work-pane" role="tabpanel" id="inboxWorkPane-${id}" data-work-pane="${id}" aria-labelledby="inboxWorkTab-${id}" hidden></section>`).join("")}`;
    pane("health").innerHTML = '<div data-work-health></div>';
    dock.addEventListener("click", (event) => click(event).catch((error) => toast(error.message)));
    dock.addEventListener("input", (event) => { if (event.target.matches("[data-work-filter]")) filterGroups(event.target); });
  }

  /** Opens the tools beside the message; false when Live Inbox is not on screen (callers then use Workspace). */
  function open({ machine = "", user = null } = {}, tab = "health", mode = "show") {
    const grid = document.querySelector("#liveInbox .inbox-grid");
    if (!grid || !inbox()?.classList.contains("active")) return false;
    if (!dock) build();
    // React owns .inbox-grid's two columns and never re-orders them, so the panel stays the last child.
    if (dock.parentNode !== grid) grid.append(dock);
    use(String(machine || "").toUpperCase(), user);
    dock.hidden = false;
    show(tab, mode);
    return true;
  }

  function use(machine, user) {
    if (machine !== state.machine) {
      if (dock.querySelector("[data-work-health]")) window.AtlasHealth?.cancel(dock.querySelector("[data-work-health]"));
      state.machine = machine;
      state.performance = null;
      for (const tab of ["health", "performance", "machine-groups"]) delete state.done[tab];
      pane("health").innerHTML = '<div data-work-health></div>';
      pane("performance").replaceChildren();
      pane("machine-groups").replaceChildren();
    }
    if (account(user) !== account(state.user)) {
      delete state.done["user-groups"];
      pane("user-groups").replaceChildren();
    }
    state.user = user;
    const person = user?.full_name || user?.name || account(user);
    dock.querySelector("[data-work-title]").textContent = [machine || "No Windows PC", person].filter(Boolean).join(" · ");
    for (const [tab, , needs] of TABS) {
      const missing = needs === "machine" ? !machine : !account(user);
      const button = dock.querySelector(`[data-work-tab="${tab}"]`);
      button.disabled = missing;
      button.title = missing ? (needs === "machine" ? "No Windows machine is linked to or named in this message" : "No Atlas person with an AD account matched this sender") : "";
    }
    dock.querySelectorAll('[data-needs="machine"]').forEach((button) => { button.disabled = !machine; });
  }

  function show(tab, mode = "show") {
    const needs = TABS.find(([id]) => id === tab)?.[2];
    if (!needs) return;
    state.tab = tab;
    dock.querySelectorAll("[data-work-tab]").forEach((button) => {
      const selected = button.dataset.workTab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("active", selected);
    });
    dock.querySelectorAll("[data-work-pane]").forEach((section) => { section.hidden = section.dataset.workPane !== tab; });
    if (needs === "machine" && !state.machine) return note(tab, "No Windows machine is linked to or named in this message. Choose a machine in Linked machines.");
    if (needs === "user" && !account(state.user)) return note(tab, "No Atlas person with an AD account matched this sender.");
    if (tab === "health") return health(mode);
    if (tab === "performance") return mode === "scan" || state.done.performance !== state.machine ? performance() : undefined;
    if (tab === "machine-groups" || tab === "user-groups") {
      const kind = tab === "user-groups" ? "user" : "computer", id = kind === "user" ? account(state.user) : state.machine;
      return mode === "scan" || state.done[tab] !== kind + ":" + id ? groups(kind, id) : undefined;
    }
    if (tab === "deploy") { target(); return dockDeployment(); }
  }

  function note(tab, text) {
    pane(tab).innerHTML = `<p class="inbox-work-muted">${esc(text)}</p>`;
  }

  // Atlas's current target follows the panel, so Workspace, Remote Admin and deployment agree.
  function target() {
    if (!state.machine) throw Error("No Windows machine is selected for this request.");
    if (S.target !== state.machine) setTarget(state.machine, "Live inbox request", false);
    if (S.target !== state.machine) throw Error(`${state.machine} is inventory only; Windows tools need a PC.`);
  }

  function health(mode) {
    const host = pane("health").querySelector("[data-work-health]"), pc = state.machine;
    const current = () => state.machine === pc && !dock.hidden;
    if (mode === "scan") { state.done.health = pc; return window.AtlasHealth.scan(host, pc, current); }
    if (state.done.health === pc && mode !== "quick") return;
    state.done.health = pc;
    return window.AtlasHealth.quick(host, pc, current);
  }

  async function performance() {
    const host = pane("performance"), pc = state.machine;
    state.done.performance = pc;
    busy(host, `Sampling CPU, memory, disk and processes on ${pc}… this can take up to a minute.`);
    try {
      const data = await window.AtlasClient.request(`/api/performance/${encodeURIComponent(pc)}?kind=overview`);
      if (state.machine !== pc) return;
      if (!data || data.ok === false || !Array.isArray(data.items)) throw Error(data?.error || `Atlas could not read performance counters on ${pc}.`);
      state.performance = { pc, data, sort: "CPU" };
      renderPerformance();
    } catch (error) {
      if (state.machine !== pc) return;
      delete state.done.performance;
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  function renderPerformance() {
    const { pc, data, sort } = state.performance, s = data.summary || {}, host = pane("performance");
    const volume = (s.volumes || []).find((v) => /^C:/i.test(v.name || "")) || (s.volumes || [])[0];
    const disk = (s.disks || [])[0], latency = disk ? Math.max(number(disk.read_ms) || 0, number(disk.write_ms) || 0) : null;
    const used = number(s.total_memory_bytes) !== null && number(s.available_memory_bytes) !== null ? s.total_memory_bytes - s.available_memory_bytes : null;
    const uptime = number(s.uptime_seconds);
    const tiles = [
      ["CPU", percent(s.cpu_percent), s.logical_processors ? s.logical_processors + " logical processors" : "", tone(s.cpu_percent, 70, 85)],
      ["Memory", percent(s.memory_percent), used === null ? "" : `${gib(used)} of ${gib(s.total_memory_bytes)} GiB in use`, tone(s.memory_percent, 70, 80)],
      ["C: free", volume ? percent(volume.free_percent) : "–", volume ? `${gib(volume.free_bytes)} of ${gib(volume.total_bytes)} GiB free` : "", volume ? tone(100 - volume.free_percent, 80, 90) : ""],
      ["Disk", latency === null ? "–" : latency.toFixed(0) + " ms", disk ? `Read ${number(disk.read_ms)?.toFixed(0) ?? "–"} ms · write ${number(disk.write_ms)?.toFixed(0) ?? "–"} ms · queue ${disk.queue ?? "–"}` : "", tone(latency, 10, 20)],
      ["Uptime", uptime === null ? "–" : `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`, s.os || "", uptime === null ? "" : uptime > 8 * 86400 ? "warn" : "good"],
    ];
    const notes = typeof performanceInsights === "function" ? performanceInsights(s) : [];
    const key = sort === "Memory" ? "MemoryBytes" : "CPU";
    const rows = [...data.items].sort((a, b) => (number(b[key]) ?? -1) - (number(a[key]) ?? -1)).slice(0, 12);
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${esc(pc)} · sampled ${esc(new Date(data.checked_at || Date.now()).toLocaleTimeString())} · ${esc(data.total_processes ?? data.items.length)} processes</small><span><button type="button" data-work-rescan>Scan again</button><button type="button" data-work-admin>Remote Admin ↗</button></span></div>
<div class="inbox-work-tiles">${tiles.map(([label, value, detail, level]) => `<div class="inbox-work-tile" data-tone="${level}"><small>${esc(label)}</small><b>${esc(value)}</b><span>${esc(detail)}</span></div>`).join("")}</div>
${notes.length ? `<ul class="inbox-work-notes">${notes.map((text) => `<li>${esc(text)}</li>`).join("")}</ul>` : '<p class="inbox-work-muted">No pressure found in this sample.</p>'}
<div class="inbox-work-toolbar"><b>Top processes</b><span role="group" aria-label="Sort processes">${["CPU", "Memory"].map((label) => `<button type="button" data-work-sort="${label}" aria-pressed="${sort === label}">By ${label === "CPU" ? label : label.toLowerCase()}</button>`).join("")}</span></div>
<table class="inbox-work-processes"><thead><tr><th scope="col">Process</th><th scope="col">PID</th><th scope="col">CPU</th><th scope="col">Memory</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((row) => `<tr><td title="${esc(row.CommandLine || row.Process)}">${esc(row.Process)}</td><td>${esc(row.PID)}</td><td data-tone="${tone(row.CPU, 10, 25)}">${number(row.CPU) === null ? "–" : number(row.CPU).toFixed(1) + "%"}</td><td>${number(row.MemoryBytes) === null ? "–" : (row.MemoryBytes / 1024 ** 2 >= 1024 ? gib(row.MemoryBytes) + " GiB" : Math.round(row.MemoryBytes / 1024 ** 2) + " MB")}</td><td>${row.CanTerminate === false ? `<small title="${esc(row.BlockReason || "Protected process")}">Protected</small>` : `<button type="button" data-work-end="${esc(row.PID)}" aria-label="End ${esc(row.Process)} (PID ${esc(row.PID)})">End…</button>`}</td></tr>`).join("")}</tbody></table>
${(data.warnings || []).map((text) => `<p class="inbox-work-muted">${esc(text)}</p>`).join("")}`;
  }

  async function endProcess(pid) {
    const sample = state.performance, row = sample?.data.items.find((item) => String(item.PID) === pid);
    if (!row || sample.pc !== state.machine) return toast("The process list changed. Scan again first.");
    if (!confirm(`End ${row.Process} (PID ${row.PID}) on ${sample.pc}? Unsaved work in it will be lost.`)) return;
    const result = await window.AtlasClient.request("/api/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ computer: sample.pc, value: String(row.PID), created: row.CreatedAt, name: row.Process }),
    });
    const problems = (result.results || []).filter((item) => item.state !== "terminated");
    toast(`${sample.pc}: ${result.count || 0} ended${problems.length ? "; " + problems.map((item) => `${item.Process} (${item.PID}): ${item.message}`).join("; ") : result.count ? "" : "; it is no longer running"}`);
    if (result.count && state.machine === sample.pc) await performance();
  }

  async function groups(kind, id) {
    const tab = kind === "user" ? "user-groups" : "machine-groups", host = pane(tab), key = kind + ":" + id;
    state.done[tab] = key;
    busy(host, `Looking up ${id} in Active Directory…`);
    try {
      const server = document.getElementById("adServer")?.value.trim() || "";
      const result = await window.AtlasClient.request("/api/active-directory/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, identity: id, server }),
      });
      if (state.done[tab] !== key) return;
      state.groups[tab] = { kind, id, result };
      renderGroups(tab);
    } catch (error) {
      if (state.done[tab] !== key) return;
      delete state.done[tab];
      failed(host, error);
    } finally {
      host.removeAttribute("aria-busy");
    }
  }

  const shown = (value) => (value === true ? "Yes" : value === false ? "No" : value === null || value === undefined || value === "" ? "–" : typeof value === "object" ? JSON.stringify(value) : String(value));

  function renderGroups(tab) {
    const { kind, id, result } = state.groups[tab], details = result.details || {}, host = pane(tab);
    // Only the checks AD returned are reported; computers have no lock-out or password fields.
    const checks = [
      ["Enabled", (v) => v === false, "Disabled", "enabled"],
      ["Locked out", (v) => v === true, "Locked out", "not locked"],
      ["Password expired", (v) => v === true, "Password expired", "password valid"],
      ["Account expiration", (v) => !!v && Date.parse(v) < Date.now(), "Account expired", "not expired"],
    ].filter(([field]) => field in details);
    const problems = checks.filter(([field, bad]) => bad(details[field])).map(([, , label]) => label);
    const list = [...(result.groups || [])].sort((a, b) => (MEMBERSHIP[a.membership] ?? 3) - (MEMBERSHIP[b.membership] ?? 3) || String(a.name).localeCompare(String(b.name)));
    const count = (type) => list.filter((group) => group.membership === type).length;
    host.innerHTML = `<div class="inbox-work-toolbar"><small>${esc(kind === "user" ? "Account" : "Computer")} ${esc(details.Account || details.Name || id)} · ${esc(result.server || "default domain")}</small><span><button type="button" data-work-rescan>Look up again</button><button type="button" data-work-ad>Compare in Active Directory ↗</button></span></div>
<p class="inbox-work-chips">${problems.length ? problems.map((label) => `<span data-tone="bad">${esc(label)}</span>`).join("") : checks.length ? `<span data-tone="good">${esc(checks.map(([, , , good]) => good).join(" · "))}</span>` : ""}</p>
<details class="inbox-work-details"><summary>${kind === "user" ? "Account" : "Computer"} details (${Object.keys(details).length})</summary><dl>${Object.entries(details).map(([field, value]) => `<dt>${esc(field)}</dt><dd>${esc(shown(value))}</dd>`).join("")}</dl></details>
<div class="inbox-work-toolbar"><b>${list.length} groups</b><small>${count("Direct")} direct · ${count("Primary")} primary · ${count("Nested")} nested</small></div>
<div class="inbox-work-filter"><input type="search" data-work-filter placeholder="Filter groups" aria-label="Filter groups" autocomplete="off" /><button type="button" data-work-copy>Copy names</button></div>
<ul class="inbox-work-groups">${list.map((group) => `<li data-group="${esc(String(group.name).toLowerCase())}" title="${esc(group.description || group.dn || "")}"><span>${esc(group.name)}</span><small data-membership="${esc(group.membership)}">${esc(group.membership || "")}</small><small>${esc([group.category, group.scope].filter(Boolean).join(" · "))}</small></li>`).join("")}</ul>
<p class="inbox-work-muted" data-work-hidden hidden></p>
${(result.warnings || []).map((text) => `<p class="inbox-work-muted">${esc(text)}</p>`).join("")}`;
  }

  function filterGroups(input) {
    const host = input.closest("[data-work-pane]"), term = input.value.trim().toLowerCase();
    let hidden = 0;
    host.querySelectorAll("[data-group]").forEach((row) => { row.hidden = !!term && !row.dataset.group.includes(term); hidden += row.hidden; });
    const note = host.querySelector("[data-work-hidden]");
    note.hidden = !hidden;
    note.textContent = hidden ? `${hidden} groups hidden by the filter.` : "";
  }

  // The Workspace deployment panel moves here once Deploy is opened and stays while the tools
  // are open, so every deployment control (package, script, Install/Repair/Uninstall, queue,
  // progress) works unchanged and a half-chosen package survives switching tools.
  function dockDeployment() {
    const panel = document.getElementById("deploymentPanel");
    if (!panel) return;
    if (!home) home = { parent: panel.parentNode, next: panel.nextSibling };
    if (panel.parentNode !== pane("deploy")) pane("deploy").append(panel);
    state.docked = true;
    syncDeploymentPanel({ selection: true });
  }

  // sync=false when leaving Live Inbox: page() syncs once the next page is active.
  function undock(sync = true) {
    const panel = document.getElementById("deploymentPanel");
    if (!home || !panel || panel.parentNode === home.parent) return;
    home.parent.insertBefore(panel, home.next?.parentNode === home.parent ? home.next : null);
    if (sync) syncDeploymentPanel();
  }

  function close() {
    undock();
    state.docked = false;
    const host = dock.querySelector("[data-work-health]");
    if (host) window.AtlasHealth?.cancel(host);
    dock.hidden = true;
  }

  async function click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled || !dock.contains(button)) return;
    const data = button.dataset, detail = { machine: state.machine, user: state.user };
    if ("workClose" in data) return close();
    if (data.workTab) return show(data.workTab);
    if ("workRescan" in data) return show(state.tab, "scan");
    if (data.workSort) { state.performance.sort = data.workSort; return renderPerformance(); }
    if (data.workEnd) return endProcess(data.workEnd);
    if (data.workTool) { target(); return openTargetTool(data.workTool); }
    if ("workReboot" in data) return window.AtlasInboxActions.run({ ...detail, action: "reboot" });
    if ("workCopy" in data) {
      const names = [...button.closest("[data-work-pane]").querySelectorAll("[data-group]:not([hidden]) > span:first-child")].map((node) => node.textContent);
      return copy(names.join("\n"), names.length + " group names");
    }
    if ("workAd" in data) {
      const { kind, id } = state.groups[state.tab];
      return window.AtlasAD.show(kind, id);
    }
    if ("workAdmin" in data) { target(); return page("admin"); }
    if ("workWorkspace" in data) {
      if (state.machine) target();
      page("workspace");
      if (state.user?.id && S.user?.id !== state.user.id) await loadUser("id:" + state.user.id);
    }
  }

  // "Back to Live Inbox" after a Live Inbox button opened another page (Knowledge Base, Workspace,
  // Active Directory, Remote Admin). The sidebar does not show it.
  function returnButton(visible) {
    if (!back && !visible) return;
    if (!back) {
      back = document.createElement("button");
      back.type = "button";
      back.id = "inboxReturn";
      back.className = "inbox-return";
      back.textContent = "← Back to Live Inbox";
      back.onclick = () => page("inbox");
      document.body.append(back);
    }
    back.hidden = !visible;
  }
  // True only while a click inside Live Inbox is being handled, so page changes it causes are known.
  window.addEventListener("click", (event) => {
    inboxClick = !!event.target.closest?.("#inbox");
    if (inboxClick) setTimeout(() => { inboxClick = false; });
  }, true);
  window.addEventListener("click", () => { inboxClick = false; });

  const original = window.page;
  window.page = function (id) {
    const leaving = id !== "inbox" && !!inbox()?.classList.contains("active");
    // Back in Workspace before the switch, so the panel is never hidden with a package half chosen.
    if (leaving) undock(false);
    const result = original.apply(this, arguments);
    if (id === "inbox") {
      returnButton(false);
      try {
        // Deploy on screen takes the request's machine back; otherwise only re-dock when the target is unchanged.
        if (dock && !dock.hidden && state.docked) state.tab === "deploy" ? show("deploy") : S.target === state.machine && dockDeployment();
      } catch (error) {
        toast(error.message);
      }
    } else if (leaving && inboxClick) returnButton(true);
    return result;
  };

  window.AtlasInboxWork = { open, close, show, isOpen: () => !!dock && !dock.hidden && dock.isConnected, state: () => ({ machine: state.machine, tab: state.tab }) };
})();
