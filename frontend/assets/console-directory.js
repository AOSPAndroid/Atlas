function setTarget(pc, status = "") {
  pc = String(pc || "")
    .trim()
    .toUpperCase();
  if (!pc || pc === S.target) return;
  S.target = pc;
  syncDeploymentPanel();
  $("#deployTarget").textContent = pc;
  $("#adminPc").value = pc;
  $("#barTarget").textContent = pc;
  $("#barState").textContent = status;
  $("#targetBar").classList.remove("hidden");
  $$("[data-machine]").forEach((x) =>
    x.classList.toggle("selected", S.machines[+x.dataset.machine]?.name === pc),
  );
  rememberTarget(pc);
  refreshTargetHealth();
  refreshConsoleSummary();
  updatePackagePresence();
}
function clearLookup() {
  AtlasHealth.cancel($("#healthLine"));
  S.user = null;
  S.users = [];
  S.machines = [];
  S.target = "";
  syncDeploymentPanel();
  daasState.user = null;
  daasUserKey = "";
  masterState.resolution = null;
  $("#kyc").innerHTML = "";
  $("#users").innerHTML = "";
  $("#machines").innerHTML = "";
  $("#deployTarget").textContent = "Select a machine";
  $("#adminPc").value = "";
  $("#targetBar").classList.add("hidden");
  $("#healthLine").classList.add("hidden");
  $("#preflight").innerHTML = "";
  $("#packagePresence").innerHTML = "";
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
    toast("No matching users or machines");
}
function renderUsers() {
  if (!S.users.length) return ($("#users").innerHTML = "");
  $("#users").innerHTML =
    `<div class=panel><small>MATCHING USERS</small><div class=row>${S.users.map((u, i) => `<button data-user="${i}">${esc(u.name)} · ${esc(u.user_name)} · ${esc(u.location)}</button><button data-email="${i}">Copy email</button>`).join("")}</div></div>`;
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
  loadDaaSUser();
  renderMachines();
}
function renderKyc() {
  const u = S.user;
  $("#kyc").innerHTML = AtlasUI.person(u);
  const host = $("#kyc .usercard>div:last-child"),
    bar = document.createElement("div");
  bar.className = "copybar";
  for (const [label, value] of [
    ["Copy account", u.user_name],
    ["Copy email", u.email],
    ["Copy name", u.full_name || u.name],
    ["Copy summary", supportSummary()],
  ]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.onclick = () => copy(value, label.replace("Copy ", ""));
    bar.append(button);
  }
  host.append(bar);
  applyCompactWorkspace();
}
function renderMachines() {
  if (!S.machines.length) return ($("#machines").innerHTML = "");
  $("#machines").innerHTML =
    `<small>LINKED MACHINES · ${S.machines.length}</small><div class=machinegrid>${S.machines.map((m, i) => `<div class="card machine" data-machine="${i}"><button class=copyhost data-host="${i}">Copy</button><span class="state ${String(m.operational_status).toLowerCase() === "operational" ? "" : "bad"}">● ${esc(m.operational_status)}</span><h3>${esc(m.name)}</h3><div class=facts><span>Match<b>${esc(m.match_type || "Hostname")}</b></span><span>Model<b>${esc(m.model_id || "—")}</b></span><span>Inventory discovered<b>${esc(m.last_discovered || "Not supplied")}</b></span><span>Record updated<b>${esc(m.updated_on || "Not supplied")}</b></span></div></div>`).join("")}</div>`;
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
        copy(S.machines[+x.dataset.host].name, "Hostname");
      }),
  );
  if (S.machines.length === 1) {
    let m = S.machines[0];
    setTarget(m.name, m.operational_status);
  }
  bindMachineContext();
  document.querySelectorAll("#machines [data-machine]").forEach((card) => {
    const m = S.machines[Number(card.dataset.machine)];
    card.insertAdjacentHTML("beforeend", AtlasHealth.badges(m));
    card.insertAdjacentHTML("beforeend", AtlasUI.machineDetails(m));
    card.querySelector(".atlas-machine-details").onclick = (event) =>
      event.stopPropagation();
  });
  applyCompactWorkspace();
}
function installSupportDock() {
  if (document.querySelector("#supportDock")) return;
  const workspace = $("#workspace"),
    column = $(".lookup-column"),
    user = $("#kyc"),
    health = $("#healthLine");
  const dock = document.createElement("div");
  dock.id = "supportDock";
  dock.hidden = true;
  dock.setAttribute("aria-label", "Current person and machine health");
  dock.innerHTML =
    '<button type="button" class="support-person" aria-label="Return to full user details" hidden></button><div class="support-health" hidden><button type="button" class="support-health-title" aria-label="Return to full machine health"></button><div class="support-health-metrics"></div></div>';
  document.body.append(dock);
  const person = dock.querySelector(".support-person"),
    panel = dock.querySelector(".support-health"),
    heading = dock.querySelector(".support-health-title"),
    metrics = dock.querySelector(".support-health-metrics");
  const back = (element) => {
    element.style.scrollMarginTop = supportTop() + "px";
    element.scrollIntoView({
      block: "start",
      behavior: AtlasUI.motion.isReduced() ? "instant" : "smooth",
    });
    const focus = element.querySelector("button, summary");
    focus?.focus({ preventScroll: true });
  };
  person.onclick = () => back(user);
  heading.onclick = () => back(health);
  let frame = 0,
    lastPerson = "",
    lastHealth = "";
  const supportTop = () =>
    Math.max(
      0,
      document.querySelector(".atlas-app-header")?.getBoundingClientRect()
        .bottom || 0,
    ) + 12;
  function update() {
    frame = 0;
    const active = workspace.classList.contains("active"),
      top = supportTop();
    const showPerson =
      active &&
      !!S.user &&
      !!user.firstElementChild &&
      user.getBoundingClientRect().bottom <= top;
    const showHealth =
      active &&
      !!S.target &&
      !health.classList.contains("hidden") &&
      health.getBoundingClientRect().bottom <= top;
    person.hidden = !showPerson;
    panel.hidden = !showHealth;
    dock.hidden = !showPerson && !showHealth;
    if (dock.hidden) return;
    dock.style.top = top + "px";
    const bounds = column.getBoundingClientRect();
    dock.style.left = Math.max(8, bounds.left) + "px";
    dock.style.width = Math.min(bounds.width, window.innerWidth - 16) + "px";
    if (showPerson) {
      const u = S.user;
      const html = `<b>${esc(u.full_name || u.name || u.user_name)}</b><span>${esc([u.user_name, u.email].filter(Boolean).join(" · "))}</span><small>${esc([u.department || u.business_unit, u.location].filter(Boolean).join(" · "))}</small>`;
      if (html !== lastPerson) {
        person.innerHTML = html;
        lastPerson = html;
      }
    }
    if (showHealth) {
      heading.textContent = S.target + " · Health ↗";
      const html = (AtlasHealth.compact?.(health, S.target) || [])
        .map(
          (row) =>
            `<span class="${row.warning ? "warning" : ""}" title="${esc(row.title)}"><b>${esc(row.label)}</b> ${esc(row.text)}</span>`,
        )
        .join("");
      if (html !== lastHealth) {
        metrics.innerHTML = html;
        lastHealth = html;
      }
    }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("atlas-shell-resize", schedule);
  const observer = new MutationObserver(schedule);
  for (const host of [user, health, $("#deployTarget")])
    observer.observe(host, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  observer.observe(workspace, { attributes: true, attributeFilter: ["class"] });
  schedule();
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
  menu.replaceChildren();
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Actions for " + m.name);
  const close = () => menu.classList.add("hidden");
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
        const wasTarget = S.target === m.name.trim().toUpperCase();
        if (select) setTarget(m.name, m.operational_status);
        await run(wasTarget);
      } catch (error) {
        toast(error.message);
      }
    };
    menu.append(button);
  };
  add("target", "Set as target", () => {});
  add("health", "Refresh health", (wasTarget) => {
    // Selecting a different target already starts its health checks.
    if (wasTarget) return refreshTargetHealth();
  });
  add("copy", "Copy hostname", () => copy(m.name, "Hostname"));
  add("details", "Copy machine details", () =>
    copy(JSON.stringify(m, null, 2), "Machine details"),
  );
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
  add("admin", "Remote Admin", () => page("admin"));
  add("queue", "Add deployment to queue", () => addQueue());
  add("clean", "Clean package folder", () => cleanPackages());
  add("specs", "View specifications", () => AtlasHealth.specs(m.name), false);
  add("software", "Software inventory", () => loadSoftware(m.name));
  add("report", "Copy complete machine report", () =>
    copy(completeMachineReport(), "Machine report"),
  );
  menu.classList.remove("hidden");
  menu.scrollTop = 0;
  const gap = 8;
  menu.style.left = menu.style.top = gap + "px";
  // Measure after all actions are present, including the constrained height.
  const bounds = menu.getBoundingClientRect();
  menu.style.left =
    Math.max(
      gap,
      Math.min(event.clientX, window.innerWidth - bounds.width - gap),
    ) + "px";
  menu.style.top =
    Math.max(
      gap,
      Math.min(event.clientY, window.innerHeight - bounds.height - gap),
    ) + "px";
  const buttons = [...menu.querySelectorAll("button")];
  menu.onkeydown = (e) => {
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
  buttons[0].focus({ preventScroll: true });
}
function bindMachineContext() {
  document
    .querySelectorAll("[data-machine]")
    .forEach(
      (card) =>
        (card.oncontextmenu = (e) =>
          machineContext(e, Number(card.dataset.machine))),
    );
}
function daasValue(value) {
  return value === null || value === undefined || String(value).trim() === ""
    ? "—"
    : String(value);
}
function daasClass(value) {
  const text = String(value || "").toLowerCase();
  if (/online|registered|provisioned|complete|yes/.test(text))
    return "status-ok";
  if (/offline|unreachable|unregistered|remove|failed|no$/.test(text))
    return "status-bad";
  if (/unknown|maintenance|not in cloud|not provisioned/.test(text))
    return "status-warn";
  return "status-neutral";
}
function daasField(label, value, status = false) {
  return `<span><em>${esc(label)}</em><b class="${status ? daasClass(value) : ""}">${esc(daasValue(value))}</b></span>`;
}
function loadDaaSStatus() {}
function loadDaaSUser() {
  if (!S.user) return;
  const u = S.user;
  daasState.user = {
    matched: true,
    users: [
      {
        ...u,
        brid: u.employee_number,
        team: u.department,
        organisation_unit: u.organisational_unit,
        employee_job_description: u.job_role,
      },
    ],
    devices: S.machines,
  };
  renderDaaSUser();
  mergeUserDetailPanels();
  injectDomainAccount();
}
function renderDaaSUser() {
  const host = document.querySelector("#kyc .usercard>div:last-child");
  const old = document.querySelector("#daasUserDetails");
  if (old) old.remove();
  const d = daasState.user;
  if (!host || !d || !d.matched) return;
  const u = d.users[0] || {};
  const block = document.createElement("details");
  block.id = "daasUserDetails";
  block.className = "details daas-details";
  block.innerHTML = `<summary>DaaS user details <i>${d.devices.length} device${d.devices.length === 1 ? "" : "s"}</i></summary><div class="daas-grid">${daasField("BRID", u.brid)}${daasField("DaaS login", u.login_id)}${daasField("Team", u.team)}${daasField("Persona", u.persona)}${daasField("Organisation unit", u.organisation_unit)}${daasField("Corporate grade", u.corporate_grade)}${daasField("Job description", u.employee_job_description)}${daasField("BA2", u.ba2)}${daasField("BA3", u.ba3)}${daasField("BA4", u.ba4)}${daasField("BA5", u.ba5)}${daasField("BA6", u.ba6)}${daasField("Leaver", u.leaver, true)}${daasField("Out of office", u.out_of_office, true)}</div><div class="daas-device-list">${d.devices.map((x) => `<button data-daas-device="${esc(x.machine_name)}"><b>${esc(x.machine_name)}</b><span class="${daasClass(x.device_online)}">${esc(daasValue(x.device_online))}</span><span>${esc(daasValue(x.data_centre))}</span></button>`).join("")}</div>`;
  host.appendChild(block);
  block.querySelectorAll("[data-daas-device]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        setTarget(b.dataset.daasDevice, "DaaS device");
      }),
  );
}
function mergeUserDetailPanels() {
  const directory = document.querySelector(
    "#kyc details.details:not(.daas-details)",
  );
  const daas = document.querySelector("#daasUserDetails");
  if (!directory || !daas || directory.dataset.mergedDaas) return;
  const daasGrid = daas.querySelector(".daas-grid"),
    deviceList = daas.querySelector(".daas-device-list");
  if (daasGrid) {
    const section = document.createElement("div");
    section.className = "combined-detail-section";
    section.innerHTML = "<h4>DAAS</h4>";
    section.appendChild(daasGrid);
    if (deviceList) section.appendChild(deviceList);
    directory.appendChild(section);
    directory.querySelector("summary").childNodes[0].textContent =
      "User details ";
    directory.dataset.mergedDaas = "1";
    daas.remove();
  }
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
    "Email: " + (u.email || ""),
    AtlasUI.machineReport({ ...m, name: S.target }),
    "Software inventory: " +
      (inventory
        ? inventory.software.length + " applications"
        : "not collected"),
    ...AtlasHealth.report($("#healthLine"), S.target),
  ].join("\n");
}
function domainAccountFromDaaS() {
  const login =
    daasState?.user?.users?.[0]?.login_id || S.user?.user_name || "";
  if (!login) return "";
  return login.includes("\\") ? login : `INTRANET\\${login}`;
}
function injectDomainAccount() {
  const card = document.querySelector("#kyc .usercard");
  if (!card || card.querySelector(".domain-account-fact")) return;
  const login = domainAccountFromDaaS();
  if (!login) return;
  const facts = card.querySelector(".facts");
  if (facts) {
    const span = document.createElement("span");
    span.className = "domain-account-fact";
    span.innerHTML = `Domain account<b>${esc(login)}</b>`;
    facts.appendChild(span);
  }
  const bar = card.querySelector(".copybar");
  if (bar) {
    const b = document.createElement("button");
    b.textContent = "Copy domain account";
    b.onclick = () => copy(login, "Domain account");
    bar.appendChild(b);
  }
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
