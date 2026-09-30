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
    if (window.AtlasAD) window.AtlasAD.groupActions = null;
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
    renderGroups(data, result);
  }
  let primary = null,
    secondary = null;
  function csvCell(value) {
    let s = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function renderGroups(data, result) {
    primary = data;
    secondary = null;
    const bar = el("div");
    bar.className = "ad-group-tools";
    const search = el("input");
    search.type = "search";
    search.placeholder = "Group name";
    search.setAttribute("aria-label", "Filter AD groups");
    const mode = el("select");
    mode.setAttribute("aria-label", "Group name match");
    for (const [v, t] of [
      ["contains", "Contains"],
      ["starts", "Starts with"],
      ["ends", "Ends with"],
      ["exact", "Equals"],
      ["excludes", "Does not contain"],
    ]) {
      const o = el("option", t);
      o.value = v;
      mode.append(o);
    }
    const view = el("select");
    view.setAttribute("aria-label", "Membership comparison");
    for (const [v, t] of [
      ["all", "All groups"],
      ["both", "In both"],
      ["first", "Only first object"],
      ["second", "Only second object"],
    ]) {
      const o = el("option", t);
      o.value = v;
      view.append(o);
    }
    view.disabled = true;
    const download = el("button", "Export CSV");
    download.type = "button";
    bar.append(mode, search, view, download);
    result.append(bar);
    const compare = el("form");
    compare.className = "ad-group-tools";
    const kind = el("select");
    kind.setAttribute("aria-label", "Compare object type");
    for (const v of ["user", "computer"]) {
      const o = el("option", v);
      o.value = v;
      kind.append(o);
    }
    kind.value = by("Kind").value;
    const identity = el("input");
    identity.required = true;
    identity.maxLength = 128;
    identity.placeholder = "Compare with account / machine";
    identity.setAttribute("aria-label", "Compare AD object");
    const server = el("input");
    server.maxLength = 128;
    server.placeholder = "Domain / controller (optional)";
    server.value = by("Server").value;
    server.setAttribute("aria-label", "Comparison domain or controller");
    const go = el("button", "Compare groups");
    const status = el("p");
    status.setAttribute("role", "status");
    compare.append(kind, identity, server, go);
    result.append(compare, status);
    const count = el("p");
    const list = el("div");
    list.className = "ad-groups";
    result.append(count, list);
    let rows = [];
    const key = (g) => String(g.dn || g.name).toLowerCase();
    const filter = () => {
      const a = new Map(primary.groups.map((g) => [key(g), g]));
      const b = new Map((secondary?.groups || []).map((g) => [key(g), g]));
      rows = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({
        ...(a.get(k) || b.get(k)),
        firstMembership: a.get(k)?.membership || "",
        secondMembership: b.get(k)?.membership || "",
        presence: secondary
          ? a.has(k) && b.has(k)
            ? "both"
            : a.has(k)
              ? "first"
              : "second"
          : "first",
      }));
      const term = search.value.trim().toLowerCase();
      rows = rows
        .filter((g) => {
          const n = String(g.name || "").toLowerCase();
          return (
            (!term ||
              {
                contains: () => n.includes(term),
                starts: () => n.startsWith(term),
                ends: () => n.endsWith(term),
                exact: () => n === term,
                excludes: () => !n.includes(term),
              }[mode.value]()) &&
            (view.value === "all" || g.presence === view.value)
          );
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      list.replaceChildren();
      count.textContent =
        rows.length +
        " matching groups" +
        (secondary
          ? " · Comparing " +
            (primary.details.Account || primary.details.Name) +
            " with " +
            (secondary.details.Account || secondary.details.Name)
          : "");
      for (const g of rows) {
        const card = el("article");
        card.append(
          el("strong", g.name),
          el(
            "p",
            secondary
              ? {
                  both: "In both",
                  first: "Only first object",
                  second: "Only second object",
                }[g.presence]
              : g.membership,
          ),
          el("small", g.dn),
        );
        list.append(card);
      }
      if (!rows.length) list.append(el("p", "No matching groups."));
      download.disabled = !rows.length;
    };
    search.oninput = filter;
    mode.onchange = filter;
    view.onchange = filter;
    download.onclick = () => {
      const columns = [
        "First object",
        "Second object",
        "Comparison",
        "Group name",
        "Distinguished name",
        "Scope",
        "Category",
        "First membership",
        "Second membership",
      ];
      const records = rows.map((g) => [
        primary.details.Account || primary.details.Name,
        secondary?.details.Account || secondary?.details.Name || "",
        secondary ? g.presence : "Not compared",
        g.name,
        g.dn,
        g.scope,
        g.category,
        g.firstMembership,
        g.secondMembership,
      ]);
      const csv =
        "\uFEFF" +
        [columns, ...records]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = el("a");
      link.href = url;
      link.download = "atlas-ad-groups.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    compare.onsubmit = async (e) => {
      e.preventDefault();
      if (busy || window.AtlasReadOnly) return;
      busy = true;
      controls();
      secondary = null;
      view.value = "all";
      view.disabled = true;
      filter();
      const inputs = [
        kind,
        identity,
        server,
        go,
        by("Kind"),
        by("Identity"),
        by("Server"),
        by("Selected"),
      ];
      inputs.forEach((n) => (n.disabled = true));
      status.textContent = "Comparing memberships…";
      try {
        secondary = await AtlasClient.request("/api/active-directory/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: kind.value,
            identity: identity.value.trim(),
            server: server.value.trim(),
          }),
        });
        view.disabled = false;
        status.textContent =
          "Comparison complete. " + (secondary.warnings || []).join(" ");
        filter();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        inputs.forEach((n) => (n.disabled = false));
        controls();
      }
    };
    for (const n of [kind, identity, server])
      n.oninput = () => {
        secondary = null;
        view.value = "all";
        view.disabled = true;
        status.textContent =
          "Comparison changed. Click Compare groups to refresh.";
        filter();
      };
    window.AtlasAD.groupActions = {
      filter: () => search.focus(),
      compare: () => identity.focus(),
      export: () => download.click(),
    };
    filter();
  }

  by("Selected").onclick = () => {
    by("Kind").value = "computer";
    by("Identity").value = S.target || "";
    by("Results").replaceChildren();
    if (window.AtlasAD) window.AtlasAD.groupActions = null;
    by("Status").textContent = S.target
      ? "Selected machine copied. Click Look up AD."
      : "Select a machine in Workspace first.";
  };
  for (const id of ["Kind", "Identity", "Server"])
    by(id).addEventListener("input", () => {
      by("Results").replaceChildren();
      window.AtlasAD.groupActions = null;
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
    if (window.AtlasAD) window.AtlasAD.groupActions = null;
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
    show(kind, identity, run = true) {
      if (busy) return;
      page("active-directory");
      by("Kind").value = kind;
      by("Identity").value = identity || "";
      by("Results").replaceChildren();
      this.groupActions = null;
      this.open();
      if (run && identity && !window.AtlasReadOnly) by("Form").requestSubmit();
      else by("Identity").focus();
    },
    command(id) {
      if (id === "ad-user-groups")
        return this.show("user", S.user?.user_name || S.user?.email || "");
      if (id === "ad-machine-groups")
        return this.show("computer", S.target || "");
      page("active-directory");
      const action = {
        "ad-compare": "compare",
        "ad-filter-groups": "filter",
        "ad-export-groups": "export",
      }[id];
      if (this.groupActions?.[action]) this.groupActions[action]();
      else {
        by("Status").textContent =
          "Look up an AD object first to " +
          (action || "view") +
          " its groups.";
        by("Identity").focus();
      }
    },
    open() {
      controls();
      if (window.AtlasReadOnly)
        by("Status").textContent =
          "Live AD lookup is available only in local Admin. Demo and Preview do not query the directory.";
    },
  };
  controls();
})();
