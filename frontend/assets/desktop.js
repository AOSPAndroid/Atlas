(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    apps = {
      map: {
        title: "Map",
        url: "/",
        colors: ["#45d0dc", "#0877a6"],
        icon: '<path d="m3 6 8-3 10 3 8-3v23l-8 3-10-3-8 3Z M11 3v23 M21 6v23"/>',
      },
      workspace: {
        title: "Workspace",
        url: "/installer",
        colors: ["#74aaf7", "#3654b9"],
        icon: '<rect x="3" y="5" width="26" height="19" rx="3"/><path d="M10 29h12 M16 24v5 m-7-17 4 4-4 4 m8 0h6"/>',
      },
      knowledge: {
        title: "Knowledge Base",
        url: "/installer?command=knowledge",
        colors: ["#ffb25c", "#df6139"],
        icon: '<rect x="11" y="2" width="10" height="8" rx="2"/><rect x="1" y="23" width="10" height="7" rx="2"/><rect x="21" y="23" width="10" height="7" rx="2"/><path d="M16 10v7 M6 23v-6h20v6"/>',
      },
    };
  const utilities = {
    calendar: [
      "Calendar",
      "#ff747b",
      "#d33c4a",
      '<rect x="3" y="5" width="26" height="24" rx="4"/><path d="M3 12h26 M10 2v7 M22 2v7 M10 19h4 M19 19h4 M10 24h4"/>',
    ],
    notes: [
      "Notes",
      "#ffe184",
      "#d5a72b",
      '<rect x="4" y="3" width="24" height="26" rx="3"/><path d="M4 11h24 M10 17h12 M10 22h9"/>',
    ],
    reminders: [
      "Reminders",
      "#c3b2f6",
      "#7763b4",
      '<rect x="4" y="3" width="24" height="26" rx="4"/><path d="m8 11 2 2 3-4 M16 11h7 m-15 9 2 2 3-4 M16 20h7"/>',
    ],
    calculator: [
      "Calculator",
      "#ffbb66",
      "#c87725",
      '<rect x="6" y="2" width="20" height="28" rx="4"/><path d="M10 7h12 M10 15h3 M19 15h3 M10 22h3 M19 22h3"/>',
    ],
    clock: [
      "Clock",
      "#65798f",
      "#243346",
      '<circle cx="16" cy="16" r="13"/><path d="M16 7v10l6 3"/>',
    ],
    files: [
      "Files",
      "#77cffa",
      "#347cad",
      '<path d="M3 9V5h10l4 4h12v18H3Z"/>',
    ],
    music: [
      "Music",
      "#fa88af",
      "#b54676",
      '<path d="M12 25V8l14-3v17 M12 12l14-3"/><ellipse cx="8" cy="25" rx="4" ry="3"/><ellipse cx="22" cy="22" rx="4" ry="3"/>',
    ],
  };
  for (const [id, [title, a, b, icon]] of Object.entries(utilities))
    apps[id] = {
      title,
      colors: [a, b],
      icon,
      utility: true,
      url: "/assets/desktop-utility.html?app=" + id,
    };
  const windows = new Map();
  let active = null,
    z = 10,
    drag = null,
    raf = 0,
    statusTimer,
    settings = { multi: true, rects: {} };
  try {
    const saved = JSON.parse(
      localStorage.getItem("atlas-desktop-settings") || "{}",
    );
    if (typeof saved.multi === "boolean") settings.multi = saved.multi;
    if (saved.rects && typeof saved.rects === "object")
      settings.rects = saved.rects;
  } catch {}
  const multi = () => settings.multi && innerWidth >= 760;
  function persist() {
    try {
      localStorage.setItem("atlas-desktop-settings", JSON.stringify(settings));
    } catch {}
  }
  function notice(text) {
    $("#desktopStatus").textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(
      () => ($("#desktopStatus").textContent = ""),
      3500,
    );
  }
  function bounds() {
    return {
      w: $("#desktopArea").clientWidth,
      h: $("#desktopArea").clientHeight,
    };
  }
  function constrain(r) {
    const b = bounds(),
      w = Math.max(Math.min(480, b.w), Math.min(r.w, b.w)),
      h = Math.max(Math.min(300, b.h), Math.min(r.h, b.h));
    return {
      x: Math.max(0, Math.min(r.x, b.w - w)),
      y: Math.max(0, Math.min(r.y, b.h - h)),
      w,
      h,
    };
  }
  function defaults(index) {
    const b = bounds();
    return constrain({
      x: 35 + index * 34,
      y: 25 + index * 25,
      w: Math.min(1120, b.w - 90),
      h: Math.min(780, b.h - 65),
    });
  }
  function rectFor(id, index) {
    const r = settings.rects[id];
    return r && ["x", "y", "w", "h"].every((k) => Number.isFinite(r[k]))
      ? constrain(r)
      : defaults(index);
  }
  function post(win, message) {
    win.frame.contentWindow?.postMessage(
      { atlasDesktop: true, ...message },
      location.origin,
    );
  }
  function paint(win) {
    const b = bounds(),
      r =
        !multi() || win.max
          ? { x: 8, y: 8, w: b.w - 16, h: b.h - 16 }
          : win.rect;
    Object.assign(win.el.style, {
      left: r.x + "px",
      top: r.y + "px",
      width: r.w + "px",
      height: r.h + "px",
      zIndex: win.z,
    });
    win.el.classList.toggle("active", win.id === active);
    win.el.hidden = win.minimized || (!multi() && win.id !== active);
    post(win, { type: "visibility", visible: !win.el.hidden });
  }
  function refresh() {
    document.body.classList.toggle("single-mode", !multi());
    $("#multitask").checked = settings.multi;
    $("#modeHint").textContent =
      innerWidth < 760
        ? "Compact screen: one app at a time. Your multitasking preference is kept."
        : multi()
          ? "Drag a title bar. Double-click to maximize."
          : "One active app. Other apps keep their state.";
    for (const win of windows.values()) paint(win);
    for (const button of document.querySelectorAll("[data-app]")) {
      const win = windows.get(button.dataset.app);
      button.classList.toggle("open", !!win);
      button.classList.toggle("active", active === button.dataset.app);
      button.setAttribute(
        "aria-pressed",
        String(active === button.dataset.app),
      );
    }
    $("#activeApp").textContent = active ? apps[active].title : "Desktop";
  }
  window.addEventListener("atlas-shell-resize", refresh);
  function activate(id) {
    const win = windows.get(id);
    if (!win) return;
    active = id;
    win.minimized = false;
    if (z > 900) {
      [...windows.values()]
        .sort((a, b) => a.z - b.z)
        .forEach((w, i) => (w.z = i + 1));
      z = windows.size + 1;
    }
    win.z = ++z;
    refresh();
  }
  function hide(id) {
    const win = windows.get(id);
    win.minimized = true;
    if (active === id)
      active =
        [...windows.values()]
          .filter((w) => !w.minimized)
          .sort((a, b) => b.z - a.z)[0]?.id || null;
    refresh();
  }
  function maximize(win) {
    if (!multi()) return;
    win.max = !win.max;
    activate(win.id);
  }
  function saveRect(win) {
    settings.rects[win.id] = win.rect;
    persist();
  }
  function snap(win, side) {
    if (!multi()) return;
    const b = bounds();
    win.max = false;
    win.rect = { x: side === "left" ? 0 : b.w / 2, y: 0, w: b.w / 2, h: b.h };
    saveRect(win);
    activate(win.id);
  }
  function safeRoute(raw) {
    try {
      const u = new URL(raw, location.origin);
      if (
        u.origin !== location.origin ||
        !["/", "/installer", "/installer/"].includes(u.pathname)
      )
        return null;
      const id =
        u.pathname === "/"
          ? "map"
          : u.searchParams.get("command") === "knowledge" ||
              u.searchParams.get("command")?.startsWith("kb-") ||
              u.hash === "#knowledge"
            ? "knowledge"
            : "workspace";
      u.searchParams.set("atlasWindow", id);
      return { id, url: u.pathname + u.search + u.hash };
    } catch {
      return null;
    }
  }
  function open(id, route) {
    if (!apps[id]) return;
    let win = windows.get(id);
    if (win) {
      activate(id);
      if (route && new URL(route, location.origin).search)
        post(win, { type: "navigate", url: route });
      return;
    }
    const el = document.createElement("section");
    el.className = "desktop-window";
    el.setAttribute("aria-label", apps[id].title + " window");
    el.dataset.appWindow = id;
    el.innerHTML = `<div class="window-bar" tabindex="0" aria-label="Move ${apps[id].title} window. Arrow keys move, Shift arrows resize."><div class="traffic"><button data-window="hide" aria-label="Hide ${apps[id].title} window" title="Hide window · keeps your work open"><span>×</span></button><button data-window="minimize" aria-label="Minimize ${apps[id].title}" title="Minimize to dock"><span>−</span></button><button data-window="maximize" aria-label="Maximize or restore ${apps[id].title}" title="Maximize / restore"><span>+</span></button></div><span class="window-title">${apps[id].title}</span><div class="window-tools"><button data-window="left" title="Snap left" aria-label="Snap ${apps[id].title} left">◧</button><button data-window="right" title="Snap right" aria-label="Snap ${apps[id].title} right">◨</button></div></div><div class="window-body"><iframe title="Atlas ${apps[id].title}" allow="clipboard-write" referrerpolicy="same-origin"></iframe><div class="window-loading"><strong>${apps[id].title}</strong><span>Opening your workspace…</span></div><button class="window-activate" aria-label="Activate ${apps[id].title}"></button></div>${["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((edge) => `<div class="resize-handle" data-edge="${edge}"></div>`).join("")}`;
    win = {
      id,
      el,
      frame: el.querySelector("iframe"),
      rect: rectFor(id, windows.size),
      max: false,
      minimized: false,
      z: ++z,
    };
    windows.set(id, win);
    $("#windows").append(el);
    win.frame.dataset.atlasApp = id;
    win.frame.src = apps[id].utility
      ? apps[id].url
      : safeRoute(route || apps[id].url).url;
    win.frame.addEventListener("load", () => {
      el.querySelector(".window-loading").hidden = true;
      paint(win);
    });
    el.addEventListener("pointerdown", (e) => {
      activate(id);
      const bar = e.target.closest(".window-bar"),
        handle = e.target.closest("[data-edge]");
      if (
        !multi() ||
        win.max ||
        e.button !== 0 ||
        (!bar && !handle) ||
        e.target.closest("button")
      )
        return;
      e.preventDefault();
      drag = {
        win,
        edge: handle?.dataset.edge || "",
        x: e.clientX,
        y: e.clientY,
        start: { ...win.rect },
        target: e.target,
      };
      e.target.setPointerCapture?.(e.pointerId);
      $("#dragShield").hidden = false;
    });
    el.querySelector(".window-bar").addEventListener("dblclick", (e) => {
      if (!e.target.closest("button")) maximize(win);
    });
    el.querySelector(".window-bar").addEventListener("keydown", (e) => {
      if (
        !multi() ||
        win.max ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) ||
        e.target.closest("button")
      )
        return;
      e.preventDefault();
      const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -20 : 20,
        key = e.shiftKey
          ? e.key === "ArrowLeft" || e.key === "ArrowRight"
            ? "w"
            : "h"
          : e.key === "ArrowLeft" || e.key === "ArrowRight"
            ? "x"
            : "y";
      win.rect = constrain({ ...win.rect, [key]: win.rect[key] + delta });
      saveRect(win);
      paint(win);
    });
    el.addEventListener("click", (e) => {
      const action = e.target.closest("[data-window]")?.dataset.window;
      if (action === "hide" || action === "minimize") hide(id);
      else if (action === "maximize") maximize(win);
      else if (action === "left" || action === "right") snap(win, action);
      else if (e.target.closest(".window-activate")) activate(id);
    });
    activate(id);
  }
  function move(e) {
    if (!drag) return;
    const { win, start, edge } = drag,
      dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    let r = { ...start };
    if (!edge) {
      r.x += dx;
      r.y += dy;
    } else {
      if (edge.includes("e")) r.w += dx;
      if (edge.includes("s")) r.h += dy;
      if (edge.includes("w")) {
        r.x += dx;
        r.w -= dx;
      }
      if (edge.includes("n")) {
        r.y += dy;
        r.h -= dy;
      }
    }
    win.rect = constrain(r);
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (drag) paint(drag.win);
      });
  }
  function endDrag() {
    if (!drag) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    paint(drag.win);
    saveRect(drag.win);
    drag = null;
    $("#dragShield").hidden = true;
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", endDrag);
  window.addEventListener("resize", () => {
    endDrag();
    for (const w of windows.values()) w.rect = constrain(w.rect);
    refresh();
  });
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data?.atlasDesktop) return;
    const win = [...windows.values()].find(
      (w) => w.frame.contentWindow === e.source,
    );
    if (!win) return;
    const m = e.data;
    if (m.type === "open") {
      const route = safeRoute(m.url);
      if (route) open(route.id, route.url);
    }
    if (m.type === "ready") {
      post(win, { type: "visibility", visible: !win.el.hidden });
      if (m.mode) $("#desktopMode").textContent = m.mode + " · Desktop";
    }
    if (m.type === "focus" && !win.minimized) activate(win.id);
    if (m.type === "classic") classic();
  });
  function classic() {
    if (
      windows.size &&
      !confirm(
        "Turn off Desktop mode? Open windows will reload. Save or download any unsaved diagram first.",
      )
    )
      return;
    try {
      localStorage.setItem("atlas-layout", "classic");
    } catch {}
    const next = new URL(active && !apps[active].utility ? apps[active].url : '/', location.origin);
    const frame = windows.get(active)?.frame;
    try {
      const current = new URL(frame.contentWindow.location.href);
      if (current.origin === location.origin && ['/', '/installer', '/installer/'].includes(current.pathname)) {
        next.pathname = current.pathname;
        next.search = current.search;
        next.hash = current.hash;
        const page = frame.contentDocument.querySelector('.page.active')?.id;
        if (page) next.searchParams.set('command', page);
      }
    } catch {}
    next.searchParams.delete('atlasWindow');
    next.searchParams.set('layout', 'classic');
    location.assign(next.pathname + next.search + next.hash);
  }
  function desktop() {
    for (const w of windows.values()) w.minimized = true;
    active = null;
    refresh();
  }
  function toggleSettings() {
    const next = $("#desktopSettings").hidden;
    $("#desktopSettings").hidden = !next;
    $("#windowMenu").setAttribute("aria-expanded", String(next));
  }
  const svg = (path) =>
    `<svg viewBox="0 0 32 32" aria-hidden="true">${path}</svg>`;
  const iconButton = (id, a) =>
    `<button class="dock-item" data-app="${id}" aria-label="Open ${a.title}" aria-pressed="false"><span class="dock-icon" style="--icon-light:${a.colors[0]};--icon-dark:${a.colors[1]}">${svg(a.icon)}</span><span class="dock-tip">${a.title}</span></button>`;
  $("#dock").innerHTML =
    Object.entries(apps)
      .filter(([id]) =>
        [
          "map",
          "workspace",
          "knowledge",
          "calendar",
          "notes",
          "calculator",
        ].includes(id),
      )
      .map(([id, a]) => iconButton(id, a))
      .join("") +
    `<span class="dock-divider"></span><button class="dock-item" id="launcherButton" aria-label="All apps"><span class="dock-icon" style="--icon-light:#b9b9d6;--icon-dark:#676789">${svg('<rect x="4" y="4" width="8" height="8" rx="2"/><rect x="20" y="4" width="8" height="8" rx="2"/><rect x="4" y="20" width="8" height="8" rx="2"/><rect x="20" y="20" width="8" height="8" rx="2"/>')}</span><span class="dock-tip">All apps</span></button><button class="dock-item" id="dockSettings" aria-label="Desktop settings"><span class="dock-icon" style="--icon-light:#a8b8c8;--icon-dark:#566a82">${svg('<path d="M5 8h22 M5 16h22 M5 24h22"/><circle cx="12" cy="8" r="3"/><circle cx="22" cy="16" r="3"/><circle cx="10" cy="24" r="3"/>')}</span><span class="dock-tip">Settings</span></button>`;
  const launcher = document.createElement("section");
  launcher.id = "appLauncher";
  launcher.hidden = true;
  launcher.setAttribute("aria-label", "All apps");
  launcher.innerHTML =
    '<header><h2>All apps</h2><button id="closeLauncher" aria-label="Close app launcher">×</button></header><input id="appSearch" placeholder="Find an app…" aria-label="Find an app"><div class="launcher-grid"></div><p>Atlas utilities stay in this browser. No corporate accounts are connected.</p>';
  document.body.append(launcher);
  function renderLauncher() {
    const term = $("#appSearch").value.toLowerCase();
    launcher.querySelector(".launcher-grid").innerHTML = Object.entries(apps)
      .filter(([id, a]) => a.title.toLowerCase().includes(term))
      .map(
        ([id, a]) =>
          `<button data-app="${id}"><span class="dock-icon" style="--icon-light:${a.colors[0]};--icon-dark:${a.colors[1]}">${svg(a.icon)}</span><span>${a.title}</span></button>`,
      )
      .join("");
  }
  $("#launcherButton").onclick = () => {
    launcher.hidden = !launcher.hidden;
    if (!launcher.hidden) {
      renderLauncher();
      $("#appSearch").focus();
    }
  };
  $("#closeLauncher").onclick = () => (launcher.hidden = true);
  $("#appSearch").oninput = renderLauncher;
  launcher.onclick = (e) => {
    const id = e.target.closest("[data-app]")?.dataset.app;
    if (id) {
      open(id);
      launcher.hidden = true;
    }
  };
  document.querySelector("#clock").style.cursor = "pointer";
  document.querySelector("#clock").title = "Open Calendar";
  document.querySelector("#clock").onclick = () => open("calendar");
  $("#dock").addEventListener("click", (e) => {
    const id = e.target.closest("[data-app]")?.dataset.app;
    if (id) open(id);
    if (e.target.closest("[aria-disabled=true]"))
      notice("A decorative desktop icon. Your Atlas apps are on the left.");
  });
  $("#home").onclick = desktop;
  $("#showDesktop").onclick = desktop;
  $("#windowMenu").onclick = toggleSettings;
  $("#dockSettings").onclick = toggleSettings;
  $("#multitask").onchange = () => {
    endDrag();
    settings.multi = $("#multitask").checked;
    persist();
    refresh();
  };
  $("#resetWindows").onclick = () => {
    let i = 0;
    for (const w of windows.values()) {
      w.rect = defaults(i++);
      w.max = false;
      saveRect(w);
    }
    refresh();
    notice("Window positions reset");
  };
  function motion() {
    const reduced = window.AtlasUI?.motion.isReduced();
    document.body.classList.toggle("desktop-reduce", !!reduced);
    $("#desktopMotion").checked = !reduced;
  }
  $("#desktopMotion").onchange = () => {
    window.AtlasUI?.motion.toggle();
    motion();
  };
  window.addEventListener("atlas-motion-change", motion);
  motion();
  $("#search").onclick = () => {
    if (!active) {
      open("workspace");
      notice("Workspace opened. Use Search Atlas when it is ready.");
    } else if (apps[active].utility) {
      launcher.hidden = false;
      renderLauncher();
      $("#appSearch").focus();
    } else post(windows.get(active), { type: "search" });
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      launcher.hidden = true;
      $("#desktopSettings").hidden = true;
      $("#windowMenu").setAttribute("aria-expanded", "false");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      $("#search").click();
    }
  });
  function clock() {
    $("#clock").textContent = new Date().toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: !personal.hour24,
      ...(personal.seconds ? { second: "2-digit" } : {}),
    });
  }
  const personalDefaults = {
    appearance: "light",
    wallpaper: "aurora",
    accent: "#007fa3",
    dockSize: "medium",
    magnify: true,
    autohide: false,
    transparency: true,
    hour24: true,
    seconds: false,
  };
  let personal = { ...personalDefaults };
  try {
    const saved = JSON.parse(
      localStorage.getItem("atlas-desktop-personalization") || "{}",
    );
    for (const key of Object.keys(personalDefaults)) {
      if (typeof saved[key] === typeof personalDefaults[key])
        personal[key] = saved[key];
    }
  } catch {}
  const controls = document.createElement("div");
  controls.className = "personal-settings";
  controls.innerHTML =
    "<h3>Appearance & dock</h3>" +
    [
      ["appearance", "Utility appearance", ["light", "dark"]],
      ["wallpaper", "Wallpaper", ["aurora", "midnight", "ocean", "graphite"]],
      ["accent", "Accent", ["#007fa3", "#7358bd", "#b85878", "#3c866d"]],
      ["dockSize", "Dock size", ["small", "medium", "large"]],
    ]
      .map(
        ([key, label, values]) =>
          `<label>${label}<select data-setting="${key}" aria-label="${label}">${values.map((v) => `<option value="${v}">${{ "#007fa3": "Blue", "#7358bd": "Purple", "#b85878": "Rose", "#3c866d": "Green" }[v] || v}</option>`).join("")}</select></label>`,
      )
      .join("") +
    [
      ["magnify", "Dock magnification"],
      ["autohide", "Auto-hide dock"],
      ["transparency", "Translucent dock"],
      ["hour24", "24-hour clock"],
      ["seconds", "Show seconds"],
    ]
      .map(
        ([key, label]) =>
          `<label class="desktop-switch">${label}<input type="checkbox" role="switch" data-setting="${key}" aria-label="${label}"></label>`,
      )
      .join("") +
    '<button id="resetAppearance">Reset appearance</button>';
  $("#desktopSettings").insertBefore(controls, $("#resetWindows"));
  function applyPersonal() {
    for (const key of ["appearance", "wallpaper", "dockSize"])
      document.body.dataset[key] = personal[key];
    document.body.classList.toggle("dock-no-magnify", !personal.magnify);
    document.body.classList.toggle("dock-autohide", personal.autohide);
    document.body.classList.toggle("dock-solid", !personal.transparency);
    document.documentElement.style.setProperty(
      "--desktop-accent",
      personal.accent,
    );
    controls.querySelectorAll("[data-setting]").forEach((c) => {
      if (c.type === "checkbox") c.checked = personal[c.dataset.setting];
      else c.value = personal[c.dataset.setting];
    });
    clock();
  }
  controls.onchange = (e) => {
    const key = e.target.dataset.setting;
    if (!key) return;
    personal[key] =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    try {
      localStorage.setItem(
        "atlas-desktop-personalization",
        JSON.stringify(personal),
      );
    } catch {}
    applyPersonal();
  };
  $("#resetAppearance").onclick = () => {
    personal = { ...personalDefaults };
    localStorage.setItem(
      "atlas-desktop-personalization",
      JSON.stringify(personal),
    );
    applyPersonal();
  };
  applyPersonal();
  setInterval(() => {
    if (personal.seconds || new Date().getSeconds() === 0) clock();
  }, 1000);

  try {
    localStorage.setItem("atlas-layout", "desktop");
  } catch {}
  const start = new URLSearchParams(location.search).get("open"),
    route = start && safeRoute(start);
  if (route) open(route.id, route.url);
  refresh();
})();
