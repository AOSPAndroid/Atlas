const esc = (value) => AtlasUI.esc(value);
async function api(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.detail || "Lookup unavailable. Refresh and try again.");
  return data;
}
const personCard = (user) =>
  user
    ? AtlasUI.person(user)
    : '<p class="ops-muted">No confirmed directory account for this desk. Use User lookup to search the full directory.</p>';
const relationship = (row) =>
  row.assigned_relationship && row.logon_relationship
    ? "Assigned + last logged on (inventory)"
    : row.assigned_relationship
      ? "Assigned to user"
      : row.logon_relationship
        ? "Last logged on (inventory)"
        : row.match_type || "Directory inventory";
function machinesCard(machines, inspect = true) {
  return (
    '<h3>Stored machine details</h3><p class="ops-muted">Directory inventory; no live or elevated checks are run.</p>' +
    (machines
      .map((m) => {
        const name = m.name || m.machine_name;
        const fields = [
          ["Status", m.operational_status],
          ["Model", m.model_id || m.model],
          ["Serial", m.serial_number],
          ["Last discovered", m.last_discovered],
          ["Updated", m.updated_on],
          ["Assigned to", m.assigned_to],
          ["Last logon", m.last_logon_user],
          ["Description", m.short_description],
          ["Class", m.sys_class_name],
        ];
        return `<article class="viewer-machine"><b>${esc(name)}</b><p class="ops-muted">${esc(relationship(m))}</p><dl class="viewer-facts">${fields
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
          .join(
            "",
          )}</dl>${inspect ? `<button type="button" data-machine="${esc(name)}">Inspect machine</button>` : ""}</article>`;
      })
      .join("") || "<p>No linked machines recorded.</p>")
  );
}
function deskButtons(desks) {
  return desks.length
    ? '<div class="viewer-desk-links">' +
        desks
          .map(
            (d) =>
              `<button type="button" data-desk="${esc(d.id)}">Show desk ${esc(d.id)} · L${d.floor}${d.match === "confirmed account link" ? "" : d.match === "recorded at this desk" ? " · equipment record" : " · name match, unconfirmed"}</button>`,
          )
          .join("") +
        "</div>"
    : '<p class="ops-muted">No mapped desk recorded.</p>';
}
function userButtons(users) {
  return users
    .map(
      (u) =>
        `<button type="button" class="ops-user-result" data-person="id:${u.id}"><b>${esc(u.full_name || u.name)}</b><span>${esc(u.user_name)} · ${esc(u.email)}</span>${u.assigned_relationship || u.logon_relationship ? `<small>${esc(relationship(u))}</small>` : ""}</button>`,
    )
    .join("");
}

