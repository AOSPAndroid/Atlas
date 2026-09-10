import { COMMANDS } from "./command-registry.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const normalize = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function installCommandPalette({
  getRecords,
  onSelect,
  toast,
  runCommand,
  openPerson,
  openMachine,
  prepare,
  triggerParent,
  replaceTrigger,
  readOnly = false,
}) {
  const mount = document.createElement("span");
  mount.className = "atlas-palette-mount";
  if (replaceTrigger) replaceTrigger.replaceWith(mount);
  else triggerParent.prepend(mount);
  const root = mount.attachShadow({ mode: "open" });
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = "/command-palette.css?v=70";
  root.append(sheet);
  const trigger = document.createElement("button");
  trigger.id = "atlas-commands";
  trigger.innerHTML = "Search Atlas <kbd>Ctrl K</kbd>";
  trigger.setAttribute("aria-label", "Search Atlas commands (Ctrl+K)");
  root.append(trigger);
  const dialog = document.createElement("dialog");
  dialog.className = "atlas-palette";
  dialog.setAttribute("aria-label", "Search Atlas");
  dialog.innerHTML =
    '<div class="palette-input-row"><span aria-hidden="true">⌕</span><input id="atlas-command-input" placeholder="Search people, machines, desks or actions…" aria-label="Search people, machines, desks or actions" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="atlas-command-results" autocomplete="off"><button class="palette-close" aria-label="Close search">Esc</button></div><div id="atlas-command-status" role="status" aria-live="polite"></div><div id="atlas-command-results" role="listbox" aria-label="Atlas search results"></div><footer><span>↑ ↓ Navigate · Enter Open · Esc Close</span><span>Try person:, machine:, serial:, asset:, team:, location: or &gt; for actions</span></footer>';
  root.append(dialog);
  const input = dialog.querySelector("input"),
    list = dialog.querySelector("[role=listbox]"),
    status = dialog.querySelector("[role=status]");
  let rows = [],
    active = 0,
    generation = 0,
    timer,
    controller,
    previousFocus;
  const openConsole = (key, value) =>
    key === "person" ? openPerson(value) : openMachine(value);
  const actions = COMMANDS.filter((a) => !readOnly || a.viewer).map((a) => ({
    ...a,
    run: () => runCommand(a.id),
  }));
  function invalidate() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  }
  function close() {
    invalidate();
    dialog.close();
  }
  function setActive(index) {
    active = rows.length ? (index + rows.length) % rows.length : 0;
    [...list.children].forEach((node, i) => {
      node.setAttribute("aria-selected", String(i === active));
      node.classList.toggle("selected", i === active);
    });
    if (rows.length) {
      input.setAttribute("aria-activedescendant", "atlas-command-" + active);
      list.children[active]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }
  function render(items, message) {
    rows = items;
    active = 0;
    list.innerHTML = rows
      .map(
        (r, i) =>
          `<div id="atlas-command-${i}" class="palette-result" role="option" aria-selected="false" data-index="${i}"><span class="palette-kind">${esc(r.kind)}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.detail)}</small></span><span aria-hidden="true">${esc(r.shortcut || "↵")}</span></div>`,
      )
      .join("");
    status.textContent =
      message ||
      (!rows.length
        ? "No matches. Try a name, account, hostname or desk number."
        : `${rows.length} results`);
    setActive(0);
  }
  async function choose(index) {
    const row = rows[index];
    if (!row) return;
    if (row.person) {
      invalidate();
      const request = generation;
      status.textContent = "Finding mapped desks…";
      controller = new AbortController();
      try {
        const response = await fetch(
          "/api/palette/person/" + encodeURIComponent(row.person),
          { signal: controller.signal },
        );
        if (!response.ok)
          throw Error("Could not resolve this person. Try again.");
        const data = await response.json();
        if (request !== generation || !dialog.open) return;
        const desks = data.desks.filter((d) =>
          getRecords().some((r) => r.id === d.id),
        );
        if (desks.length === 1) {
          close();
          onSelect(desks[0].id);
          if (desks[0].match !== "confirmed account link")
            toast("Desk matched by name; account link is not confirmed.");
          return;
        }
        if (!desks.length) {
          close();
          await openConsole("person", row.person);
          return;
        }
        render(
          desks
            .map((d) => ({
              kind: "Desk",
              title: d.id,
              detail: `${row.title} · Floor ${d.floor} · ${d.match}`,
              run: () => onSelect(d.id),
            }))
            .concat({
              kind: "Person",
              title: "Open person details",
              detail: row.title,
              run: () => openConsole("person", row.person),
            }),
          "Multiple desk matches — choose a location.",
        );
      } catch (e) {
        if (e.name !== "AbortError" && request === generation)
          status.textContent = e.message;
      }
    } else {
      close();
      try {
        await row.run();
      } catch (e) {
        toast(e.message);
      }
    }
  }
  function search() {
    invalidate();
    const request = generation,
      raw = input.value.trim();
    const prefix = raw.match(/^(person|user|machine|desk|action):\s*/i);
    const kind = raw.startsWith(">") ? "action" : prefix?.[1]?.toLowerCase();
    const term = raw.startsWith(">")
      ? raw.slice(1).trim()
      : prefix
        ? raw.slice(prefix[0].length).trim()
        : raw;
    const q = normalize(term),
      words = q.split(/\s+/).filter(Boolean);
    const matches = (text) => words.every((w) => normalize(text).includes(w));
    const local = [];
    if (!kind || kind === "action")
      local.push(...actions.filter((a) => matches(a.title + " " + a.keywords)));
    if (q && (!kind || kind === "desk"))
      local.push(
        ...getRecords()
          .filter((r) => matches([r.id, r.name, r.team, r.hostname].join(" ")))
          .sort(
            (a, b) =>
              (normalize(b.id) === q) - (normalize(a.id) === q) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 12)
          .map((r) => ({
            kind: "Desk",
            title: r.name === "Unconfirmed desk" ? r.id : r.name,
            detail: `${r.id} · Floor ${r.floor} · ${r.team}`,
            run: () => onSelect(r.id),
          })),
      );
    const remote = q.length >= 2 && kind !== "desk" && kind !== "action";
    render(
      local,
      remote
        ? "Searching directory…"
        : q.length === 1 &&
            (!kind || ["user", "person", "machine"].includes(kind))
          ? "Type at least two characters for directory search."
          : "",
    );
    if (!remote) return;
    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const query =
          (kind === "person" || kind === "user"
            ? "user:"
            : kind === "machine"
              ? "machine:"
              : "") + term;
        const response = await fetch(
          "/api/search?" + new URLSearchParams({ term: query }),
          { signal: controller.signal },
        );
        if (!response.ok)
          throw Error(
            "Directory unavailable. Map and action results are still available.",
          );
        const data = await response.json();
        if (request !== generation || !dialog.open) return;
        const people = data.users.slice(0, 10).map((u) => ({
          kind: "Person",
          title: u.full_name || u.name,
          detail: [u.user_name, u.email, u.location]
            .filter(Boolean)
            .join(" · "),
          person: "id:" + u.id,
        }));
        const machines = data.machines.slice(0, 10).map((m) => ({
          kind: "Machine",
          title: m.name,
          detail: [m.model_id, m.operational_status]
            .filter(Boolean)
            .join(" · "),
          run: () => openConsole("machine", m.name),
        }));
        render(
          [...local, ...people, ...machines],
          data.users.length > 10 || data.machines.length > 10
            ? "Showing the first directory matches. Refine your search for more."
            : "",
        );
      } catch (e) {
        if (e.name !== "AbortError" && request === generation && dialog.open)
          render(local, e.message);
      }
    }, 180);
  }
  async function open(query = "", sourceDialog = null) {
    if (dialog.open) {
      if (typeof query === "string" && query) {
        input.value = query;
        search();
      }
      input.focus();
      return;
    }
    // Do not interrupt an existing edit/confirmation dialog.
    if (
      [...document.querySelectorAll("dialog[open]")].some(
        (existing) => existing !== sourceDialog,
      )
    )
      return;
    previousFocus =
      document.activeElement?.shadowRoot?.activeElement ||
      document.activeElement;
    dialog.showModal();
    input.value = typeof query === "string" ? query : "";
    search();
    input.focus();
    if (prepare) {
      try {
        await prepare();
        if (dialog.open) search();
      } catch {
        if (dialog.open)
          status.textContent =
            "Map records unavailable. Directory and commands are still available.";
      }
    }
  }
  trigger.onclick = open;
  input.oninput = search;
  dialog.querySelector(".palette-close").onclick = close;
  dialog.addEventListener("close", () => {
    invalidate();
    previousFocus?.focus();
  });
  dialog.addEventListener("cancel", invalidate);
  dialog.addEventListener("click", (e) => {
    const option = e.target.closest("[data-index]");
    if (option) choose(+option.dataset.index);
    else if (e.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        close();
    }
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && e.target === input) {
      e.preventDefault();
      choose(active);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (dialog.open) e.stopPropagation();
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open();
    }
  });
  window.addEventListener("atlas-directory-search", (event) => {
    const person = event.target.closest?.(".atlas-person"),
      query = event.detail?.query;
    if (!person || typeof query !== "string" || !query.trim()) return;
    open(query, person.closest(".viewer-lookup-dialog"));
  });
  return { open, close, dialog, root };
}
