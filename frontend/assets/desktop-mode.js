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
      const current = new URL(location.href);
      current.searchParams.delete('layout');
      const activePage=document.querySelector('.page.active')?.id;
      if(activePage)current.searchParams.set('command',activePage);
      location.assign('/assets/desktop.html?open='+encodeURIComponent(current.pathname+current.search+current.hash));
    },
  };
  function boot() {
    if (!embedded) document.addEventListener('click', (event) => {
      const link = event.target.closest('.atlas-primary-nav a');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const next = new URL(link.href, location.href);
      if (next.origin !== location.origin || next.pathname !== '/') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      next.searchParams.delete('atlasWindow');
      next.searchParams.set('layout', 'classic');
      location.assign(next.pathname + next.search + next.hash);
    }, true);

    if (!embedded) {
      const header = document.querySelector('.atlas-header-actions');
      if(header){
        const button=document.createElement('button');button.type='button';button.textContent='Settings';button.id='atlasAppearanceSettings';button.title='Atlas appearance settings';
        button.onclick=()=>{
          const {element,body}=AtlasUI.dialog('Settings');
          const label=document.createElement('label');label.className='atlas-layout-setting';
          const text=document.createElement('span');const title=document.createElement('strong');title.textContent='Desktop mode';
          const help=document.createElement('small');help.textContent='Show Atlas with a dock and app windows. Off uses the standard layout. Remembered in this browser.';text.append(title,help);
          const toggle=document.createElement('input');toggle.type='checkbox';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','Desktop mode');
          toggle.onchange=()=>{if(toggle.checked){element.close();window.AtlasDesktop.open();}};
          label.append(text,toggle);body.append(label);
        };
        const menu=document.querySelector('.atlas-header-menu');(menu||header).append(button);
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
