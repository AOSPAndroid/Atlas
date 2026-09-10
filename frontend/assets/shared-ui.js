/* Shared display primitives and on-demand, read-only export inspection. */
(() => {
  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionKey = "atlas-motion";
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
  function installShell() {
    const header = document.querySelector("body > .atlas-app-header");
    if (!header) return;
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
  function person(user) {
    const name =
      user.full_name || user.name || user.user_name || "Unknown person";
    const facts = [
      ["Account", user.user_name || user.user_id],
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
        .map(([key, value]) => `<span>${esc(key)}<b>${esc(value)}</b></span>`)
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
  window.AtlasUI = {
    esc,
    person,
    machineDetails,
    machineReport,
    dialog,
    motion: {
      isReduced,
      install: motionControl,
      toggle: () => setMotion(isReduced()),
    },
  };
})();
