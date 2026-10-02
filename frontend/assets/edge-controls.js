/* Shared control panels. Revealing a panel never activates a remote action. */
(() => {
  "use strict";
  const panels = new Map(),
    modeKey = "atlas-controls-mode",
    pinKey = "atlas-controls-pins";
  const edgeDepth = { top: 22, bottom: 22 };
  let automatic = true,
    pins = {},
    keyboard = false,
    dragging = false,
    scheduled = false,
    refreshFrame = 0,
    adapting = false;
  try {
    automatic = localStorage.getItem(modeKey) !== "always";
    const saved = JSON.parse(localStorage.getItem(pinKey) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      pins = saved;
  } catch {}
  const q = (selector, root = document) => root.querySelector(selector);
  const savePins = () => {
    try {
      localStorage.setItem(pinKey, JSON.stringify(pins));
    } catch {}
  };
  function eligible(panel) {
    if (!panel.node.isConnected) return false;
    for (
      let node = panel.node;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (
        node.hidden ||
        node.classList.contains("hidden") ||
        (node.classList.contains("page") && !node.classList.contains("active"))
      )
        return false;
      if (getComputedStyle(node).display === "none" &&
          !(node === panel.node && node.dataset.atlasEdgeInline === "true" && !panel.open))
        return false;
    }
    return true;
  }
  function locked(panel) {
    if (panel.node.getAttribute("aria-busy") === "true") return true;
    const active = document.activeElement;
    if (
      panel.node.contains(active) &&
      (keyboard ||
        active.matches("input,select,textarea,[contenteditable=true]"))
    )
      return true;
    if (
      panel.node.querySelector(
        "details[open],dialog[open],.toolmenu.open,[aria-expanded=true]:not(.atlas-edge-pin)",
      )
    )
      return true;
    return !!panel.node
      .querySelector(".atlas-palette-mount")
      ?.shadowRoot?.querySelector("dialog[open]");
  }
  function chrome(panel) {
    if (panel.node.querySelector(":scope > .atlas-edge-chrome")) return;
    const bar = document.createElement("div");
    bar.className = "atlas-edge-chrome";
    const title = document.createElement("strong");
    title.textContent = panel.label;
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "atlas-edge-pin";
    pin.textContent = "Pin";
    pin.setAttribute("aria-label", `Pin ${panel.label.toLowerCase()} open`);
    pin.onclick = () => {
      pins[panel.id] = !pins[panel.id];
      savePins();
      refresh();
      panel.node.scrollIntoView({ block: "nearest" });
      window.dispatchEvent(new Event("atlas-shell-resize"));
    };
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.setAttribute("aria-label", `Hide ${panel.label.toLowerCase()}`);
    close.onclick = () => {
      pins[panel.id] = false;
      savePins();
      hide(panel, true);
      refresh();
      window.dispatchEvent(new Event("atlas-shell-resize"));
    };
    bar.append(title, pin, close);
    panel.node.prepend(bar);
  }
  function show(panel, explicit = false) {
    if (
      !automatic ||
      !eligible(panel) ||
      dragging ||
      document.querySelector("dialog[open]")
    )
      return;
    clearTimeout(panel.openTimer);
    panel.openTimer = null;
    clearTimeout(panel.closeTimer);
    for (const other of panels.values()) {
      if (other === panel || other.edge !== panel.edge) continue;
      // A delayed hover must never replace a panel explicitly opened by click.
      clearTimeout(other.openTimer);
      other.openTimer = null;
      if (!other.open || pins[other.id]) continue;
      if (locked(other)) {
        if (!explicit) return;
        hide(other, true);
      } else hide(other);
    }
    panel.open = true;
    panel.node.inert = false;
    panel.node.dataset.atlasEdgeOpen = "true";
    panel.handle.setAttribute("aria-expanded", "true");
    if (explicit && panel.node.dataset.atlasEdgeInline === "true")
      panel.node.scrollIntoView({ block: "nearest" });
  }
  function hide(panel, force = false) {
    clearTimeout(panel.openTimer);
    panel.openTimer = null;
    clearTimeout(panel.closeTimer);
    if (!automatic || (!force && (pins[panel.id] || locked(panel) || dragging)))
      return;
    if (panel.node.contains(document.activeElement)) {
      panel.restoring = true;
      panel.handle.focus({ preventScroll: true });
      panel.restoring = false;
    }
    panel.open = false;
    panel.node.dataset.atlasEdgeOpen = "false";
    panel.node.inert = true;
    panel.handle.setAttribute("aria-expanded", "false");
  }
  function later(panel) {
    clearTimeout(panel.closeTimer);
    panel.closeTimer = setTimeout(() => {
      panel.closeTimer = null;
      if (!panel.node.matches(":hover") && !panel.handle.matches(":hover"))
        hide(panel);
    }, 700);
  }
  function focusControls(panel) {
    show(panel, true);
    // Focus after the reveal style is visible, including on the first opening.
    requestAnimationFrame(() => {
      if (!panel.open || !eligible(panel)) return;
      const first = [...panel.node.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]',
      )].find((node) => !node.closest('.atlas-edge-chrome,[hidden],[inert]') && node.getClientRects().length);
      if (first) first.focus({ preventScroll: true });
      else {
        panel.node.tabIndex = -1;
        panel.node.focus({ preventScroll: true });
      }
    });
  }
  function register(node, id, label, edge = "top") {
    if (!node || node.closest("dialog") || panels.has(id)) return;
    node.id ||= `atlas-edge-${id}`;
    node.classList.add("atlas-edge-panel");
    node.dataset.atlasEdge = edge;
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "atlas-edge-handle";
    handle.dataset.atlasEdgeHandle = id;
    handle.dataset.edge = edge;
    handle.textContent = label;
    handle.setAttribute("aria-controls", node.id);
    handle.setAttribute("aria-expanded", "false");
    handle.setAttribute("aria-label", `Show ${label.toLowerCase()}`);
    const panel = { node, id, label, edge, handle, open: false };
    panels.set(id, panel);
    // Hover and keyboard focus can reveal before a click reaches the handle.
    handle.onclick = () => show(panel, true);
    handle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        keyboard = true;
        focusControls(panel);
      }
    });
    handle.addEventListener("focus", () => {
      if (keyboard && !panel.restoring) show(panel, true);
    });
    handle.addEventListener("pointerenter", () => {
      panel.openTimer = setTimeout(() => show(panel), 140);
    });
    handle.addEventListener("pointerleave", () => {
      clearTimeout(panel.openTimer);
      later(panel);
    });
    node.addEventListener("pointerenter", () => clearTimeout(panel.closeTimer));
    node.addEventListener("pointerleave", () => later(panel));
    node.addEventListener("focusin", () => show(panel, true));
    node.addEventListener("focusout", () => later(panel));
    chrome(panel);
    document.body.append(handle);
  }
  function group(parent, id, selectors, label = "Tools", edge = "top") {
    if (!parent) return;
    let host = q(`[data-atlas-control-group="${id}"]`, parent);
    const selected = [
      ...new Set(selectors.flatMap((selector) => [...parent.querySelectorAll(selector)])),
    ];
    const nodes = selected.filter(
      (node) =>
        !selected.some((ancestor) => ancestor !== node && ancestor.contains(node)) &&
        !node.closest("dialog,.atlas-edge-chrome") &&
        !node.closest(".atlas-edge-panel"),
    );
    if (!host && !nodes.length) return;
    if (!host) {
      host = document.createElement("div");
      host.dataset.atlasControlGroup = id;
      host.className = "atlas-control-group";
      nodes[0].before(host);
    }
    for (const node of nodes) host.append(node);
    register(host, id, label, edge);
  }
  function adapt() {
    register(q("body > .atlas-app-header"), "menu", "Menu");
    register(q("body > .console-sidebar"), "navigation", "Navigation", "left");
    if (document.body.classList.contains("atlas-map")) {
      register(q(".directory"), "directory", "Directory", "left");
      register(q("#detail"), "inspector", "Details", "right");
      // The map assembles its settings first, keeping its existing handlers.
      if (q(".map-settings"))
        group(
          q(".workspace > main"),
          "map-tools",
          [".map-settings", ".floor-rail", "#site-info"],
          "Map tools",
        );
      const mapTools = q('[data-atlas-control-group="map-tools"]');
      if (mapTools?.parentElement === q("#viewport")) q("#viewport").before(mapTools);
      group(document.body, "map-activity", [".atlas-reachable-toggle"], "Actions", "bottom");
    }
    if (document.body.classList.contains("atlas-console")) {
      const admin = q("#admin .performance-panel"),
        status = q("#quickKillStatus");
      if (status?.closest(".quick-process-actions") && admin)
        q(".admin-processes", admin).prepend(status);
      group(
        admin,
        "admin-tools",
        [
          ".admin-tools",
          ".quick-process-actions",
          ".manual-termination-disclosure",
        ],
        "Machine tools",
      );
      group(admin, "scan-tools", [".performance-views", ".performance-view-heading > .row"], "Scan & views");
      group(
        q("#workspace"),
        "workspace-tools",
        ["#recentTargets"],
        "Recent targets",
      );
      group(
        q("#targetBar"),
        "target-tools",
        [":scope > button", ":scope > .toolmenu"],
        "Target actions",
      );
      group(q("#machines"), "machine-filters", [".atlas-machine-filters"], "Machine filters");
      group(
        q("#bulk .panel"),
        "bulk-tools",
        [".bulkgrid", ".atlas-sticky-actions"],
        "Rollout tools",
      );
      group(
        q("#history .panel"),
        "history-tools",
        ["#refreshHistory"],
        "History tools",
      );
      const adBrowser = q("#adBrowser");
      if (adBrowser?.closest(".atlas-edge-panel"))
        adBrowser.closest(".atlas-edge-panel").before(adBrowser);
      group(
        q("#active-directory .panel"),
        "ad-tools",
        ["#adForm", ".ad-browser-tools"],
        "AD lookup",
      );
      group(q("#adResults"), "ad-result-tools", [":scope > .ad-group-tools:not(.ad-group-filter):not(.ad-group-compare)", ".ad-access-check > label"], "Group tools");
      group(
        q("#psexec"),
        "psexec-tools",
        [
          ".px-settings",
          ".px-library > .px-search",
          ".px-filters",
          "#pxFavourite",
          "#pxEulaNote",
          "#pxRun",
          "#pxCopy",
          ".px-elevation",
          "#pxFields",
        ],
        "Command tools",
      );
      // Terminal output stays in the main surface; controls remain in its page.
      group(
        q(".px-terminal"),
        "terminal-tools",
        [".px-terminal-toolbar", "#pxInputForm", "label:has(#pxSessions)"],
        "Session tools",
        "bottom",
      );
      register(
        q("#knowledge .kb-library"),
        "knowledge-library",
        "Documents",
        "left",
      );
      register(
        q("#knowledge .kb-details"),
        "knowledge-details",
        "Notes",
        "right",
      );
      group(
        q("#knowledge"),
        "knowledge-tools",
        [
          ".kb-heading > div:last-child",
          ".kb-document-bar",
          ".kb-editor-bar > button",
        ],
        "Document tools",
      );
      group(
        document.body,
        "activity",
        [
          "#queueToggle",
          "#deploymentsToggle",
          ".atlas-reachable-toggle",
          "#deploymentToggle",
        ],
        "Activity",
        "bottom",
      );
    }
    if (document.body.classList.contains("atlas-database")) {
      group(q("main > header"), "database-nav", ["a"], "Menu");
      // Keep upload fields, their actions and feedback together. Review panels
      // remain inside the hidden preview until validation has succeeded.
      for (const [id, label] of [
        ["directory", "Users & devices"],
        ["directory-review", "Apply directory"],
        ["seating", "Users & desks"],
        ["seating-review", "Apply seating"],
        ["moves", "Desk moves"],
        ["moves-review", "Apply moves"],
      ])
        register(q(`[data-database-controls="${id}"]`), `database-${id}`, label);
      group(
        q("main"),
        "database-tools",
        [
          "#excel-templates",
          "form",
          ":scope > section > label",
          ":scope > section > button",
          ":scope > section > a",
        ],
        "Templates & exports",
      );
    }
    if (document.body.classList.contains("atlas-desktop")) {
      register(q(".desktop-menu"), "desktop-menu", "Menu");
      register(q("#dock"), "desktop-dock", "Apps", "bottom");
    }
    if (document.body.classList.contains("atlas-utility")) {
      // The current month is information, independent of calendar navigation.
      const month = q("#month");
      if (month?.closest(".row")) q("#utility > header").append(month);
      group(
        q("#utility"),
        "utility-tools",
        [
          "header button",
          "header a",
          "form",
          ".toolbar",
          ".timer-controls",
          ".clock-controls",
          ".row:has(button)",
          ".calc-grid",
          ":scope > button",
          "label:has(input[type=file])",
        ],
        "Tools",
      );
    }
  }
  function refresh() {
    scheduled = false;
    refreshFrame = 0;
    if (adapting) return;
    adapting = true;
    for (const [id, panel] of panels)
      if (!panel.node.isConnected) {
        clearTimeout(panel.openTimer);
        clearTimeout(panel.closeTimer);
        panel.handle.remove();
        panels.delete(id);
      }
    adapt();
    // Once controls are pinned, every revealed panel uses its original place
    // in the page. Nothing can float over an existing pinned panel.
    const inline = automatic && [...panels.values()].some(
      (panel) => pins[panel.id] && eligible(panel),
    );
    document.body.dataset.atlasPinnedControls = String(inline);
    const counts = { top: 0, left: 0, right: 0, bottom: 0 };
    const slots = Math.max(1, Math.floor((window.innerWidth - 16) / 108));
    for (const panel of panels.values()) {
      chrome(panel);
      panel.node.dataset.atlasEdgeInline = String(inline);
      panel.node.dataset.atlasEdgePinned = String(automatic && !!pins[panel.id]);
      const present = eligible(panel),
        hidden = !automatic || !present;
      if (panel.handle.hidden !== hidden) panel.handle.hidden = hidden;
      if (present) {
        const index = counts[panel.edge]++;
        panel.handle.style.setProperty("--edge-index", index);
        panel.handle.style.setProperty("--edge-column", index % slots);
        panel.handle.style.setProperty("--edge-row", Math.floor(index / slots));
      }
      const pin = q(":scope > .atlas-edge-chrome .atlas-edge-pin", panel.node);
      pin.setAttribute("aria-pressed", String(!!pins[panel.id]));
      const text = pins[panel.id] ? "Unpin" : "Pin";
      if (pin.textContent !== text) pin.textContent = text;
      pin.setAttribute("aria-label", `${text} ${panel.label.toLowerCase()}${pins[panel.id] ? "" : " open"}`);
      if (!automatic) {
        clearTimeout(panel.openTimer);
        clearTimeout(panel.closeTimer);
        panel.open = false;
        panel.handle.setAttribute("aria-expanded", "false");
        panel.node.inert = false;
        panel.node.removeAttribute("data-atlas-edge-open");
      } else if (!present) hide(panel, true);
      else {
        if (!panel.open) {
          if (panel.node.contains(document.activeElement)) hide(panel, true);
          panel.node.dataset.atlasEdgeOpen = "false";
          panel.node.inert = true;
          panel.handle.setAttribute("aria-expanded", "false");
        }
        if (pins[panel.id]) {
          panel.open = true;
          panel.node.inert = false;
          panel.node.dataset.atlasEdgeOpen = "true";
          panel.handle.setAttribute("aria-expanded", "true");
        }
      }
    }
    for (const edge of ["top", "bottom"]) {
      const property = `--atlas-${edge}-edge-rows`;
      const rows = Math.max(1, Math.ceil(counts[edge] / slots));
      const value = String(rows);
      edgeDepth[edge] = rows * (window.matchMedia("(pointer:coarse)").matches ? 32 : 22);
      if (document.documentElement.style.getPropertyValue(property) !== value)
        document.documentElement.style.setProperty(property, value);
    }
    const step = window.matchMedia("(pointer:coarse)").matches ? 32 : 22;
    for (const edge of ["top", "bottom", "left", "right"])
      document.documentElement.style.setProperty(`--atlas-${edge}-edge-space`,
        `${counts[edge] ? (edge === "top" || edge === "bottom" ? Math.ceil(counts[edge] / slots) : 1) * step : 0}px`);
    const context = q("#atlasContentContext");
    if (context) {
      const pc = q("#admin.active")
        ? q("#adminPc")?.value.trim().toUpperCase()
        : q("#psexec.active")
          ? q("#pxTarget")?.value.trim().toUpperCase()
          : q("#active-directory.active")
            ? q("#adIdentity")?.value.trim()
            : q("#knowledge.active")
              ? q("#kbTitle")?.value.trim()
              : q("#workspace.active")
                ? q("#barTarget")?.textContent.trim()
                : "";
      const state = q("#admin.active")
        ? q("#performanceState")?.textContent
        : q("#workspace.active")
          ? q("#barState")?.textContent
          : "";
      const text = q("#workspace.active") ? "" : [pc, state].filter(Boolean).join(" · ");
      if (context.textContent !== text) context.textContent = text;
      const hidden = !automatic || !text;
      if (context.hidden !== hidden) context.hidden = hidden;
    }
    adapting = false;
  }
  function schedule() {
    if (!scheduled) {
      scheduled = true;
      refreshFrame = requestAnimationFrame(refresh);
    }
  }
  function setAutoHide(value) {
    automatic = !!value;
    document.documentElement.classList.toggle("atlas-auto-hide", automatic);
    try {
      localStorage.setItem(modeKey, automatic ? "auto" : "always");
    } catch {}
    const input = q("#atlasAlwaysShowControls");
    if (input) input.checked = !automatic;
    refresh();
    window.dispatchEvent(new Event("atlas-shell-resize"));
    window.dispatchEvent(new Event("resize"));
  }
  function proximity(event) {
    if (
      !automatic ||
      event.buttons ||
      dragging ||
      event.pointerType === "touch"
    )
      return;
    // Refresh owns visibility. Pointer movement only measures handles at a
    // nearby edge; moving over content never needs a panel/layout scan.
    let closest = null, distance = Infinity;
    for (const panel of panels.values()) {
      if (panel.handle.hidden) continue;
      const near = panel.edge === "top" ? event.clientY <= edgeDepth.top
        : panel.edge === "bottom" ? event.clientY >= innerHeight - edgeDepth.bottom
          : panel.edge === "left" ? event.clientX <= 22
            : event.clientX >= innerWidth - 22;
      let candidate = false;
      if (near) {
        const r = panel.handle.getBoundingClientRect();
        candidate = panel.edge === "top" || panel.edge === "bottom"
          ? event.clientY >= r.top - 8 && event.clientY <= r.top + r.height + 8 &&
            Math.abs(event.clientX - (r.left + r.width / 2)) <
              Math.max(50, r.width / 2 + 20)
          : Math.abs(event.clientY - (r.top + r.height / 2)) < 70;
        const d = (event.clientX - (r.left + r.width / 2)) ** 2 +
          (event.clientY - (r.top + r.height / 2)) ** 2;
        if (candidate && d < distance) { closest = panel; distance = d; }
      }
    }
    for (const panel of panels.values()) {
      if (panel.handle.hidden) continue;
      if (panel === closest) {
        clearTimeout(panel.closeTimer);
        if (!panel.open && !panel.openTimer)
          panel.openTimer = setTimeout(() => {
            panel.openTimer = null;
            show(panel);
          }, 140);
      } else {
        clearTimeout(panel.openTimer);
        panel.openTimer = null;
        if (panel.open && !panel.node.matches(":hover") && !panel.closeTimer)
          later(panel);
      }
    }
  }
  function boot() {
    // The two upload workflows are primary actions and stay in their sections.
    if (document.body.classList.contains("atlas-upload-workflows")) return;
    if (
      !document.body.matches(
        ".atlas-console,.atlas-map,.atlas-desktop,.atlas-database,.atlas-utility",
      )
    )
      return;
    const settings = document.createElement("dialog");
    settings.id = "atlasControlsSettings";
    settings.className = "atlas-dialog";
    settings.setAttribute("aria-labelledby", "atlasControlsTitle");
    settings.innerHTML =
      '<h2 id="atlasControlsTitle">Controls & space</h2><label><input id="atlasAlwaysShowControls" type="checkbox"> Always show controls</label><p>Move toward an edge, tap its handle, or use Tab to reveal controls. Pin a panel to keep it open. Escape closes a revealed panel.</p><button type="button" autofocus>Done</button>';
    settings.querySelector("button").onclick = () => settings.close();
    settings.querySelector("input").onchange = (event) =>
      setAutoHide(!event.target.checked);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "atlas-controls-settings";
    toggle.textContent = "Layout";
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-controls", settings.id);
    toggle.onclick = () => settings.showModal();
    document.body.append(settings, toggle);
    if (document.body.classList.contains("atlas-console")) {
      const context = document.createElement("p");
      context.id = "atlasContentContext";
      context.className = "atlas-content-context";
      context.hidden = true;
      q("main").prepend(context);
    }
    document.addEventListener("keydown", (event) => {
      keyboard = true;
      if (event.ctrlKey && event.shiftKey && event.code === "Backslash") {
        event.preventDefault();
        settings.showModal();
      }
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector("dialog[open]")
      )
        return;
      for (const panel of panels.values())
        if (panel.open && !pins[panel.id]) hide(panel, true);
    });
    document.addEventListener(
      "keydown",
      (event) => {
        const field = document.activeElement?.matches(
          "input,textarea,select,[contenteditable=true]",
        );
        if (
          (event.key === "/" && !field) ||
          (event.ctrlKey && event.key.toLowerCase() === "k")
        ) {
          const node =
            event.key === "/" ? q("#search") : q(".atlas-app-header");
          for (const panel of panels.values())
            if (node && panel.node.contains(node)) show(panel, true);
        }
      },
      true,
    );
    document.addEventListener("pointerdown", (event) => {
      keyboard = false;
      dragging = !!event.buttons;
    });
    window.addEventListener("pointerup", () => {
      dragging = false;
    });
    window.addEventListener("pointercancel", () => {
      dragging = false;
    });
    window.addEventListener("blur", () => {
      dragging = false;
      for (const panel of panels.values()) later(panel);
    });
    window.addEventListener("pointermove", proximity, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("input", schedule);
    document.addEventListener("click", schedule);
    window.addEventListener("atlas:admin-target-change", schedule);
    window.addEventListener("storage", (event) => {
      if (event.key === pinKey) {
        try {
          const saved = JSON.parse(event.newValue || "{}");
          pins =
            saved && typeof saved === "object" && !Array.isArray(saved)
              ? saved
              : {};
        } catch {}
        refresh();
      }
      if (event.key === modeKey) setAutoHide(event.newValue !== "always");
    });
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            (record.type === "childList" &&
              ([...record.addedNodes, ...record.removedNodes].some(
                (node) => node.nodeType === 1,
              ) ||
                record.target.matches?.(
                  "#performanceState,#barTarget,#barState",
                ))) ||
            (record.type === "attributes" &&
              ["class", "hidden"].includes(record.attributeName)),
        )
      )
        schedule();
    });
    setAutoHide(automatic);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "hidden"],
    });
    window.addEventListener("pagehide", (event) => {
      if (event.persisted) return;
      observer.disconnect();
      cancelAnimationFrame(refreshFrame);
      for (const panel of panels.values()) {
        clearTimeout(panel.openTimer);
        clearTimeout(panel.closeTimer);
      }
    });
    window.AtlasEdges = {
      setAutoHide,
      refresh,
      register,
      open: (id) => {
        const panel = panels.get(id);
        if (panel) show(panel, true);
      },
      close: (id) => {
        const panel = panels.get(id);
        if (panel) hide(panel, true);
      },
      revealFor: (node) => {
        for (const panel of panels.values())
          if (panel.node.contains(node)) show(panel, true);
      },
    };
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
