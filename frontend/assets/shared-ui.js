/* Shared display primitives and on-demand, read-only export inspection. */
(() => {
  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionKey = "atlas-motion";
  const displayKey = "atlas-display-mode";
  let displayChoice = "standard";
  try {
    displayChoice =
      localStorage.getItem(displayKey) === "citrix" ? "citrix" : "standard";
  } catch {}
  const isCitrix = () => displayChoice === "citrix";
  function applyDisplay() {
    document.documentElement.dataset.atlasDisplay = displayChoice;
    document
      .querySelectorAll(".atlas-display-mode select")
      .forEach((select) => {
        select.value = displayChoice;
      });
    window.dispatchEvent(new Event("atlas-display-change"));
    window.dispatchEvent(new Event("atlas-motion-change"));
  }
  function setDisplay(value) {
    displayChoice = value === "citrix" ? "citrix" : "standard";
    try {
      localStorage.setItem(displayKey, displayChoice);
    } catch {}
    applyDisplay();
  }
  document.documentElement.dataset.atlasDisplay = displayChoice;
  let motionChoice = "system";
  try {
    motionChoice = localStorage.getItem(motionKey) || "system";
  } catch {}
  const isReduced = () =>
    motionChoice === "reduce" ||
    (motionChoice !== "full" && motionMedia.matches);
  function applyMotion() {
    document.documentElement.dataset.atlasMotion = isReduced()
      ? "reduce"
      : "full";
    document.querySelectorAll(".atlas-motion-toggle").forEach((el) => {
      el.querySelector("input").checked = !isReduced();
      el.querySelector(".atlas-motion-state").textContent = isReduced()
        ? "Off"
        : "On";
    });
    window.dispatchEvent(new Event("atlas-motion-change"));
  }
  motionMedia.addEventListener?.("change", applyMotion);
  window.addEventListener("storage", (event) => {
    if (event.key === displayKey || event.key === null) {
      try {
        displayChoice =
          localStorage.getItem(displayKey) === "citrix" ? "citrix" : "standard";
      } catch {}
      applyDisplay();
    }
    if (event.key === motionKey || event.key === null) {
      try {
        motionChoice = localStorage.getItem(motionKey) || "system";
      } catch {}
      applyMotion();
    }
  });
  applyMotion();
  function setMotion(enabled) {
    motionChoice = enabled ? "full" : "reduce";
    try {
      localStorage.setItem(motionKey, motionChoice);
    } catch {}
    applyMotion();
  }
  const activeReveals = new Map();
  function reveal(
    element,
    { distance = 18, duration = 320, delay = 0, settle = false } = {},
  ) {
    activeReveals.get(element)?.cancel();
    if (
      isReduced() ||
      isCitrix() ||
      !element?.animate ||
      element.hidden ||
      document.hidden
    )
      return;
    // A panel entrance already moves its cards; don't stack scroll effects inside it.
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (activeReveals.has(parent)) return;
    // If a panel opens after its cards appeared, replace their entrances with one motion.
    for (const [child, animation] of activeReveals)
      if (element.contains(child)) animation.cancel();
    const frames = settle
      ? [
          {
            opacity: 0.2,
            transform: `translateY(${distance}px) scale(0.985)`,
            offset: 0,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
          {
            opacity: 1,
            transform: "translateY(-2px) scale(1)",
            offset: 0.78,
            easing: "ease-in-out",
          },
          { opacity: 1, transform: "translateY(0) scale(1)", offset: 1 },
        ]
      : [
          { opacity: 0.3, transform: `translateY(${distance}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ];
    const animation = element.animate(frames, {
      duration,
      delay,
      fill: "backwards",
      easing: settle ? "linear" : "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    activeReveals.set(element, animation);
    const clear = () => {
      if (activeReveals.get(element) === animation)
        activeReveals.delete(element);
    };
    animation.onfinish = clear;
    animation.oncancel = clear;
  }
  const slideUp = (element) =>
    reveal(element, { distance: 58, duration: 440, settle: true });
  const clearReveals = () => {
    for (const animation of activeReveals.values()) animation.cancel();
    activeReveals.clear();
  };
  window.addEventListener("atlas-motion-change", () => {
    if (isReduced() || isCitrix()) clearReveals();
  });
  window.addEventListener("pagehide", clearReveals);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearReveals();
  });
  function installScrollReveals() {
    if (typeof IntersectionObserver === "undefined") return;
    const selector =
      ".machine, .ops-machine, .viewer-machine, .atlas-person, .atlas-health-item, .deployment-monitor-card";
    const seen = new WeakSet(),
      observed = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        let animated = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          observed.delete(entry.target);
          seen.add(entry.target);
          // Limit simultaneous effects when a long result list first appears.
          if (animated < 6) reveal(entry.target, { delay: animated++ * 32 });
        }
      },
      { threshold: 0.08 },
    );
    const scan = (node, removed = false) => {
      if (node.nodeType !== 1) return;
      const elements = [
        ...(node.matches(selector) ? [node] : []),
        ...node.querySelectorAll(selector),
      ];
      for (const element of elements) {
        if (removed) {
          observer.unobserve(element);
          observed.delete(element);
          activeReveals.get(element)?.cancel();
        } else if (!seen.has(element) && !observed.has(element)) {
          observed.add(element);
          observer.observe(element);
        }
      }
    };
    const changes = new MutationObserver((records) => {
      for (const record of records) {
        record.removedNodes.forEach((node) => scan(node, true));
        record.addedNodes.forEach((node) => scan(node));
      }
    });
    const stop = () => {
      observer.disconnect();
      changes.disconnect();
      observed.clear();
    };
    const sync = () => {
      stop();
      if (isReduced() || isCitrix()) return;
      scan(document.body);
      changes.observe(document.body, { childList: true, subtree: true });
    };
    window.addEventListener("atlas-motion-change", sync);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", sync);
    sync();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", installScrollReveals, {
      once: true,
    });
  else installScrollReveals();
  function installShell() {
    const header = document.querySelector("body > .atlas-app-header");
    if (!header) return;
    const actions = header.querySelector(".atlas-header-actions");
    if (actions && !actions.querySelector(".atlas-display-mode")) {
      const label = document.createElement("label");
      label.className = "atlas-display-mode";
      label.textContent = "Display ";
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Display mode");
      select.title =
        "Citrix / remote: lighter 3D movement and fewer interface effects. Does not change permissions or start scans.";
      for (const [value, text] of [
        ["standard", "Standard"],
        ["citrix", "Citrix / remote"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      select.value = displayChoice;
      select.onchange = () => setDisplay(select.value);
      label.append(select);
      actions.append(label);
    }
    const more = header.querySelector(".atlas-header-more");
    if (more) {
      document.addEventListener("click", (event) => {
        if (!more.contains(event.target) || event.target.closest("button"))
          more.open = false;
      });
      more.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          more.open = false;
          more.querySelector("summary").focus();
        }
      });
    }
    const measure = () => {
      const height = header.getBoundingClientRect().height;
      if (height)
        document.documentElement.style.setProperty(
          "--atlas-header-height",
          height + "px",
        );
      window.dispatchEvent(new Event("atlas-shell-resize"));
    };
    if (typeof ResizeObserver !== "undefined")
      new ResizeObserver(measure).observe(header);
    else window.addEventListener("resize", measure, { passive: true });
    measure();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", installShell, { once: true });
  else installShell();
  function motionControl(parent) {
    if (!parent || parent.querySelector(".atlas-motion-toggle")) return;
    const label = document.createElement("label");
    label.className = "atlas-motion-toggle";
    label.title = "Enable or disable map and interface animations.";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    input.setAttribute("aria-label", "Animations");
    input.checked = !isReduced();
    const track = document.createElement("span");
    track.className = "atlas-motion-track";
    track.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = "Animations";
    const state = document.createElement("span");
    state.className = "atlas-motion-state";
    state.setAttribute("aria-hidden", "true");
    state.textContent = isReduced() ? "Off" : "On";
    input.onchange = () => setMotion(input.checked);
    label.append(input, track, text, state);
    parent.append(label);
  }
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function domainAccount(user) {
    const login = String(
      user?.login_id || user?.user_name || user?.user_id || "",
    ).trim();
    return !login ? "" : login.includes("\\") ? login : `INTRANET\\${login}`;
  }
  function person(user) {
    const name =
      user.full_name || user.name || user.user_name || "Unknown person";
    const facts = [
      ["Account", user.user_name || user.user_id],
      ["Domain account", domainAccount(user)],
      ["Email", user.email],
      ["Department", user.department],
      ["Office", user.location],
      ["Job title", user.job_role || user.job_title],
      ["Manager", user.manager],
    ];
    const supplied = (value) =>
      value !== null && value !== undefined && String(value).trim() !== "";
    const account = user.user_name || user.user_id || "",
      employee = user.employee_number || user.employee_id,
      loginTime = exportDate(user.last_login_time),
      loginDate = exportDate(user.last_login),
      lastLogin = loginTime || loginDate;
    const sections = [
      [
        "Organisation",
        [
          ["Business unit", user.business_unit],
          ["Organisation unit", user.organisational_unit || user.organisation],
          ["Worker type", user.job_type || user.worker_type],
          [
            "Start date",
            String(exportDate(user.start_date) || "").replace(/ 00:00:00$/, ""),
          ],
        ],
      ],
      [
        "Account activity",
        [
          [
            "Employee ID",
            String(employee || "").toLowerCase() !==
            String(account).toLowerCase()
              ? employee
              : "",
          ],
          ["Last recorded login", lastLogin || "Not supplied"],
          [
            "Login date in export",
            loginTime &&
            loginDate &&
            !String(loginTime).startsWith(String(loginDate).slice(0, 10))
              ? loginDate
              : "",
          ],
        ],
      ],
    ]
      .map(([title, rows]) => [
        title,
        rows.filter(([, value]) => supplied(value)),
      ])
      .filter(([, rows]) => rows.length);
    const fields = (rows) =>
      rows
        .filter(([, value]) => supplied(value))
        .map(
          ([key, value]) =>
            `<span${key === "Domain account" ? ' class="domain-account-fact"' : ""}>${esc(key)}<b>${esc(value)}</b></span>`,
        )
        .join("");
    const grouped = sections
      .map(
        ([title, rows]) =>
          `<section><h3>${esc(title)}</h3><dl>${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>${title === "Account activity" ? '<p class="atlas-person-source">From the directory export, not a live sign-in check.</p>' : ""}</section>`,
      )
      .join("");
    const related = [
      ["Find manager", "user", user.manager],
      ["Same department", "department", user.department],
      ["Same office", "location", user.location],
    ]
      .filter(([, , value]) => supplied(value))
      .map(
        ([label, prefix, value]) =>
          `<button type="button" data-person-search="${esc(prefix + ":" + value)}" title="${esc(value)}">${esc(label)}</button>`,
      )
      .join("");
    return `<div class="card usercard atlas-person"><div class="avatar">${esc(
      name
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join(""),
    )}</div><div><h2>${esc(name)}</h2><div class="facts">${fields(facts)}</div><details class="details atlas-person-details"><summary>User details</summary><div class="atlas-person-detail-sections">${grouped}</div>${related ? `<div class="atlas-person-related" role="group" aria-label="Related people">${related}</div>` : ""}${exportButton("user", user.canonical_key)}</details></div></div>`;
  }
  function exportDate(value) {
    if (value === null || value === undefined || String(value).trim() === "")
      return value;
    if (!/^\d+(\.\d+)?$/.test(String(value))) return value;
    const serial = Number(value);
    if (serial > 2958465) return value;
    const date = new Date(
      Date.UTC(1899, 11, 30) + Math.round(serial * 86400) * 1000,
    );
    return serial < 1
      ? date.toISOString().slice(11, 19)
      : date.toISOString().slice(0, 19).replace("T", " ");
  }
  function exportButton(kind, key) {
    return key
      ? `<button type="button" class="atlas-export-button" data-export-kind="${esc(kind)}" data-export-key="${esc(key)}">All export fields</button>`
      : "";
  }
  // Only fields actually supplied by the directory export. No live-state aliases.
  function machineSections(machine) {
    const supplied = (value) =>
      value !== null && value !== undefined && String(value).trim() !== "";
    return [
      [
        "Identity",
        [
          ["Infrastructure", machine.infrastructure_itsi],
          ["Manufacturer", machine.manufacturer],
          ["Model", machine.model_id],
          ["Serial number", machine.serial_number],
          ["Correlation ID", machine.correlation_id],
          ["Record class", machine.sys_class_name],
          ["Description", machine.short_description],
        ],
      ],
      [
        "Ownership",
        [
          ["Assigned to", machine.assigned_to || "Not supplied"],
          ["Last logged-on user", machine.last_logon_user || "Not supplied"],
        ],
      ],
      [
        "Discovery",
        [
          ["Inventory status", machine.operational_status],
          ["Discovery source", machine.discovery_source],
          ["Last discovered", machine.last_discovered],
          ["Record updated", machine.updated_on],
        ],
      ],
    ]
      .map(([title, fields]) => [
        title,
        fields.filter(([, value]) => supplied(value)),
      ])
      .filter(([, fields]) => fields.length);
  }
  const machineNote =
    "Stored inventory. Status and last logged-on user do not confirm current connectivity or sign-in.";
  function machineDetails(machine, { open = false } = {}) {
    const sections = machineSections(machine)
      .map(
        ([title, fields]) =>
          `<section><h4>${esc(title)}</h4><dl>${fields
            .map(
              ([label, value]) =>
                `<div${["Infrastructure", "Serial number", "Description"].includes(label) ? ' class="atlas-machine-wide"' : ""}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
            )
            .join("")}</dl></section>`,
      )
      .join("");
    return `<details class="atlas-machine-details"${open ? " open" : ""}><summary>Machine details</summary><div class="atlas-machine-inventory"><p>${machineNote}</p>${sections}${exportButton("machine", machine.machine_name_norm || String(machine.name || machine.machine_name || "").toLowerCase())}</div></details>`;
  }
  function machineReport(machine) {
    return [
      "Stored machine details",
      "Machine: " + (machine.name || machine.machine_name || "Not supplied"),
      machineNote,
      ...machineSections(machine).flatMap(([title, fields]) => [
        "",
        title,
        ...fields.map(([label, value]) => `${label}: ${value}`),
      ]),
    ].join("\n");
  }
  function dialog(title) {
    const previous =
        document.activeElement?.shadowRoot?.activeElement ||
        document.activeElement,
      element = document.createElement("dialog");
    element.className = "atlas-dialog";
    element.setAttribute("aria-label", title);
    const heading = document.createElement("h2");
    heading.textContent = title;
    const close = document.createElement("button");
    close.textContent = "Close";
    close.setAttribute("aria-label", "Close " + title.toLowerCase());
    close.onclick = () => element.close();
    const header = document.createElement("header");
    header.append(heading, close);
    const body = document.createElement("div");
    body.className = "atlas-dialog-body";
    element.append(header, body);
    element.addEventListener(
      "close",
      () => {
        element.remove();
        previous?.focus();
      },
      { once: true },
    );
    document.body.append(element);
    element.showModal();
    return { element, body };
  }
  document.addEventListener(
    "click",
    async (event) => {
      const related = event.target.closest?.("[data-person-search]");
      if (related) {
        event.stopPropagation();
        related.dispatchEvent(
          new CustomEvent("atlas-directory-search", {
            bubbles: true,
            detail: { query: related.dataset.personSearch },
          }),
        );
        return;
      }
      const button = event.target.closest?.("[data-export-kind]");
      if (!button) return;
      event.stopPropagation();
      const { element, body } = dialog("All export fields"),
        controller = new AbortController();
      element.classList.add("atlas-export-dialog");
      element.addEventListener("close", () => controller.abort(), {
        once: true,
      });
      body.textContent = "Loading stored fields…";
      try {
        const query = new URLSearchParams({
          kind: button.dataset.exportKind,
          key: button.dataset.exportKey,
        });
        const response = await fetch("/api/directory/record?" + query, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok)
          throw Error(data.detail || "Export fields unavailable");
        if (!element.open) return;
        body.innerHTML = `<h3>${esc(data.name)}</h3><p>${esc(data.original_cells ? `${data.source} · ${data.sheet} · row ${data.row}` : "Stored directory fields. Refresh the directory export to retain original cells and any additional columns.")}</p>${data.restricted_columns ? "<p>Additional export columns are available in the admin version.</p>" : ""}<label>Find a field<input type="search" aria-label="Find an export field" placeholder="Name or value…"></label><p class="atlas-export-count" role="status"></p><div class="atlas-export-fields"></div><button type="button" class="atlas-export-copy">Copy all fields</button>`;
        const valueOf = (field) => {
          const value = field.stored_value ?? field.value;
          return [
            "start_date",
            "last_login",
            "last_login_time",
            "updated_on",
            "last_discovered",
          ].includes(field.field)
            ? exportDate(value)
            : value;
        };
        const render = () => {
          const q = body.querySelector("input").value.trim().toLowerCase();
          const fields = data.fields.filter((f) =>
            [f.header, f.label, f.value, valueOf(f)].some((v) =>
              String(v ?? "")
                .toLowerCase()
                .includes(q),
            ),
          );
          body.querySelector(".atlas-export-count").textContent =
            `${fields.length} of ${data.fields.length} fields`;
          body.querySelector(".atlas-export-fields").innerHTML = fields
            .map((f) => {
              const value = valueOf(f),
                blank = value === null || value === undefined || value === "";
              return `<article><b>${esc(f.label)}</b><small>${esc(f.header)}</small><div>${blank ? "Not supplied" : esc(value)}</div>${data.original_cells && String(value ?? "") !== String(f.value ?? "") ? `<small>Export value: ${esc(f.value)}</small>` : ""}</article>`;
            })
            .join("");
        };
        body.querySelector("input").oninput = render;
        body.querySelector(".atlas-export-copy").onclick = async () => {
          try {
            const lines = [
              data.name,
              data.source,
              ...data.fields.map(
                (f) =>
                  `${f.header}: ${valueOf(f) ?? ""}${data.original_cells && String(valueOf(f) ?? "") !== String(f.value ?? "") ? ` (export: ${f.value})` : ""}`,
              ),
            ];
            await navigator.clipboard.writeText(lines.join("\n"));
            body.querySelector(".atlas-export-count").textContent =
              "All fields copied";
          } catch {
            body.querySelector(".atlas-export-count").textContent =
              "Clipboard unavailable. Select and copy the fields.";
          }
        };
        render();
      } catch (error) {
        if (element.open && error.name !== "AbortError")
          body.textContent = error.message;
      }
    },
    true,
  );
  function machineKind(machine) {
    const name = String(machine.name || machine.machine_name || "")
      .trim()
      .toUpperCase()
      .split(".")[0];
    // The K belongs to PWMK, not the country prefix (e.g. NYK).
    if (/^[A-Z]{3}PWMK/.test(name)) return "kiosk";
    if (name.includes("VDI")) return "vdi";
    if (/^[A-Z]{3}PWMF/.test(name)) return "desktop";
    return "other";
  }
  function machineFilters(host) {
    if (!host || host.querySelector(":scope > .atlas-machine-filters")) return;
    const rows = [...host.querySelectorAll("[data-machine-kind]")];
    if (!rows.length) return;
    const types = [
      ["all", "All"],
      ["desktop", "Dedicated desktops"],
      ["vdi", "VDI"],
      ["kiosk", "Kiosks"],
      ["other", "Other"],
    ];
    const bar = document.createElement("div");
    bar.className = "atlas-machine-filters";
    bar.innerHTML =
      '<div role="group" aria-label="Filter machine types"></div><small aria-live="polite"></small>';
    const group = bar.firstElementChild,
      status = bar.lastElementChild;
    const selected = new Set();
    const empty = document.createElement("p");
    empty.className = "atlas-machine-filter-empty";
    empty.textContent =
      "No machines match these filters. Choose All to show every linked machine.";
    empty.hidden = true;
    host.prepend(bar);
    host.append(empty);
    const update = () => {
      for (const row of rows)
        row.hidden =
          selected.size > 0 && !selected.has(row.dataset.machineKind);
      for (const button of group.children)
        button.setAttribute(
          "aria-pressed",
          button.dataset.kind === "all"
            ? !selected.size
            : selected.has(button.dataset.kind),
        );
      const count = rows.filter((row) => !row.hidden).length;
      status.textContent = `${count} of ${rows.length} machines · Select one or more types`;
      empty.hidden = count > 0;
      for (const section of host.querySelectorAll(".ops-machine-group")) {
        const visible = [
          ...section.querySelectorAll("[data-machine-kind]"),
        ].filter((row) => !row.hidden).length;
        section.hidden = !visible;
        const countLabel = section.querySelector("h4 span");
        if (countLabel) countLabel.textContent = visible;
      }
    };
    for (const [kind, label] of types) {
      const count =
        kind === "all"
          ? rows.length
          : rows.filter((row) => row.dataset.machineKind === kind).length;
      if (kind === "other" && !count) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.kind = kind;
      button.textContent = `${label} (${count})`;
      button.disabled = !count;
      button.title =
        kind === "other"
          ? "Hostnames outside the confirmed PWMF, PWMK and VDI patterns"
          : "Filter this machine list; the selected target stays unchanged";
      button.onclick = () => {
        if (kind === "all") selected.clear();
        else if (selected.has(kind)) selected.delete(kind);
        else selected.add(kind);
        update();
      };
      group.append(button);
    }
    update();
  }
  window.AtlasUI = {
    machineKind,
    machineFilters,
    esc,
    person,
    domainAccount,
    machineDetails,
    machineReport,
    dialog,
    performance: { isCitrix, setDisplay },
    motion: {
      isReduced,
      reveal,
      slideUp,
      install: motionControl,
      toggle: () => setMotion(isReduced()),
    },
  };
})();
