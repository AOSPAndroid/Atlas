/* On-demand service inventory and confirmed, target-specific service control. */
(() => {
  const el = (id) => document.getElementById(id);
  const target = () => el("adminPc").value.trim().toUpperCase();
  let rows = [],
    computer = "",
    sequence = 0,
    listing = false,
    stopping = false,
    confirmation = null;
  const readonly = () => !!window.AtlasReadOnly;
  const request = (url, body) =>
    AtlasClient.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  function controls() {
    el("adminServices").disabled =
      readonly() || !target() || listing || stopping;
    el("refreshServices").disabled =
      readonly() || !target() || listing || stopping;
    el("servicesDialog").setAttribute("aria-busy", String(listing || stopping));
    for (const button of el("servicesBody").querySelectorAll(
      "[data-service-stop]",
    )) {
      const item = rows[Number(button.dataset.serviceStop)];
      button.disabled =
        readonly() ||
        listing ||
        stopping ||
        !!confirmation ||
        computer !== target() ||
        !item?.can_stop;
    }
  }
  function render() {
    const word = el("servicesFilter").value.trim().toLocaleLowerCase();
    const shown = rows
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        [item.name, item.display_name, item.state, item.start_mode].some(
          (value) =>
            String(value || "")
              .toLocaleLowerCase()
              .includes(word),
        ),
      );
    el("servicesCount").textContent =
      `${shown.length} of ${rows.length} services`;
    const body = el("servicesBody");
    body.replaceChildren();
    for (const { item, index } of shown) {
      const row = document.createElement("tr");
      const name = row.insertCell();
      name.textContent = item.display_name || item.name;
      const detail = document.createElement("small");
      detail.textContent = item.name;
      name.append(detail);
      for (const value of [item.state, item.start_mode, item.pid || "—"])
        row.insertCell().textContent = value;
      const button = document.createElement("button");
      button.className = "danger";
      button.textContent = "Stop…";
      button.dataset.serviceStop = index;
      button.setAttribute(
        "aria-label",
        `Stop ${item.display_name || item.name}`,
      );
      button.title = item.stop_reason || `Stop ${item.name} on ${computer}`;
      row.insertCell().append(button);
      body.append(row);
    }
    if (!shown.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 5;
      cell.textContent = rows.length
        ? "No services match this search."
        : "No services loaded.";
    }
    controls();
  }
  function changedTarget() {
    sequence++;
    listing = false;
    computer = "";
    rows = [];
    if (el("serviceStopDialog").open) el("serviceStopDialog").close();
    el("servicesTarget").textContent = target() || "No target";
    el("servicesStatus").textContent = target()
      ? "Choose Refresh to list services on this target."
      : "Choose a target and list its services.";
    render();
  }
  async function load() {
    if (readonly() || !target() || listing || stopping || confirmation) return;
    const pc = target(),
      turn = ++sequence;
    computer = pc;
    rows = [];
    listing = true;
    el("servicesTarget").textContent = pc;
    if (!el("servicesDialog").open) el("servicesDialog").showModal();
    el("servicesStatus").textContent = `Listing services on ${pc}…`;
    render();
    try {
      const result = await request("/api/services", { computer: pc });
      if (turn !== sequence || pc !== target()) return;
      if (result.computer?.toUpperCase() !== pc || !Array.isArray(result.items))
        throw Error("Service list did not match the target. Refresh services.");
      rows = result.items;
      el("servicesStatus").textContent =
        `${pc}: ${rows.length} services loaded. Stop is available where Windows allows it.`;
    } catch (error) {
      if (turn === sequence && pc === target())
        el("servicesStatus").textContent = error.message;
    } finally {
      if (turn === sequence) {
        listing = false;
        render();
      }
    }
  }
  async function stop(index) {
    const item = rows[index],
      pc = computer,
      turn = sequence;
    if (
      readonly() ||
      listing ||
      stopping ||
      confirmation ||
      pc !== target() ||
      !item?.can_stop
    )
      return;
    const selected = Object.freeze({ ...item });
    confirmation = selected;
    el("serviceStopQuestion").textContent =
      `Stop ${selected.display_name || selected.name} (${selected.name}) on ${pc}?`;
    controls();
    el("serviceStopDialog").showModal();
    el("cancelServiceStop").focus();
    const accepted = await new Promise((resolve) => {
      el("serviceStopDialog").returnValue = "";
      el("serviceStopDialog").addEventListener(
        "close",
        () => resolve(el("serviceStopDialog").returnValue === "stop"),
        { once: true },
      );
    });
    confirmation = null;
    if (!accepted || readonly() || pc !== target() || turn !== sequence) {
      controls();
      return;
    }
    stopping = true;
    controls();
    el("servicesStatus").textContent = `Stopping ${selected.name} on ${pc}…`;
    try {
      const result = await request("/api/services/stop", {
        computer: pc,
        name: selected.name,
        expected_identity: selected.identity,
      });
      if (pc !== target() || turn !== sequence) return;
      if (
        result.computer?.toUpperCase() !== pc ||
        result.name?.toLocaleLowerCase() !== selected.name.toLocaleLowerCase()
      )
        throw Error(
          "Stop outcome did not match the selected service. Refresh services before retrying.",
        );
      const confirmed =
        ["stopped", "already_stopped"].includes(result.outcome) &&
        result.state === "Stopped";
      const current = rows.find((row) => row.name === selected.name);
      if (current) {
        if (confirmed) {
          current.state = "Stopped";
          current.pid = 0;
        }
        current.can_stop = false;
        current.stop_reason = "Refresh services before another stop request";
      }
      el("servicesStatus").textContent =
        `${pc} · ${selected.name}: ${confirmed ? result.message || "Service stopped." : (result.message || "Stopped was not verified.") + " Refresh services before retrying."}`;
    } catch (error) {
      if (pc === target() && turn === sequence) {
        const current = rows.find((row) => row.name === selected.name);
        if (current) {
          current.can_stop = false;
          current.stop_reason = "Refresh services to verify the current state";
        }
        el("servicesStatus").textContent =
          `${pc} · ${selected.name}: ${error.message} Refresh services to verify the current state before retrying.`;
      }
    } finally {
      stopping = false;
      render();
    }
  }
  function bind() {
    if (!el("adminServices")) return;
    el("adminServices").addEventListener("click", load);
    el("refreshServices").addEventListener("click", load);
    el("servicesFilter").addEventListener("input", render);
    el("servicesBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-service-stop]");
      if (button && !button.disabled) stop(Number(button.dataset.serviceStop));
    });
    el("cancelServiceStop").onclick = () => el("serviceStopDialog").close();
    el("confirmServiceStop").onclick = () => {
      el("serviceStopDialog").returnValue = "stop";
      el("serviceStopDialog").close();
    };
    el("closeServices").onclick = () => el("servicesDialog").close();
    el("servicesDialog").addEventListener("close", () => {
      sequence++;
      listing = false;
      if (el("serviceStopDialog").open) el("serviceStopDialog").close();
      controls();
    });
    el("adminPc").addEventListener("input", changedTarget);
    window.addEventListener("atlas:admin-target-change", changedTarget);
    changedTarget();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
