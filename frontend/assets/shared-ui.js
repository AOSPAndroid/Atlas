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
    document.querySelectorAll(".atlas-motion-select").forEach((el) => {
      el.value = motionChoice;
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
  function motionControl(parent) {
    if (!parent || parent.querySelector(".atlas-motion-select")) return;
    const select = document.createElement("select");
    select.className = "atlas-motion-select";
    select.setAttribute("aria-label", "Animations");
    select.title =
      "Map and interface animations. System follows your accessibility preference.";
    for (const [value, text] of [
      ["system", "Motion: System"],
      ["full", "Motion: On"],
      ["reduce", "Motion: Off"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    select.value = motionChoice;
    select.onchange = () => {
      motionChoice = select.value;
      try {
        localStorage.setItem(motionKey, motionChoice);
      } catch {}
      applyMotion();
    };
    parent.append(select);
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
  function dialog(title) {
    const previous = document.activeElement,
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
    dialog,
    motion: { isReduced, install: motionControl },
  };
})();
