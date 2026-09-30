/* Classic/Desktop preference and same-origin app-window bridge. */
(() => {
  "use strict";
  const url = new URL(location.href),
    embedded =
      window.parent !== window &&
      (url.searchParams.has("atlasWindow") ||
        window.frameElement?.dataset.atlasApp);
  if (!embedded) {
    let pref = "classic";
    try {
      if (url.searchParams.get("layout") === "classic")
        localStorage.setItem("atlas-layout", "classic");
      pref = localStorage.getItem("atlas-layout") || "classic";
    } catch {}
    if (pref === "desktop") {
      const start =
        location.pathname.startsWith("/installer") ||
        url.searchParams.has("command")
          ? location.pathname + location.search + location.hash
          : "";
      location.replace(
        "/assets/desktop.html" +
          (start ? "?open=" + encodeURIComponent(start) : ""),
      );
      return;
    }
  }
  function send(message) {
    if (embedded)
      parent.postMessage({ atlasDesktop: true, ...message }, location.origin);
  }
  function navigate(href) {
    if (!embedded) return false;
    try {
      const u = new URL(href, location.href);
      if (
        u.origin !== location.origin ||
        !["/", "/installer", "/installer/"].includes(u.pathname)
      )
        return false;
      send({ type: "open", url: u.pathname + u.search + u.hash });
      return true;
    } catch {
      return false;
    }
  }
  window.AtlasDesktop = {
    navigate,
    app: embedded
      ? url.searchParams.get("atlasWindow") ||
        window.frameElement?.dataset.atlasApp
      : null,
    open() {
      if (embedded) {
        send({ type: "classic" });
        return;
      }
      try {
        localStorage.setItem("atlas-layout", "desktop");
      } catch {}
      location.assign("/assets/desktop.html");
    },
  };
  function boot() {
    if (!embedded) {
      const header = document.querySelector(".atlas-primary-nav");
      if (header) {
        const button = document.createElement("button");
        button.className = "atlas-desktop-launch";
        button.textContent = "Desktop";
        button.title = "Open Atlas Desktop";
        button.onclick = () => window.AtlasDesktop.open();
        header.append(button);
      }
      return;
    }
    document.documentElement.classList.add("atlas-in-window");
    const id = url.searchParams.get("atlasWindow");
    document.addEventListener(
      "click",
      (e) => {
        const a = e.target.closest("a[href]");
        if (a && navigate(a.href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    window.addEventListener("focus", () => send({ type: "focus" }));
    window.addEventListener("message", (e) => {
      if (
        e.source !== parent ||
        e.origin !== location.origin ||
        !e.data?.atlasDesktop
      )
        return;
      const m = e.data;
      if (m.type === "visibility") {
        window.AtlasDesktopHidden = !m.visible;
        if (m.visible) window.dispatchEvent(new Event("atlas-display-change"));
      }
      if (m.type === "search") {
        if (window.openPalette) window.openPalette();
        else
          document
            .querySelector(".atlas-palette-mount")
            ?.shadowRoot?.querySelector("#atlas-commands")
            ?.click();
      }
      if (m.type === "navigate") {
        const next = new URL(m.url, location.origin);
        if (
          next.origin !== location.origin ||
          !["/", "/installer", "/installer/"].includes(next.pathname)
        )
          return;
        next.searchParams.set("atlasWindow", id);
        history.replaceState(null, "", next.pathname + next.search + next.hash);
        if (window.openPaletteTarget) window.openPaletteTarget();
        else
          window.dispatchEvent(
            new CustomEvent("atlas-desktop-route", { detail: next.search }),
          );
      }
    });
    const badge = document.querySelector(
      ".atlas-demo-badge,.atlas-admin-badge",
    );
    send({ type: "ready", mode: badge?.textContent?.trim() || "" });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
