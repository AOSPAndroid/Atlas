(() => {
  const $ = (id) => document.getElementById(id);
  let token = "",
    staged = null,
    working = false;
  const esc = (v) =>
    String(v ?? "").replace(
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
  async function api(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: { "X-Atlas-Token": token, ...opts.headers },
    });
    const d = await r.json();
    if (!r.ok) throw Error(d.detail || "Request failed");
    return d;
  }
  function controls() {
    $("apply").disabled =
      working ||
      !staged ||
      !$("full").checked ||
      $("confirm").value !== "APPLY";
    $("validate").disabled = working;
    $("file").disabled = working;
    $("cancel").disabled = working;
    document
      .querySelectorAll("[data-restore]")
      .forEach((b) => (b.disabled = working));
  }
  async function task(fn) {
    if (working) return;
    working = true;
    controls();
    try {
      await fn();
    } catch (e) {
      $("message").textContent = e.message;
    } finally {
      working = false;
      controls();
    }
  }
  async function status() {
    const d = await api("/api/database/status");
    if ($("coverage") && d.coverage)
      $("coverage").innerHTML = coverage(d.coverage);
    $("message").textContent =
      `${d.counts.users.toLocaleString()} users · ${d.counts.machines.toLocaleString()} machines · ${d.counts.assignments.toLocaleString()} relationships${d.busy ? " — jobs active; imports are blocked." : ""}`;
    $("history").innerHTML = d.history.length
      ? d.history
          .map(
            (r) =>
              `<article><b>${esc(r.source)}</b><p>${esc(r.at)}</p><button data-restore="${esc(r.id)}">Restore directory before this import</button></article>`,
          )
          .join("")
      : "<p>No GUI imports yet. Existing directory and command-line refreshes are not listed here.</p>";
    document.querySelectorAll("[data-restore]").forEach(
      (b) =>
        (b.onclick = () =>
          task(async () => {
            staged = null;
            $("preview").hidden = true;
            $("message").textContent = "Preparing backup comparison…";
            show(
              await api("/api/database/restore-preview/" + b.dataset.restore, {
                method: "POST",
              }),
            );
          })),
    );
  }
  function show(d) {
    staged = d.id;
    $("source").textContent = d.source;
    $("full").checked = false;
    $("confirm").value = "";
    $("changes").innerHTML = ["users", "machines", "relationships"]
      .map((k) => {
        const x = d.report[k];
        return `<article><b>${esc(k)}</b><p>${x.before.toLocaleString()} → ${x.after.toLocaleString()}</p><p>+${x.added} added · −${x.removed} removed${x.changed !== undefined ? " · " + x.changed + " changed" : ""}</p></article>`;
      })
      .join("");
    if (d.report.coverage)
      $("changes").insertAdjacentHTML(
        "beforeend",
        `<article><h3>Incoming export columns</h3>${coverage(d.report.coverage)}</article>`,
      );
    $("warnings").textContent = [
      ...d.report.warnings,
      `${d.report.unlinked_machine_references} machines have user references but no resolved relationship.`,
      `${d.report.missing_desk_accounts.length} confirmed desk links point to accounts absent from this extract.`,
    ].join(" ");
    $("examples").textContent = JSON.stringify(
      {
        added_users: d.report.users.added_examples,
        removed_users: d.report.users.removed_examples,
        added_machines: d.report.machines.added_examples,
        removed_machines: d.report.machines.removed_examples,
        missing_desk_accounts: d.report.missing_desk_accounts,
      },
      null,
      2,
    );
    $("preview").hidden = false;
    $("message").textContent =
      "Preview ready. No directory data has changed. Preview expires after one hour.";
  }
  $("validate").onclick = () =>
    task(async () => {
      const file = $("file").files[0];
      if (!file) throw Error("Choose an Excel workbook.");
      if (!file.name.toLowerCase().endsWith(".xlsx"))
        throw Error("Use an .xlsx workbook.");
      staged = null;
      $("preview").hidden = true;
      $("message").textContent = "Validating and comparing your extract…";
      show(
        await api("/api/database/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
          },
          body: file,
        }),
      );
    });
  $("apply").onclick = () =>
    task(async () => {
      $("message").textContent = "Backing up and applying directory changes…";
      const d = await api("/api/database/apply/" + staged, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: $("confirm").value,
          full_snapshot: $("full").checked,
        }),
      });
      staged = null;
      $("preview").hidden = true;
      await status();
      $("message").textContent +=
        "\nImport completed. Backup: " +
        d.backup +
        "\nReload any open Atlas or console tabs to refresh displayed records.";
    });
  $("cancel").onclick = () =>
    task(async () => {
      if (staged)
        await api("/api/database/preview/" + staged, { method: "DELETE" });
      staged = null;
      $("preview").hidden = true;
      $("message").textContent = "Preview discarded. Directory unchanged.";
    });
  $("full").onchange = controls;
  $("confirm").oninput = controls;
  function coverage(data) {
    return (
      `<p>${data.original_cells ? "Original export cells retained, including additional columns and sheets." : "This database predates original-cell retention. The stored directory columns are listed below; the next directory refresh will also retain original cells."}</p>` +
      data.sheets
        .map(
          (sheet) =>
            `<details><summary>${esc(sheet.sheet)} · ${sheet.columns.length} columns · ${sheet.rows.toLocaleString()} rows</summary><p>${esc(sheet.source)} · ${sheet.linked.toLocaleString()} rows linked to directory records</p><div style="overflow-x:auto"><table><thead><tr><th>Export column</th><th>Populated</th><th>Used in Atlas</th></tr></thead><tbody>${sheet.columns.map((col) => `<tr><td>${esc(col.header)}</td><td>${col.populated.toLocaleString()} / ${sheet.rows.toLocaleString()}</td><td>${esc(col.label)} · ${esc(col.use)}</td></tr>`).join("")}</tbody></table></div></details>`,
        )
        .join("")
    );
  }
  task(async () => {
    token = (await api("/api/session")).token;
    await status();
  });
})();
