/* Remote Admin snapshots keep every process action bound to its original machine. */
const adminRequest = AtlasClient.latest();
let processSnapshot = null,
  processActionPending = false;
const adminComputer = () => $("#adminPc").value.trim().toUpperCase();
function closeProcessMenu() {
  $("#processMenu").classList.add("hidden");
}
function invalidateProcesses() {
  adminRequest();
  if ($("#processKillDialog").open) $("#processKillDialog").close();
  processSnapshot = null;
  S.processes = [];
  closeProcessMenu();
  $("#adminOut").replaceChildren();
  $("#adminOverview").replaceChildren();
  $("#processStatus").textContent =
    "Choose CPU, GPU or Memory to load processes.";
  $("#refreshProcesses").disabled = true;
}
async function admin(kind) {
  const pc = adminComputer();
  if (!pc) return toast("Enter a computer first");
  invalidateProcesses();
  const request = adminRequest(),
    isProcess = ["cpu", "gpu", "memory"].includes(kind),
    current = () => request.current() && pc === adminComputer();
  $("#processStatus").textContent = `Loading ${kind.toUpperCase()} on ${pc}…`;
  try {
    const data = await api(
      isProcess
        ? `/api/processes/${encodeURIComponent(pc)}?kind=${kind}`
        : `/api/${kind}/${encodeURIComponent(pc)}`,
      { signal: request.signal },
    );
    if (!current()) return;
    if (isProcess) {
      processSnapshot = Object.freeze({
        computer: pc,
        kind,
        checked: new Date().toLocaleTimeString(),
      });
      S.processes = data;
      $("#refreshProcesses").disabled = false;
      renderProcesses();
    } else {
      $("#adminOverview").innerHTML =
        `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
      $("#processStatus").textContent =
        "Choose CPU, GPU or Memory to load processes.";
    }
  } catch (error) {
    if (error.name !== "AbortError" && current()) {
      $("#processStatus").textContent = error.message;
      toast(error.message);
    }
  }
}
function renderProcesses() {
  closeProcessMenu();
  if (!processSnapshot || processSnapshot.computer !== adminComputer()) return;
  const q = $("#processFilter").value.trim().toLowerCase(),
    rows = S.processes
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        [row.PID, row.Process, row.SessionId, row.CommandLine].some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(q),
        ),
      ),
    metric = processSnapshot.kind === "gpu" ? "GPU" : "CPU",
    columns = [
      ["Process", "Process"],
      ["PID", "PID"],
      ...(processSnapshot.kind === "memory" ? [] : [[metric, metric + " %"]]),
      ["MemoryMB", "Memory MB"],
      ["SessionId", "Session"],
      ...(metric === "GPU" ? [["Engine", "GPU engine"]] : []),
    ];
  $("#processStatus").textContent =
    `${processSnapshot.computer} · Top ${S.processes.length} by ${processSnapshot.kind.toUpperCase()} · Checked ${processSnapshot.checked}${q ? ` · ${rows.length} matching` : ""}${metric === "GPU" ? " · Busiest GPU engine per process" : ""}`;
  $("#adminOut").innerHTML = rows.length
    ? `<table class="process-table"><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${rows.map(({ row, index }) => `<tr data-process-index="${index}" tabindex="0" aria-label="${esc(row.Process)}, PID ${esc(row.PID)}" title="${esc(row.CommandLine || row.Process)}">${columns.map(([key]) => `<td>${esc(row[key] ?? "—")}</td>`).join("")}<td><button data-process-actions="${index}" aria-label="Actions for ${esc(row.Process)}, PID ${esc(row.PID)}">•••</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">No matching processes.</p>';
}
function confirmProcessKill(question) {
  const dialog = $("#processKillDialog");
  $("#processKillQuestion").textContent = question;
  dialog.returnValue = "";
  return new Promise((resolve) => {
    dialog.onclose = () => resolve(dialog.returnValue === "kill");
    $("#cancelProcessKill").onclick = () => dialog.close();
    $("#confirmProcessKill").onclick = () => {
      dialog.returnValue = "kill";
      dialog.close();
    };
    dialog.showModal();
    $("#cancelProcessKill").focus();
  });
}
async function terminateProcess(payload, question, snapshot) {
  if (processActionPending) return;
  if (
    payload.computer !== adminComputer() ||
    (snapshot && snapshot !== processSnapshot)
  )
    return toast("Target or process list changed. Select the process again.");
  processActionPending = true;
  $("#killBtn").disabled = true;
  try {
    if (!(await confirmProcessKill(question))) return;
    if (
      payload.computer !== adminComputer() ||
      (snapshot && snapshot !== processSnapshot)
    )
      return toast("Target or process list changed. Select the process again.");
    const result = await api("/api/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const failures = (result.results || []).filter(
        (row) => row.state !== "terminated",
      ),
      message = `${payload.computer}: ${result.count} terminated${failures.length ? "; " + failures.map((row) => `${row.Process} (${row.PID}): ${row.message}`).join("; ") : result.count ? "" : "; no matching process is still running"}`;
    toast(message);
    if (payload.computer === adminComputer()) {
      if (snapshot && snapshot === processSnapshot && result.count)
        await admin(snapshot.kind);
      if (failures.length || !result.count)
        $("#processStatus").textContent = message;
    }
  } catch (error) {
    toast(error.message);
    if (payload.computer === adminComputer())
      $("#processStatus").textContent = error.message;
  } finally {
    processActionPending = false;
    $("#killBtn").disabled = false;
  }
}
function processMenu(event, index) {
  const snapshot = processSnapshot,
    row = S.processes[index],
    menu = $("#processMenu");
  if (!snapshot || snapshot.computer !== adminComputer() || !row) return;
  event.preventDefault();
  const payload = Object.freeze({
    computer: snapshot.computer,
    value: String(row.PID),
    created: row.CreatedAt,
    name: row.Process,
  });
  menu.replaceChildren();
  menu.setAttribute("aria-label", `Actions for ${row.Process}, PID ${row.PID}`);
  const add = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.onclick = () => {
      closeProcessMenu();
      Promise.resolve(action()).catch((error) => toast(error.message));
    };
    menu.append(button);
    return button;
  };
  const kill = add("Kill process", () =>
    terminateProcess(
      payload,
      `Kill ${row.Process} (PID ${row.PID}) on ${snapshot.computer}?`,
      snapshot,
    ),
  );
  kill.className = "danger";
  kill.disabled =
    row.CanTerminate !== true || !row.CreatedAt || processActionPending;
  kill.title =
    row.BlockReason ||
    (kill.disabled
      ? "Process identity unavailable or an action is pending"
      : "Terminate this process only");
  add("Copy PID", () => copy(row.PID, "PID"));
  add("Copy process details", () =>
    copy(
      `${snapshot.computer}\n${JSON.stringify(row, null, 2)}`,
      "Process details",
    ),
  );
  menu.classList.remove("hidden");
  menu.style.left = menu.style.top = "8px";
  const bounds = menu.getBoundingClientRect();
  menu.style.left =
    Math.max(8, Math.min(event.clientX, innerWidth - bounds.width - 8)) + "px";
  menu.style.top =
    Math.max(8, Math.min(event.clientY, innerHeight - bounds.height - 8)) +
    "px";
  menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  menu.onkeydown = (e) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")],
      i = buttons.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      buttons[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) %
              buttons.length
      ]?.focus();
    }
    if (["Escape", "Tab"].includes(e.key)) {
      closeProcessMenu();
      if (e.key === "Escape") {
        e.preventDefault();
        $("#adminOut")
          ?.querySelector(`[data-process-index="${index}"]`)
          ?.focus({ preventScroll: true });
      }
    }
  };
}
function bindProcessControls() {
  $("#adminPc").addEventListener("input", invalidateProcesses);
  $("#processFilter").oninput = renderProcesses;
  $("#refreshProcesses").onclick = () =>
    processSnapshot && admin(processSnapshot.kind);
  $("#killBtn").onclick = () => {
    const computer = adminComputer(),
      value = $("#kill").value.trim();
    if (!computer || !value)
      return toast("Enter a computer and a PID or executable name");
    return terminateProcess(
      { computer, value },
      `Kill ${/^\d+$/.test(value) ? "PID " + value : "all processes named " + value} on ${computer}?`,
      processSnapshot,
    );
  };
  $("#adminOut").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-process-index]");
    if (row) processMenu(event, Number(row.dataset.processIndex));
  });
  $("#adminOut").addEventListener("click", (event) => {
    const button = event.target.closest("[data-process-actions]");
    if (!button) return;
    const rect = button.getBoundingClientRect();
    processMenu(
      { clientX: rect.left, clientY: rect.bottom, preventDefault() {} },
      Number(button.dataset.processActions),
    );
  });
  $("#adminOut").addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-process-index]");
    if (
      row &&
      (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
    ) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      processMenu(
        { clientX: rect.left + 12, clientY: rect.bottom, preventDefault() {} },
        Number(row.dataset.processIndex),
      );
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("#processMenu")) closeProcessMenu();
  });
  window.addEventListener("resize", closeProcessMenu);
  window.addEventListener("blur", closeProcessMenu);
  window.addEventListener(
    "scroll",
    (e) => {
      if (e.target === window || !$("#processMenu").contains(e.target))
        closeProcessMenu();
    },
    true,
  );
}
