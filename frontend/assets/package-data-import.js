/* Independent package CSV workflow; no directory or SharePoint-file changes. */
(() => {
  const $ = (id) => document.getElementById("package-data-" + id);
  if (!$("file")) return;
  const api = (url, options = {}) =>
    AtlasClient.request(url, { ...options, atlasSilent: true });
  let staged = null,
    working = false,
    interacted = false,
    operation = "";
  const message = (text) => {
    $("message").textContent = text;
  };
  const clear = () => {
    staged = null;
    $("review").hidden = true;
  };
  function controls() {
    $("file").disabled = working;
    $("validate").disabled = working;
    $("apply").disabled = working || !staged;
    $("cancel").disabled = working;
    $("progress").hidden = !working;
    $("controls").setAttribute("aria-busy", String(working));
    $("validate").textContent =
      operation === "validate" ? "Validating…" : "Validate and preview";
    $("apply").textContent =
      operation === "apply" ? "Saving…" : "Back up and save package data";
  }
  async function status() {
    const data = await api("/api/package-data/import/status");
    $("status").textContent =
      `${data.count.toLocaleString()} package metadata records${data.last_import ? ` · Last import: ${data.last_import.source} · ${data.last_import.at}` : " · No imports yet"}`;
  }
  async function task(kind, action) {
    if (working) return;
    interacted = true;
    working = true;
    operation = kind;
    controls();
    try {
      await action();
    } catch (error) {
      message(error.message + " You can try again.");
    } finally {
      working = false;
      operation = "";
      controls();
    }
  }
  function show(data) {
    staged = data.id;
    const r = data.report;
    $("source").textContent = data.source;
    $("summary").textContent =
      `${r.unique.toLocaleString()} unique short names · ${r.added.toLocaleString()} new · ${r.changed.toLocaleString()} updated · ${r.unchanged.toLocaleString()} unchanged · ${r.retained.toLocaleString()} existing records retained`;
    $("coverage").textContent = r.source_available
      ? `${r.matched.toLocaleString()} matched to ${r.source_packages.toLocaleString()} source folders · ${r.metadata_only.toLocaleString()} metadata only · ${r.ambiguous.toLocaleString()} ambiguous names`
      : r.note +
        " Source coverage will be checked when the folder is connected.";
    $("warnings").textContent = [
      r.duplicates ? `${r.duplicates} identical duplicate rows collapsed.` : "",
      r.extra_columns.length
        ? "Additional columns are retained: " + r.extra_columns.join(", ")
        : "",
      r.ambiguous
        ? "Ambiguous source folders will not receive matched metadata."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    $("examples").textContent = r.examples
      .map(
        (row) =>
          `${row.short_name} · ${row.state || "State not supplied"} · ${row.package_id || "No package ID"} · ${row.packager || "No packager"}`,
      )
      .join("\n");
    $("review").hidden = false;
    message(
      "Preview ready. Review the package changes below, then save. Preview expires in one hour.",
    );
  }
  $("file").onchange = () => {
    interacted = true;
    clear();
    const file = $("file").files[0];
    message(
      file
        ? `${file.name} selected. Click Validate and preview.`
        : "Choose the ServiceNow package CSV.",
    );
    controls();
  };
  $("validate").onclick = () =>
    task("validate", async () => {
      clear();
      const file = $("file").files[0];
      if (!file || !file.name.toLowerCase().endsWith(".csv"))
        throw Error("Choose a package CSV file.");
      if (file.size > 10 * 1024 * 1024)
        throw Error("Package CSV exceeds 10 MB.");
      message("Validating short names and comparing package metadata…");
      show(
        await api("/api/package-data/import/preview", {
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
    task("apply", async () => {
      message("Backing up and saving package metadata…");
      const result = await api("/api/package-data/import/apply/" + staged, {
        method: "POST",
      });
      clear();
      const completed = `Package data saved: ${result.count.toLocaleString()} records. Backup: ${result.backup}. Refresh the Packages tab in any open Atlas window.`;
      message(completed);
      try {
        await status();
      } catch {
        message(
          completed + " Import status could not refresh; reload this page.",
        );
      }
    });
  $("cancel").onclick = () =>
    task("cancel", async () => {
      if (staged)
        await api("/api/package-data/import/preview/" + staged, {
          method: "DELETE",
        });
      clear();
      message("Package preview discarded. Metadata unchanged.");
    });
  controls();
  status().catch((error) => {
    if (!interacted)
      $("status").textContent =
        "Package status unavailable: " +
        error.message +
        ". You can still validate a CSV.";
  });
})();
