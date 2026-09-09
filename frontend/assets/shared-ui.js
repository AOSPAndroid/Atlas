/* Shared display primitives. This module performs no network or privileged actions. */
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
      ["Team", user.department || user.business_unit],
      ["Office", user.location],
      ["Job title", user.job_role || user.job_title],
      ["Manager", user.manager],
    ];
    const details = [
      ["Employee ID", user.employee_number || user.employee_id],
      ["Organisation", user.organisational_unit || user.organisation],
      ["Worker type", user.job_type || user.worker_type],
      ["Start date", user.start_date],
      ["Last login", user.last_login],
      ["Last login time", user.last_login_time],
    ];
    const fields = (rows) =>
      rows
        .filter(([, value]) => value)
        .map(([key, value]) => `<span>${esc(key)}<b>${esc(value)}</b></span>`)
        .join("");
    return `<div class="card usercard atlas-person"><div class="avatar">${esc(
      name
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join(""),
    )}</div><div><h2>${esc(name)}</h2><div class="facts">${fields(facts)}</div><details class="details"><summary>Person details</summary><div class="detailgrid">${fields(details)}</div></details></div></div>`;
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
    return `<details class="atlas-machine-details"${open ? " open" : ""}><summary>Machine details</summary><div class="atlas-machine-inventory"><p>${machineNote}</p>${sections}</div></details>`;
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
