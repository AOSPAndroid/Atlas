(() => {
  const by = (id) => document.getElementById("ad" + id);
  if (!by("Form")) return;
  let busy = false;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text != null) n.textContent = String(text);
    return n;
  };
  function controls() {
    by("Lookup").disabled = busy || !!window.AtlasReadOnly;
  }
  function render(data) {
    const result = by("Results");
    result.replaceChildren();
    result.append(
      el("p", `Queried ${data.queried_at} - ${data.server} - ${data.operator}`),
    );
    const table = el("table");
    table.className = "ad-details";
    for (const [name, value] of Object.entries(data.details)) {
      const row = el("tr");
      row.append(
        el("th", name),
        el("td", value == null || value === "" ? "Not supplied" : value),
      );
      table.append(row);
    }
    result.append(
      table,
      el("h3", `Group memberships (${data.groups.length})`),
      el("p", data.membership_note),
    );
    for (const warning of data.warnings || []) result.append(el("p", warning));
    const search = el("input");
    search.type = "search";
    search.placeholder = "Filter groups by name, scope or DN";
    search.setAttribute("aria-label", "Filter AD groups");
    result.append(search);
    const list = el("div");
    list.className = "ad-groups";
    result.append(list);
    const filter = () => {
      list.replaceChildren();
      const term = search.value.toLowerCase();
      const found = data.groups.filter((g) =>
        Object.values(g).join(" ").toLowerCase().includes(term),
      );
      for (const g of found) {
        const card = el("article");
        card.append(
          el("strong", g.name),
          el("p", `${g.membership} - ${g.category} - ${g.scope}`),
          el("small", g.dn),
        );
        list.append(card);
      }
      if (!found.length) list.append(el("p", "No matching groups."));
    };
    search.oninput = filter;
    filter();
  }
  by("Selected").onclick = () => {
    by("Kind").value = "computer";
    by("Identity").value = S.target || "";
    by("Results").replaceChildren();
    by("Status").textContent = S.target
      ? "Selected machine copied. Click Look up AD."
      : "Select a machine in Workspace first.";
  };
  for (const id of ["Kind", "Identity", "Server"])
    by(id).addEventListener("input", () => {
      by("Results").replaceChildren();
      by("Status").textContent =
        "Selection changed. Click Look up AD to refresh.";
    });
  by("Form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy || window.AtlasReadOnly) return;
    const payload = {
      kind: by("Kind").value,
      identity: by("Identity").value.trim(),
      server: by("Server").value.trim(),
    };
    busy = true;
    controls();
    by("Results").replaceChildren();
    by("Status").textContent = "Querying AD for " + payload.identity + "...";
    for (const id of ["Kind", "Identity", "Server", "Selected"])
      by(id).disabled = true;
    try {
      const result = await AtlasClient.request("/api/active-directory/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      render(result);
      by("Status").textContent =
        "AD lookup complete for " + payload.identity + ".";
    } catch (error) {
      by("Status").textContent = error.message;
    } finally {
      busy = false;
      for (const id of ["Kind", "Identity", "Server", "Selected"])
        by(id).disabled = false;
      controls();
    }
  };
  window.AtlasAD = {
    open() {
      controls();
      if (window.AtlasReadOnly)
        by("Status").textContent =
          "Live AD lookup is available only in local Admin. Demo and Preview do not query the directory.";
    },
  };
  controls();
})();
