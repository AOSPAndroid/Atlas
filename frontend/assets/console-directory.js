function setTarget(pc, status = "", quick = true) {
  pc = String(pc || "")
    .trim()
    .toUpperCase();
  if (!pc) return;
  const record = S.machines.find(m => String(m.name || "").toUpperCase() === pc) || {name: pc};
  S.selectedDevice = pc;
  if (!AtlasUI.supportsWindows(record)) {
    S.target = "";
    window.AtlasPsExec?.syncTarget("");
    window.AtlasDiagnostics?.stop("Selected an inventory device");
    AtlasHealth.cancel($("#healthLine"));
    invalidateProcesses();
    syncDeploymentPanel();
    $("#adminPc").value = "";
    $("#deployTarget").textContent = "Select a PC";
    $("#targetBar").classList.add("hidden");
    $("#healthLine").classList.add("hidden");
    $("#preflight").innerHTML = "";
    $("#packagePresence").innerHTML = "";
    $$("[data-machine]").forEach(x => x.classList.toggle("selected", String(S.machines[+x.dataset.machine]?.name || "").toUpperCase() === pc));
    refreshConsoleSummary();
    window.AtlasSelection?.refresh();
    return;
  }
  if (pc === S.target) {
    if (quick) refreshTargetHealth("quick");
    window.AtlasSelection?.refresh();
    return;
  }
  S.target = pc;
  window.AtlasPsExec?.syncTarget(pc);
  syncDeploymentPanel({ selection: true });
  $("#deployTarget").textContent = pc;
  $("#adminPc").value = pc;
  invalidateProcesses();
  $("#barTarget").textContent = pc;
  $("#barState").textContent = status;
  $("#targetBar").classList.remove("hidden");
  $$("[data-machine]").forEach((x) =>
    x.classList.toggle("selected", S.machines[+x.dataset.machine]?.name === pc),
  );
  rememberTarget(pc);
  refreshTargetHealth(quick ? "quick" : false);
  refreshConsoleSummary();
  updatePackagePresence();
  window.AtlasSelection?.refresh();
}
function clearLookup() {
  clearDirectTarget();
  AtlasHealth.cancel($("#healthLine"));
  S.user = null;
  S.users = [];
  S.machines = [];
  S.target = "";
  S.selectedDevice = "";
  window.AtlasPsExec?.syncTarget("");
  syncDeploymentPanel();
  masterState.resolution = null;
  $("#kyc").innerHTML = "";
  $("#users").innerHTML = "";
  $("#machines").innerHTML = "";
  $("#deployTarget").textContent = "Select a machine";
  $("#adminPc").value = "";
  invalidateProcesses();
  $("#targetBar").classList.add("hidden");
  $("#healthLine").classList.add("hidden");
  $("#preflight").innerHTML = "";
  $("#packagePresence").innerHTML = "";
  window.AtlasSelection?.refresh();
}
function directHostname(term) {
  const pc = term.replace(/^machine:\s*/i, "").trim().toUpperCase();
  return /^[A-Z0-9_.-]{1,64}$/.test(pc) && !/^[-.]/.test(pc) && !pc.includes("..") ? pc : "";
}
function clearDirectTarget() {
  $("#useHostname").hidden = true;
  $("#useHostname").onclick = null;
  $("#unlistedTargetStatus").hidden = true;
  $("#workspace .lookup-empty").hidden = false;
}
function offerDirectTarget(term, sequence) {
  if (sequence !== lookupSequence || $("#search").value.trim() !== term) return;
  const pc = directHostname(term);
  if (!pc) return toast("No matching users or machines");
  const button = $("#useHostname"), status = $("#unlistedTargetStatus");
  status.textContent = `No directory record for ${pc}. You can use this hostname as a target.`;
  status.hidden = false;
  $("#workspace .lookup-empty").hidden = true;
  button.hidden = false;
  button.title = `Use ${pc} as target`;
  button.onclick = () => {
    if (button.hidden || sequence !== lookupSequence || $("#search").value.trim() !== term) return;
    clearDirectTarget();
    $("#workspace .lookup-empty").hidden = true;
    setTarget(pc, "Entered hostname · not in directory");
    openDeploymentPanel();
  };
}
async function search() {
  const term = $("#search").value.trim(),
    sequence = ++lookupSequence;
  clearLookup();
  if (!term) return toast("Enter a search");
  let resolved = null;
  if (!term.includes(":"))
    resolved = await api("/api/master/resolve/" + encodeURIComponent(term));
  if (sequence !== lookupSequence) return;
  if (resolved?.matched) {
    await loadUser(resolved.user_key, sequence);
    if (sequence === lookupSequence && resolved.requested_machine)
      setTarget(resolved.requested_machine, "Database record");
    return;
  }
  const d = await api("/api/search?term=" + encodeURIComponent(term));
  if (sequence !== lookupSequence) return;
  S.users = d.users;
  S.machines = d.machines;
  if (d.users.length === 1 && !d.machines.length)
    return loadUser("id:" + d.users[0].id, sequence);
  renderUsers();
  renderMachines();
  if (!d.users.length && !d.machines.length)
    offerDirectTarget(term, sequence);
}
function renderUsers() {
  if (!S.users.length) return ($("#users").innerHTML = "");
  $("#users").innerHTML =
    `<div class=panel><small>MATCHING USERS</small><div class=row>${S.users.map((u, i) => `<button ${AtlasContext.attributes("user", u)} data-user="${i}">${esc(u.name)} · ${esc(u.user_name)} · ${esc(u.location)}</button><button data-email="${i}">Copy email</button>`).join("")}</div></div>`;
  $$("[data-user]").forEach(
    (b) =>
      (b.onclick = () =>
        loadUser("id:" + S.users[+b.dataset.user].id).catch((e) =>
          toast(e.message),
        )),
  );
  $$("[data-email]").forEach(
    (b) => (b.onclick = () => copy(S.users[+b.dataset.email].email, "Email")),
  );
}
async function loadUser(id, sequence) {
  if (sequence === undefined) {
    sequence = ++lookupSequence;
    clearLookup();
  }
  const d = await api("/api/user/" + encodeURIComponent(id));
  if (sequence !== lookupSequence) return;
  S.user = d.user;
  S.machines = d.machines;
  $("#users").innerHTML = "";
  renderKyc();
  renderMachines();
  AtlasUI.motion.slideUp($("#kyc"));
}
function renderKyc() {
  const u = S.user;
  $("#kyc").innerHTML = AtlasUI.person(u);
  const title = $("#kyc h2"), select = document.createElement("button");
  select.type = "button";
  select.className = "workspace-user-select";
  select.textContent = title.textContent;
  select.setAttribute("aria-label", "Show groups for " + (u.user_name || u.name));
  select.onclick = () => window.AtlasAD?.show("user", u.user_name || u.email || "");
  title.replaceChildren(select);
  const details = $("#kyc .atlas-person-details"), facts = $("#kyc .facts");
  const summary = document.createElement("p");
  summary.className = "workspace-user-summary";
  summary.textContent = [u.user_name, u.email].filter(Boolean).join(" · ");
  title.after(summary);
  const context = [u.department, u.location].filter(Boolean).join(" · ");
  if (context) {
    const row = document.createElement("p");
    row.className = "workspace-user-context";
    row.textContent = context;
    summary.after(row);
  }
  details.append(facts);
  const bar = document.createElement("div");
  bar.className = "copybar";
  for (const [label, value] of [
    ["Copy account", u.user_name],
    ["Copy domain account", AtlasUI.domainAccount(u)],
    ["Copy email", u.email],
    ["Copy name", u.full_name || u.name],
    ["Copy summary", supportSummary()],
  ]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = () => copy(value, label.replace("Copy ", ""));
    bar.append(button);
  }
  details.append(bar);
  applyCompactWorkspace();
  window.AtlasSelection?.refresh();
}
function renderMachines() {
  if (!S.machines.length) return ($("#machines").innerHTML = "");
  $("#machines").innerHTML =
    `<small>LINKED DEVICES · ${S.machines.length}</small><div class=machinegrid>${S.machines.map((m, i) => `<div class="card machine ${m.name === (S.selectedDevice || S.target) ? "selected" : ""}" data-machine-kind="${AtlasUI.machineKind(m)}" data-machine="${i}"><button class=copyhost data-host="${i}">Copy</button><h3>${esc(m.name)}</h3><p class="workspace-device-model">${esc(m.model_id || m.model_category || "Model not supplied")}${m.asset_tag ? " · " + esc(m.asset_tag) : ""}</p>${AtlasUI.supportsWindows(m) ? "" : '<p class="atlas-device-note">Inventory only · Windows tools require a PC.</p>'}<div class=facts><span>Match<b>${esc(m.match_type || "Device identity")}</b></span><span>Inventory discovered<b>${esc(m.last_discovered || "Not supplied")}</b></span><span>Record updated<b>${esc(m.updated_on || "Not supplied")}</b></span>${m.operational_status ? `<span>Inventory status<b>${esc(m.operational_status)}</b></span>` : ""}</div></div>`).join("")}</div>`;
  $$("[data-machine]").forEach(
    (x) =>
      (x.onclick = () =>
        setTarget(
          S.machines[+x.dataset.machine].name,
          S.machines[+x.dataset.machine].operational_status,
        )),
  );
  $$("[data-host]").forEach(
    (x) =>
      (x.onclick = (e) => {
        e.stopPropagation();
        copy(S.machines[+x.dataset.host].name, "Device identity");
      }),
  );
  if (S.machines.length === 1) {
    let m = S.machines[0];
    setTarget(m.name, m.operational_status, false);
  }
  AtlasUI.machineFilters($("#machines"));
  bindMachineContext();
  document.querySelectorAll("#machines [data-machine]").forEach((card) => {
    const m = S.machines[Number(card.dataset.machine)];
    card.insertAdjacentHTML("beforeend", AtlasHealth.badges(m));
    card.insertAdjacentHTML("beforeend", AtlasUI.machineDetails(m));
    card.querySelector(".atlas-machine-details").onclick = (event) =>
      event.stopPropagation();
    const details = card.querySelector(".atlas-machine-details"), facts = card.querySelector(".facts");
    details.append(facts);
    const heading = card.querySelector("h3"), choose = document.createElement("button");
    choose.type = "button";choose.className = "workspace-machine-select";choose.textContent = m.name;
    choose.setAttribute("aria-label", AtlasUI.supportsWindows(m) ? "Select machine " + m.name : "Select inventory device " + m.name);
    heading.replaceChildren(choose);
    card.classList.add("workspace-machine-row");
  });
  applyCompactWorkspace();
}
// Reuse the selected records and existing health snapshot across console pages.
// Rendering this sidebar never starts a directory lookup or a remote check.
function installSelectionSidebar() {
  const context = $("#selectionContext"), summary = $("#selectionSummary");
  if (!context || !summary || window.AtlasSelection) return;
  context.open = window.innerWidth > 760;
  summary.innerHTML = `<p class="selection-empty">Select a user or device in Workspace to keep their details here.</p>
    <section class="selection-card selection-user" aria-label="Selected user" hidden>
      <small class="selection-label">USER</small><button type="button" class="selection-name" data-selection-user><span class="selection-avatar" aria-hidden="true"></span><span class="selection-title"></span></button>
      <div class="selection-user-facts"></div>
    </section>
    <section class="selection-card selection-machine" aria-label="Selected device" hidden>
      <small class="selection-label">DEVICE</small><button type="button" class="selection-name" data-selection-machine><span class="selection-device-icon" aria-hidden="true">${AtlasUI.icon("admin")}</span><span class="selection-title"></span></button>
      <div class="selection-device-facts"></div><div class="selection-readings"></div>
      <p class="selection-checked"></p><button type="button" class="selection-scan">Scan health</button>
    </section>`;
  const person = summary.querySelector(".selection-user"), device = summary.querySelector(".selection-machine"),
    personButton = summary.querySelector("[data-selection-user]"), deviceButton = summary.querySelector("[data-selection-machine]"),
    scan = summary.querySelector(".selection-scan"), caption = $("#selectionCaption"), empty = summary.querySelector(".selection-empty");
  const text = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const rendered = new WeakMap();
  const html = (element, value) => {
    if (rendered.get(element) !== value) {element.innerHTML = value; rendered.set(element, value);}
  };
  const back = (selector) => {
    page("workspace");
    const host = typeof selector === "string" ? $(selector) : selector;
    host.querySelector("details")?.setAttribute("open", "");
    host.scrollIntoView({block: "center", behavior: AtlasUI.motion.isReduced() ? "instant" : "smooth"});
    host.querySelector("button, summary")?.focus({preventScroll: true});
  };
  personButton.onclick = () => back("#kyc");
  deviceButton.onclick = () => {
    const card = $$("#machines [data-machine]").find(node => String(S.machines[+node.dataset.machine]?.name || "").toUpperCase() === (S.selectedDevice || S.target));
    back(card || "#healthLine");
  };
  scan.onclick = () => { if (S.target && !window.AtlasReadOnly) refreshTargetHealth(); };
  function refresh() {
    if (!context.isConnected) return;
    const user = S.user, pc = S.selectedDevice || S.target;
    const record = S.machines.find(m => String(m.name || "").toUpperCase() === pc) || {name: pc};
    const windows = !!S.target && AtlasUI.supportsWindows(record), host = $("#healthLine");
    person.hidden = !user; device.hidden = !pc; empty.hidden = !!user || !!pc;
    text(caption, [user?.full_name || user?.name || user?.user_name, pc].filter(Boolean).join(" · "));
    if (user) {
      const name = user.full_name || user.name || user.user_name || "Selected user";
      text(personButton.querySelector(".selection-title"), name); personButton.title = "Open details for " + name;
      const words = String(name).trim().split(/\s+/);
      text(personButton.querySelector(".selection-avatar"), ((words[0][0] || "?") + (words.length > 1 ? words.at(-1)[0] : "")).toUpperCase());
      html(summary.querySelector(".selection-user-facts"), `<b class="selection-account">${esc(user.user_name || "Account not supplied")}</b>${user.email ? `<span class="selection-email" title="${esc(user.email)}">${esc(user.email)}</span>` : ""}<dl class="selection-meta">${[["Team", user.department || user.business_unit], ["Office", user.location]].filter(([, value]) => value).map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`);
    }
    if (!pc) return;
    text(deviceButton.querySelector(".selection-title"), pc); deviceButton.title = "Open stored details for " + pc;
    html(deviceButton.querySelector(".selection-device-icon"), AtlasUI.icon(["iphone", "phone", "tablet"].includes(AtlasUI.machineKind(record)) ? "phone" : "admin"));
    html(summary.querySelector(".selection-device-facts"), `<p>${esc(record.model_id || record.model_category || "Model not supplied")}</p>${record.asset_tag ? `<dl class="selection-meta"><div><dt>Asset</dt><dd>${esc(record.asset_tag)}</dd></div></dl>` : ""}${S.machines.includes(record) ? AtlasUI.machineBadges(record) : '<small>Hostname target · no inventory record</small>'}`);
    scan.hidden = !windows;
    if (!windows) {
      html(summary.querySelector(".selection-readings"), '<p class="selection-note">Inventory device · PC health checks unavailable.</p>');
      text(summary.querySelector(".selection-checked"), ""); return;
    }
    const readings = AtlasHealth.compact(host, S.target), specs = AtlasHealth.specifications(host, S.target);
    html(summary.querySelector(".selection-readings"), `<div class="selection-health-grid">${readings.filter(row => ["ping", "cshare", "storage", "system"].includes(row.key)).map(row => `<div class="${row.warning ? "warning" : row.text === "Available" ? "ready" : ""}" title="${esc(row.title)}"><b>${esc(row.key === "system" ? "Uptime" : row.label)}</b><span>${esc(row.key === "system" ? row.text.replace(/ uptime$/, "") : row.text)}</span></div>`).join("")}</div>${specs.length ? `<dl class="selection-specs">${specs.map(row => `<div${row.label === "CPU model" ? ' class="selection-spec-wide"' : ""}><dt>${esc(row.label === "Windows" ? "OS" : row.label)}</dt><dd>${esc(row.text)}</dd></div>`).join("")}</dl>` : ""}`);
    const dates = readings.map(row => row.checkedAt).filter(value => value && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(b) - Date.parse(a));
    const checking = !!host.querySelector("[data-health-refresh]:disabled");
    const checked = summary.querySelector(".selection-checked");
    text(checked, window.AtlasReadOnly ? "Stored inventory · live health requires Admin" : checking ? "Checking selected PC…" : dates.length ? "Last check · " + new Intl.DateTimeFormat(undefined, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}).format(new Date(dates[0])) : "No successful health check yet");
    checked.title = dates.length ? "Last check: " + new Date(dates[0]).toLocaleString() : "";
    scan.disabled = !!window.AtlasReadOnly || checking;
    scan.title = window.AtlasReadOnly?.reason || "Manually check connectivity and retrieve this PC's specifications";
    text(scan, checking ? "Checking…" : "Scan health");
  }
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true; queueMicrotask(() => {queued = false; refresh();});
  };
  // Watch only the existing health host, including check completion and failures.
  const observer = new MutationObserver(schedule);
  observer.observe($("#healthLine"), {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "class"]});
  window.addEventListener("pagehide", () => observer.disconnect(), {once: true});
  window.AtlasSelection = {refresh};
  refresh();
}
function targetPrefs() {
  return JSON.parse(localStorage.getItem("wmiTargetPrefs") || '{"recent":[]}');
}
function saveTargetPrefs(p) {
  localStorage.setItem("wmiTargetPrefs", JSON.stringify(p));
}
function rememberTarget(pc) {
  if (!pc) return;
  const p = targetPrefs();
  p.recent = [pc, ...p.recent.filter((x) => x !== pc)].slice(0, 10);
  saveTargetPrefs(p);
  renderRecentTargets();
}
function renderRecentTargets() {
  const host = document.querySelector("#recentTargets");
  if (!host) return;
  const values = targetPrefs().recent;
  host.innerHTML = values.length
    ? `<small>RECENT TARGETS</small><div class="recent-target-list">${values.map((x) => `<button data-recent-target="${esc(x)}">${esc(x)}</button>`).join("")}</div>`
    : "";
  document.querySelectorAll("[data-recent-target]").forEach(
    (b) =>
      (b.onclick = () => {
        setTarget(b.dataset.recentTarget, "Recent target");
        document.querySelector("#search").value = b.dataset.recentTarget;
      }),
  );
}
function supportSummary() {
  const u = S.user || {},
    m = (S.machines || []).find((x) => x.name === S.target) || {};
  return [
    `Timestamp: ${new Date().toLocaleString("en-GB")}`,
    `User: ${u.name || ""}`,
    `Username: ${u.user_name || ""}`,
    `Domain account: ${AtlasUI.domainAccount(u)}`,
    `Email: ${u.email || ""}`,
    `Location: ${u.location || ""}`,
    `Manager: ${u.manager || ""}`,
    `Target: ${S.target || ""}`,
    `Status: ${m.operational_status || ""}`,
    `Model: ${m.model_id || ""}`,
    `Serial: ${m.serial_number || ""}`,
    `Last discovered: ${m.last_discovered || ""}`,
  ].join("\n");
}
function machineContext(event, index) {
  event.preventDefault();
  event.stopPropagation();
  const m = S.machines[index],
    menu = document.querySelector("#machineMenu");
  if (!m || !menu) return;
  const windows = AtlasUI.supportsWindows(m);
  menu.replaceChildren();
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Actions for " + m.name);
  const close = () => menu.classList.add("hidden");
  const section = (label) => {
    const heading = document.createElement("div");
    heading.className = "atlas-context-section";
    heading.setAttribute("role", "presentation");
    heading.textContent = label;
    menu.append(heading);
  };
  const add = (cmd, label, run, select = true) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.cmd = cmd;
    button.setAttribute("role", "menuitem");
    button.tabIndex = -1;
    button.textContent = label;
    button.onclick = async () => {
      close();
      try {
        if (select) setTarget(m.name, m.operational_status, false);
        await run();
      } catch (error) {
        toast(error.message);
      }
    };
    menu.append(button);
    if (!windows && select) { button.disabled = true; button.title = "Windows tools require a PC"; }
    return button;
  };
  section("Active Directory");
  for (const action of AtlasContext.groupActions("computer", m.name, windows)) {
    const button = add(action.id, action.label, action.run, false);
    button.disabled = action.disabled;
    if (button.disabled) button.title = action.reason;
    if (action.id === "ad-groups") button.dataset.readonlyAllowed = "";
  }
  section("Target & inventory");
  add("target", "Set as target", () => {});
  add("health", "Refresh health", () => refreshTargetHealth());
  add("copy", "Copy device identity", () => copy(m.name, "Device identity"), false);
  add("details", "Copy machine details", () =>
    copy(JSON.stringify(m, null, 2), "Device details"), false,
  );
  add("inventory", "View inventory details", () => AtlasContext.inventory(m), false).dataset.readonlyAllowed = "";
  for (const [cmd, label, value] of [["copy-asset", "Copy asset tag", m.asset_tag], ["copy-serial", "Copy serial number", m.serial_number]]) {
    const button = add(cmd, label, () => AtlasContext.copy(value, label.slice(5)), false);
    button.dataset.readonlyAllowed = "";
    button.disabled = !value;
    if (!value) button.title = "Not supplied in this record";
  }
  section("Remote support");
  for (const [tool, label] of [
    ["msra", "Open MSRA"],
    ["rdp", "Remote Desktop"],
    ["compmgmt", "Computer Management"],
    ["eventvwr", "Event Viewer"],
    ["cshare", "Open C$"],
    ["temp", "Open C:\\Temp"],
    ["packages", "Open Packages"],
  ])
    add(tool, label, () => openTargetTool(tool));
  add(
    "remote-registry",
    "Enable Remote Registry",
    async () =>
      (await import("/service-actions.js")).openRemoteRegistry(m.name),
    false,
  );
  menu.querySelector('[data-cmd="remote-registry"]').disabled =
    !!window.AtlasReadOnly || !windows;
  add("admin", "Remote Admin", () => page("admin"));
  add("cpu", "Scan CPU & processes", () => {page("admin");selectPerformanceView("cpu");return admin("cpu");});
  add("memory", "Scan memory", () => {page("admin");selectPerformanceView("memory");return admin("memory");});
  add("services", "List services…", () => {page("admin");document.getElementById("adminServices").click();});
  section("Deployment");
  add("deploy", "Deploy software…", () => {page("workspace");openDeploymentPanel();document.getElementById("pkgSearch").focus();});
  add("queue", "Add deployment to queue", () => addQueue());
  add("clean", "Clean package folder", () => cleanPackages());
  section("Reports & diagnostics");
  add("specs", "View specifications", () => AtlasHealth.specs(m.name), false);
  menu.lastElementChild.disabled = !windows;
  add("software", "Software inventory", () => loadSoftware(m.name));
  add("report", "Copy device report", () =>
    copy(windows ? completeMachineReport() : AtlasUI.machineReport(m), "Device report"), windows,
  );
  menu.classList.remove("hidden");
  menu.scrollTop = 0;
  const gap = 8;
  menu.style.left = menu.style.top = gap + "px";
  // Measure after all actions are present, including the constrained height.
  const bounds = menu.getBoundingClientRect();
  const anchor = document.querySelector(`[data-machine="${index}"] .copyhost`)?.getBoundingClientRect();
  const x = Number.isFinite(event.clientX) ? event.clientX : anchor?.left || gap;
  const y = Number.isFinite(event.clientY) ? event.clientY : anchor?.bottom || gap;
  menu.style.left =
    Math.max(
      gap,
      Math.min(x, window.innerWidth - bounds.width - gap),
    ) + "px";
  menu.style.top =
    Math.max(
      gap,
      Math.min(y, window.innerHeight - bounds.height - gap),
    ) + "px";
  window.AtlasReadOnly?.enforce?.();
  const enabledButtons = () => [...menu.querySelectorAll("button")].filter(button => !button.disabled && button.getAttribute("aria-disabled") !== "true");
  menu.onkeydown = (e) => {
    const buttons = enabledButtons();
    const current = buttons.indexOf(document.activeElement);
    let next;
    if (e.key === "ArrowDown") next = (current + 1) % buttons.length;
    if (e.key === "ArrowUp")
      next = (current - 1 + buttons.length) % buttons.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = buttons.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      buttons[next].focus({ preventScroll: true });
      buttons[next].scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    if (e.key === "Escape" || e.key === "Tab") {
      close();
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const card = document.querySelector(`[data-machine="${index}"]`);
        card?.querySelector(".copyhost")?.focus({ preventScroll: true });
      }
    }
  };
  const first = enabledButtons()[0];
  first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: "nearest", behavior: "instant" });
  window.AtlasInteractions?.animateMenu(menu);
}
function bindMachineContext() {
  document
    .querySelectorAll("[data-machine]")
    .forEach(
      (card) => {
        card.oncontextmenu = e => machineContext(e, Number(card.dataset.machine));
        card.onkeydown = e => {
          if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))
            machineContext(e, Number(card.dataset.machine));
        };
      },
    );
}
function completeMachineReport() {
  const m = S.machines.find((x) => x.name === S.target) || {},
    u = S.user || {},
    inventory = softwareState.software.get(S.target);
  return [
    "Atlas machine report",
    "Generated: " + new Date().toLocaleString(),
    "Target: " + S.target,
    "User: " + (u.name || ""),
    "Account: " + (u.user_name || ""),
    "Domain account: " + AtlasUI.domainAccount(u),
    "Email: " + (u.email || ""),
    AtlasUI.machineReport({ ...m, name: S.target }),
    "Software inventory: " +
      (inventory
        ? inventory.software.length + " applications"
        : "not collected"),
    ...AtlasHealth.report($("#healthLine"), S.target),
  ].join("\n");
}
async function loadMasterStatus() {
  try {
    const d = await api("/api/master/status");
    masterState.status = d;
    const el = document.querySelector("#masterDbStatus");
    if (el)
      el.innerHTML = d.available
        ? `<b class="status-ok">MASTER DB ONLINE</b><span>${d.users.toLocaleString()} users</span><span>${d.machines.toLocaleString()} machines</span><span>${d.assignments.toLocaleString()} links</span>`
        : '<b class="status-bad">MASTER DB ERROR</b>';
  } catch (e) {
    console.warn("MasterDB status failed", e);
  }
}
function bindMasterDB() {
  loadMasterStatus();
}
function applyCompactWorkspace() {
  document.body.classList.add("compact-main-v301");

  const workspace = document.querySelector(
    '[data-page-content="workspace"], #workspace',
  );
  if (workspace) workspace.classList.add("compact-workspace");

  document
    .querySelectorAll("#kyc details, #machines details")
    .forEach((details) => {
      if (!details.hasAttribute("data-user-opened")) details.open = false;
      if (details.dataset.compactBound) return;
      details.dataset.compactBound = "1";
      details.addEventListener("toggle", () => {
        if (details.open) details.setAttribute("data-user-opened", "1");
      });
    });
}
