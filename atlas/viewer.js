const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw Error("Lookup unavailable. Refresh and try again.");
  return r.json();
}
function personCard(u) {
  if (!u)
    return "<p>No confirmed directory account for this desk. Use User lookup to search the full directory.</p>";
  return AtlasUI.person(u);
}
function machinesCard(machines) {
  return (
    '<h3>Stored machine details</h3><p class="ops-muted">Directory inventory; no live or elevated checks are run.</p>' +
    (machines
      .map(
        (m) =>
          `<article class="viewer-machine"><b>${esc(m.name || m.machine_name)}</b><p>${esc(m.match_type || "Directory inventory")}</p><dl>${[
            ["Status", m.operational_status],
            ["Model", m.model_id || m.model],
            ["Serial", m.serial_number],
            ["Last discovered", m.last_discovered],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
            .join("")}</dl></article>`,
      )
      .join("") || "<p>No linked machines recorded.</p>")
  );
}

export function createViewerOperations({ onSelect, toast }) {
  let generation = 0;
  const button = document.createElement("button");
  button.textContent = "User lookup";
  button.id = "viewer-lookup";
  document.querySelector(".header-right").prepend(button);
  document.querySelector(".edition").textContent = "READ ONLY";
  document.querySelector(".empty-detail").innerHTML =
    '<span class="eyebrow">SHARED ATLAS</span><h2>Find a desk or colleague.</h2><p>Explore all ten floors, view seating and look up people and their stored machines.</p><small>Changes and elevated operations are available in the local admin version.</small>';
  button.onclick = () => {
    const dialog = document.createElement("dialog");
    dialog.className = "ops-dialog ops-wide";
    dialog.innerHTML =
      '<div class="ops-dialog-heading"><h2>User & machine lookup</h2><button aria-label="Close">×</button></div><form class="viewer-search"><label>Full directory<input type="search" required placeholder="Name, account, email, BRID or machine" aria-label="Directory search"></label><button class="primary">Search</button></form><div class="viewer-results" aria-live="polite"></div>';
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.onclose = () => dialog.remove();
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector("input").focus();
    const results = dialog.querySelector(".viewer-results");
    let request = 0;
    dialog.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const n = ++request;
      results.textContent = "Searching…";
      try {
        const data = await api(
          "/api/search?term=" +
            encodeURIComponent(dialog.querySelector("input").value.trim()),
        );
        if (n !== request || !dialog.isConnected) return;
        results.innerHTML =
          data.users
            .map(
              (u, i) =>
                `<button class="ops-user-result" data-user="${i}"><b>${esc(u.full_name || u.name)}</b><span>${esc(u.user_name)} · ${esc(u.email)}</span></button>`,
            )
            .join("") +
            (data.machines.length ? machinesCard(data.machines) : "") ||
          "<p>No matches. Try a surname or account.</p>";
        results.querySelectorAll("[data-user]").forEach(
          (b) =>
            (b.onclick = async () => {
              const version = ++request;
              try {
                const person = await api(
                  "/api/user/" +
                    encodeURIComponent("id:" + data.users[+b.dataset.user].id),
                );
                if (version !== request || !dialog.isConnected) return;
                results.innerHTML =
                  personCard(person.user) +
                  person.desks
                    .map(
                      (id, i) =>
                        `<button data-desk="${i}">Show desk ${esc(id)}${person.desk_matches?.[i]?.match !== "confirmed account link" ? " · name match, unconfirmed" : ""}</button>`,
                    )
                    .join("") +
                  machinesCard(person.machines);
                results.querySelectorAll("[data-desk]").forEach(
                  (d) =>
                    (d.onclick = () => {
                      dialog.close();
                      onSelect(person.desks[+d.dataset.desk]);
                    }),
                );
              } catch (e) {
                if (version === request) results.textContent = e.message;
              }
            }),
        );
      } catch (e) {
        if (n === request) results.textContent = e.message;
      }
    };
  };
  return {
    clear() {
      generation++;
    },
    async select(record) {
      const n = ++generation,
        host = document.querySelector("#ops-context");
      host.textContent = "Loading directory…";
      try {
        const data = await api(
          "/api/desks/" + encodeURIComponent(record.id) + "/context",
        );
        if (n !== generation || !host.isConnected) return;
        host.innerHTML = personCard(data.user) + machinesCard(data.machines);
      } catch (e) {
        if (n === generation && host.isConnected) host.textContent = e.message;
      }
    },
  };
}