export function createViewerOperations({ onSelect, toast }) {
  let generation = 0,
    deskRequest,
    lookup = null,
    lookupVersion = 0,
    lookupRequest;
  const button = document.createElement("button");
  button.textContent = "User lookup";
  button.id = "viewer-lookup";
  document.querySelector(".header-right").prepend(button);
  document.querySelector(".edition").textContent = "READ ONLY";
  document.querySelector(".empty-detail").innerHTML =
    '<span class="eyebrow">SHARED ATLAS</span><h2>Find a desk or colleague.</h2><p>Search people, machines and locations with Ctrl+K, or explore all ten floors.</p><small>Shared directory and inventory. Changes and elevated operations require the local admin version.</small>';
  function bindLinks(host) {
    host
      .querySelectorAll("[data-person]")
      .forEach((b) => (b.onclick = () => openPerson(b.dataset.person)));
    host
      .querySelectorAll("[data-machine]")
      .forEach((b) => (b.onclick = () => openMachine(b.dataset.machine)));
    host.querySelectorAll("[data-desk]").forEach(
      (b) =>
        (b.onclick = () => {
          lookup?.element.close();
          onSelect(b.dataset.desk);
        }),
    );
  }
  function ensureLookup() {
    if (lookup?.element.isConnected) return lookup;
    const { element, body } = AtlasUI.dialog("User & machine lookup");
    element.classList.add("viewer-lookup-dialog");
    body.innerHTML =
      '<form class="viewer-search"><label>Full directory<input type="search" required placeholder="Name, account, email, BRID or machine" aria-label="Directory search"></label><button class="primary">Search</button></form><div class="viewer-results" aria-live="polite"></div>';
    const input = body.querySelector("input"),
      results = body.querySelector(".viewer-results");
    const current = { element, body, input, results };
    lookup = current;
    element.addEventListener(
      "close",
      () => {
        if (lookup === current) {
          lookupVersion++;
          lookupRequest?.abort();
          lookup = null;
        }
      },
      { once: true },
    );
    body.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      search(input.value.trim());
    };
    input.focus();
    return current;
  }
  async function show(url, render, query) {
    const current = ensureLookup();
    const version = ++lookupVersion;
    lookupRequest?.abort();
    lookupRequest = new AbortController();
    if (query !== undefined) current.input.value = query;
    current.results.textContent = "Loading directory…";
    try {
      const data = await api(url, lookupRequest.signal);
      if (version !== lookupVersion || !current.element.isConnected) return;
      current.results.innerHTML = render(data);
      bindLinks(current.results);
      const copy = current.results.querySelector("[data-copy-report]");
      if (copy)
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              current.results.innerText.replace(copy.textContent, ""),
            );
            toast("Stored inventory report copied");
          } catch {
            toast("Copy unavailable. Select the report text to copy it.");
          }
        };
    } catch (error) {
      if (
        error.name !== "AbortError" &&
        version === lookupVersion &&
        current.element.isConnected
      )
        current.results.textContent = error.message;
    }
  }
  function search(term) {
    return show(
      "/api/search?" + new URLSearchParams({ term }),
      (data) =>
        userButtons(data.users) +
          (data.machines.length ? machinesCard(data.machines) : "") ||
        "<p>No matches. Try a surname or account.</p>",
      term,
    );
  }
  function openPerson(uid) {
    return show(
      "/api/user/" + encodeURIComponent(uid),
      (person) =>
        personCard(person.user) +
        deskButtons(
          person.desk_matches ||
            person.desks.map((id) => ({ id, match: "matching name" })),
        ) +
        machinesCard(person.machines),
    );
  }
  function openMachine(name) {
    return show(
      "/api/machine/" + encodeURIComponent(name),
      (data) =>
        machinesCard([data.machine], false) +
        '<button type="button" data-copy-report>Copy stored report</button><h3>Linked people</h3><p class="ops-muted">Recorded assignment and logon relationships; not a live sign-in check.</p>' +
        (userButtons(data.users) || "<p>No linked people recorded.</p>") +
        deskButtons(data.desks),
      "machine:" + name,
    );
  }
  const openLookup = () => {
    const current = ensureLookup();
    current.input.focus();
  };
  button.onclick = openLookup;
  return {
    openLookup,
    openPerson,
    openMachine,
    clear() {
      generation++;
      deskRequest?.abort();
    },
    async select(record) {
      const n = ++generation,
        host = document.querySelector("#ops-context");
      deskRequest?.abort();
      deskRequest = new AbortController();
      host.textContent = "Loading directory…";
      try {
        const data = await api(
          "/api/desks/" + encodeURIComponent(record.id) + "/context",
          deskRequest.signal,
        );
        if (n !== generation || !host.isConnected) return;
        const label =
          data.match_method === "confirmed"
            ? "Confirmed account link"
            : data.user
              ? "Name match · account unconfirmed"
              : data.candidates?.length > 1
                ? "Multiple possible people · choose a directory record"
                : "No confirmed account link";
        host.innerHTML =
          `<span class="ops-chip ${data.match_method === "confirmed" ? "good" : ""}">${esc(label)}</span>` +
          personCard(data.user) +
          (data.user
            ? `<button type="button" data-person="id:${data.user.id}">Open person details</button>`
            : userButtons(data.candidates || [])) +
          machinesCard(data.machines);
        bindLinks(host);
      } catch (error) {
        if (error.name !== "AbortError" && n === generation && host.isConnected)
          host.textContent = error.message;
      }
    },
  };
}
