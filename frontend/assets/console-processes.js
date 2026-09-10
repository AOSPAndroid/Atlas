/* Remote Admin snapshots keep every process action bound to its original machine. */
const adminRequest = AtlasClient.latest();
const threadRequest = AtlasClient.latest();
let processSnapshot = null,
  processActionPending = false,
  threadSelection = null;
const adminComputer = () => $("#adminPc").value.trim().toUpperCase();
function closeProcessMenu() {
  $("#processMenu").classList.add("hidden");
}
function invalidateProcesses() {
  window.AtlasDiagnostics?.clear();
  adminRequest();
  threadRequest();
  threadSelection = null;
  if ($("#threadDialog").open) $("#threadDialog").close();
  if ($("#processKillDialog").open) $("#processKillDialog").close();
  processSnapshot = null;
  S.processes = [];
  closeProcessMenu();
  $("#adminOut").replaceChildren();
  $("#adminOverview").replaceChildren();
  $("#processStatus").textContent =
    "Choose CPU, GPU or Memory to load processes.";
  $("#refreshProcesses").disabled = true;
  $("#copyPerformance").disabled = true;
}
async function admin(kind) {
  const pc = adminComputer();
  if (!pc) return toast("Enter a computer first");
  if (kind === "overview") kind = "cpu";
  invalidateProcesses();
  const request = adminRequest(),
    isProcess = ["cpu", "gpu", "memory"].includes(kind),
    current = () => request.current() && pc === adminComputer();
  $("#processStatus").textContent = `Loading ${kind.toUpperCase()} on ${pc}…`;
  try {
    const data = await api(
      isProcess
        ? `/api/performance/${encodeURIComponent(pc)}?kind=${kind}`
        : `/api/${kind}/${encodeURIComponent(pc)}`,
      { signal: request.signal },
    );
    if (!current()) return;
    if (isProcess) {
      processSnapshot = Object.freeze({
        computer: pc,
        kind,
        checked: new Date().toLocaleTimeString(),
        data: Array.isArray(data) ? { items: data, summary: {} } : data,
      });
      S.processes = processSnapshot.data.items;
      $("#refreshProcesses").disabled = false;
      $("#copyPerformance").disabled = false;
      renderPerformance();
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
      );
  $("#processStatus").textContent =
    `${processSnapshot.computer} · ${S.processes.length} of ${processSnapshot.data.total_processes ?? S.processes.length} processes · Sorted by ${processSnapshot.kind.toUpperCase()} · Checked ${processSnapshot.checked}${q ? ` · ${rows.length} matching` : ""}`;
  $("#adminOut").innerHTML = rows.length
    ? `<table class="process-table"><thead><tr><th>Process / PID</th><th>CPU %</th><th>GPU %</th><th>Memory / RAM %</th><th>Threads</th><th>I/O / sec</th><th>Actions</th></tr></thead><tbody>${rows.map(({ row, index }) => `<tr data-process-index="${index}" tabindex="0" aria-label="${esc(row.Process)}, PID ${esc(row.PID)}" title="${esc(row.CommandLine || row.Process)}"><td><b>${esc(row.Process)}</b><small>PID ${esc(row.PID)} · Session ${esc(row.SessionId ?? "—")}</small></td><td>${perfMeter(row.CPU, 10, 25)}</td><td>${perfMeter(row.GPU, 50, 80)}<small>${esc(row.Engine || "No engine reported")}</small></td><td>${perfMeter(row.MemoryPercent, 10, 20)}<small>${perfBytes(row.MemoryBytes ?? (row.MemoryMB == null ? null : row.MemoryMB * 1048576))} resident</small></td><td><button class="thread-link ${perfNumber(row.Threads) >= 500 ? "perf-warn" : ""}" data-process-threads="${index}" ${row.CreatedAt ? "" : "disabled"} title="Inspect CPU usage per thread; thread count alone does not indicate overload">${perfValue(row.Threads)} ↗</button></td><td>${perfBytes(row.IOBytesPerSec)}<small>File, network & device</small></td><td><button data-process-actions="${index}" aria-label="Actions for ${esc(row.Process)}, PID ${esc(row.PID)}">•••</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="empty">No matching processes.</p>';
}
const perfNumber = (value) =>
  value == null || value === "" || !Number.isFinite(Number(value))
    ? null
    : Number(value);
const perfValue = (value, suffix = "") =>
  perfNumber(value) == null
    ? "—"
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 }) +
      suffix;
function perfBytes(value) {
  const number = perfNumber(value);
  if (number == null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"],
    unit = Math.min(
      4,
      Math.max(0, Math.floor(Math.log2(Math.max(1, number)) / 10)),
    );
  return perfValue(number / 1024 ** unit, " " + units[unit]);
}
function perfTone(value, warning, high) {
  return perfNumber(value) == null
    ? "perf-unknown"
    : value >= high
      ? "perf-high"
      : value >= warning
        ? "perf-warn"
        : "perf-normal";
}
function perfMeter(value, warning, high) {
  const number = perfNumber(value),
    tone = perfTone(number, warning, high);
  return `<span class="perf-meter ${tone}"><b>${perfValue(number, "%")}</b>${tone === "perf-high" ? "<em>High</em>" : ""}<i style="--usage:${number == null ? 0 : Math.min(100, Math.max(0, number))}%" aria-hidden="true"></i></span>`;
}
function perfGauge(label, value, detail, warning, high) {
  const number = perfNumber(value),
    tone = perfTone(number, warning, high);
  return `<article class="perf-card ${tone}"><div class="perf-donut" style="--usage:${number == null ? 0 : Math.min(100, Math.max(0, number))}%" role="img" aria-label="${esc(label)}: ${number == null ? "unavailable" : perfValue(number, "% used")}"><b>${perfValue(number, "%")}</b></div><div><h3>${esc(label)}</h3><p>${esc(detail)}</p><small>${number == null ? "Counter unavailable" : tone === "perf-high" ? "High usage" : tone === "perf-warn" ? "Elevated usage" : "Current sample"}</small></div></article>`;
}
function performanceInsights(summary) {
  const notes = [],
    cores = summary.cores || [];
  if (summary.cpu_percent >= 85)
    notes.push(
      "CPU is busy across the machine. Start with the highest CPU processes and inspect their threads.",
    );
  if (
    cores.some((core) => core.percent >= 90) &&
    perfNumber(summary.cpu_percent) != null &&
    summary.cpu_percent < 85
  )
    notes.push(
      "A logical processor is nearly saturated while overall CPU is lower. A single busy thread may be limiting responsiveness.",
    );
  if (summary.memory_percent >= 80)
    notes.push(
      "RAM pressure is elevated. Compare large resident working sets with available RAM and paging reads.",
    );
  if (summary.commit_percent >= 90)
    notes.push(
      "Committed memory is near its limit. Inspect private committed memory in process details.",
    );
  if (summary.page_reads_sec > 20 && summary.memory_percent >= 80)
    notes.push(
      "Paging reads and high RAM use occur together in this sample. Repeat the sample to see whether the pressure persists.",
    );
  if (
    summary.logical_processors > 0 &&
    summary.processor_queue > summary.logical_processors
  )
    notes.push(
      "More threads are queued for CPU than there are logical processors. Repeat the sample to check for sustained CPU contention.",
    );
  if (
    (summary.disks || []).some(
      (disk) => disk.read_ms >= 20 || disk.write_ms >= 20,
    )
  )
    notes.push(
      "Disk responses are elevated in this sample. Compare latency, queue depth and I/O activity below.",
    );
  if (
    (summary.volumes || []).some(
      (volume) =>
        perfNumber(volume.free_percent) != null && volume.free_percent < 10,
    )
  )
    notes.push("A volume has less than 10% free space.");
  if (summary.gpu_percent >= 85)
    notes.push(
      "A GPU engine is busy. Check GPU-heavy processes; different engines cannot be added together as a single process-share pie.",
    );
  return notes;
}
function renderPerformance() {
  const data = processSnapshot.data,
    s = data.summary || {},
    notes = performanceInsights(s),
    cores = s.cores || [],
    disks = s.disks || [],
    volumes = s.volumes || [],
    warnings = data.warnings || [],
    uptime = perfNumber(s.uptime_seconds),
    latency = disks
      .flatMap((d) => [d.read_ms, d.write_ms])
      .filter((v) => perfNumber(v) != null),
    slowest = latency.length ? Math.max(...latency) : null;
  $("#adminOverview").innerHTML = `<div class="perf-summary">
    ${perfGauge("CPU", s.cpu_percent, `${perfValue(s.logical_processors)} logical processors · ${perfValue(s.processor_queue)} queued threads`, 70, 85)}
    ${perfGauge("Memory", s.memory_percent, `${perfBytes(s.available_memory_bytes)} available of ${perfBytes(s.total_memory_bytes)} usable RAM`, 80, 90)}
    ${perfGauge("GPU", s.gpu_percent, "Busiest physical GPU engine · not a sum of processes", 70, 85)}
    <article class="perf-card ${perfTone(slowest, 20, 50)}"><div><h3>Disk response</h3><strong class="perf-big">${perfValue(slowest, " ms")}</strong><p>Slowest average read / write in this sample</p><small>${disks.length} disks reporting</small></div></article>
    </div><div class="perf-facts"><span>Uptime <b>${uptime == null ? "—" : `${Math.floor(uptime / 86400)}d ${Math.floor(uptime / 3600) % 24}h`}</b></span><span>Commit <b>${perfValue(s.commit_percent, "%")}</b></span><span>Paging reads <b>${perfValue(s.page_reads_sec, "/s")}</b></span><span>Threads <b>${perfValue(s.thread_count)}</b></span><span>Context switches <b>${perfValue(s.context_switches_sec, "/s")}</b></span></div>
    <div class="perf-insights"><b>Where to look</b>${notes.length ? `<ul>${notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>` : "<p>No warning threshold crossed among the available counters. A single sample cannot rule out intermittent slowness or network / Citrix latency.</p>"}</div>
    <details class="perf-details"><summary>Processor activity, disks & measurement guide</summary>
    <p class="muted">${esc(s.os || "Windows version unavailable")} · ${esc(s.model || "Model unavailable")} · Console logon: ${esc(s.console_user || "Not reported")}</p>
    <div class="perf-cores">${cores.map((core) => `<div title="Logical processor ${esc(core.name)}"><small>CPU ${esc(core.name)}</small>${perfMeter(core.percent, 70, 90)}</div>`).join("") || "<p>Per-processor counters unavailable.</p>"}</div>
    <div class="tablewrap"><table><thead><tr><th>Physical disk</th><th>Read response</th><th>Write response</th><th>Queue</th><th>Read / sec</th><th>Write / sec</th></tr></thead><tbody>${disks.map((d) => `<tr><td>${esc(d.name)}</td><td class="${perfTone(d.read_ms, 20, 50)}">${perfValue(d.read_ms, " ms")}</td><td class="${perfTone(d.write_ms, 20, 50)}">${perfValue(d.write_ms, " ms")}</td><td>${perfValue(d.queue)}</td><td>${perfBytes(d.read_bytes_sec)}</td><td>${perfBytes(d.write_bytes_sec)}</td></tr>`).join("")}</tbody></table></div>
    <div class="perf-facts">${volumes.map((v) => `<span class="${perfNumber(v.free_percent) != null && v.free_percent < 10 ? "perf-high" : ""}">${esc(v.name)} <b>${perfBytes(v.free_bytes)} / ${perfBytes(v.total_bytes)} free (${perfValue(v.free_percent, "%")})</b></span>`).join("")}</div>
    <p class="muted">CPU percentages are relative to all logical processors. Process memory is the resident working set divided by usable RAM; shared pages can occur in more than one process, so process memory must not be summed. GPU shows each process's busiest engine. The ring charts show overall usage versus remaining capacity.</p>
    <p class="muted">Red process values: CPU ≥25%, GPU ≥80%, RAM ≥20%. Amber: CPU/RAM ≥10%, GPU ≥50%. These are investigation thresholds, not proof of a fault. 500+ threads is an amber cue only. Paging reads can include mapped files; I/O includes files, network and devices. Refresh to compare samples. Thread samples cover at least one second; counters use the target's timestamps.</p>
    </details>${warnings.length ? `<details class="perf-details perf-warnings"><summary>${warnings.length} counter groups unavailable — partial results shown</summary><ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></details>` : ""}`;
  document
    .querySelectorAll("[data-cpu],[data-gpu],[data-memory]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.hasAttribute("data-" + processSnapshot.kind)),
      );
    });
}
async function showProcessThreads(index) {
  window.AtlasDiagnostics?.stop();
  const row = S.processes[index],
    snapshot = processSnapshot;
  if (!snapshot || snapshot.computer !== adminComputer() || !row?.CreatedAt)
    return toast("Refresh the process list first");
  threadSelection = { row, snapshot, focus: document.activeElement };
  $("#threadTitle").textContent =
    `${row.Process} · PID ${row.PID} · ${snapshot.computer}`;
  $("#threadDialog").showModal();
  await refreshProcessThreads();
}
async function refreshProcessThreads() {
  const selection = threadSelection;
  if (!selection) return;
  const { row, snapshot } = selection,
    request = threadRequest(),
    current = () =>
      request.current() &&
      threadSelection === selection &&
      snapshot === processSnapshot &&
      snapshot.computer === adminComputer() &&
      $("#threadDialog").open;
  $("#threadStatus").textContent =
    "Sampling thread CPU for at least one second…";
  $("#threadBody").replaceChildren();
  $("#refreshThreads").disabled = true;
  try {
    const data = await api(
      `/api/performance/${encodeURIComponent(snapshot.computer)}/threads/${row.PID}?` +
        new URLSearchParams({ created: row.CreatedAt, name: row.Process }),
      { signal: request.signal },
    );
    if (!current()) return;
    $("#threadStatus").textContent =
      `${data.items.length} of ${data.total_threads} threads · ${perfValue(data.logical_processors)} logical processors · Checked ${new Date().toLocaleTimeString()} · Sorted by CPU on one logical processor`;
    $("#threadBody").innerHTML =
      `<div class="perf-facts"><span>Resident RAM <b>${perfBytes(row.MemoryBytes ?? (row.MemoryMB == null ? null : row.MemoryMB * 1048576))}</b></span><span>Private commit <b>${perfBytes(row.PrivateBytes)}</b></span><span>Handles <b>${perfValue(row.Handles)}</b></span><span>Page faults (soft + hard) <b>${perfValue(row.PageFaultsPerSec, "/s")}</b></span></div><table class="process-table"><thead><tr><th>Thread ID</th><th>One logical CPU %</th><th>Whole machine %</th><th>State</th><th>Wait reason</th><th>Switches / sec</th><th>Priority</th></tr></thead><tbody>${data.items.map((thread) => `<tr><td>${esc(thread.TID)}</td><td>${perfMeter(thread.CoreCPU, 50, 80)}</td><td>${perfValue(thread.CPU, "%")}</td><td>${esc(thread.State)}</td><td>${esc(thread.WaitReason || "—")}</td><td>${perfValue(thread.ContextSwitches)}</td><td>${perfValue(thread.Priority)}</td></tr>`).join("")}</tbody></table>${data.warnings?.length ? `<p class="muted">${data.warnings.map(esc).join(" · ")}</p>` : ""}<p class="muted">— means a counter is unavailable or the thread was created or changed during sampling. This is a CPU sample, not a call stack or a measurement of time blocked.</p>`;
  } catch (error) {
    if (error.name !== "AbortError" && current())
      $("#threadStatus").textContent = error.message;
  } finally {
    if (current()) $("#refreshThreads").disabled = false;
  }
}
function copyPerformanceReport() {
  if (!processSnapshot || processSnapshot.computer !== adminComputer()) return;
  const s = processSnapshot.data.summary || {};
  return copy(
    [
      `${processSnapshot.computer} · Performance snapshot · ${processSnapshot.checked}`,
      `${s.os || "Windows version unavailable"} · ${s.model || "Model unavailable"} · Console logon: ${s.console_user || "Not reported"}`,
      `CPU: ${perfValue(s.cpu_percent, "%")} · GPU busiest engine: ${perfValue(s.gpu_percent, "%")}`,
      `RAM: ${perfValue(s.memory_percent, "% used")} · ${perfBytes(s.available_memory_bytes)} available / ${perfBytes(s.total_memory_bytes)} usable`,
      `Commit: ${perfValue(s.commit_percent, "%")} · Paging reads: ${perfValue(s.page_reads_sec, "/s")} · CPU queue: ${perfValue(s.processor_queue)}`,
      `Logical processors: ${perfValue(s.logical_processors)} · Threads: ${perfValue(s.thread_count)} · Context switches: ${perfValue(s.context_switches_sec, "/s")} · Uptime: ${perfValue(s.uptime_seconds == null ? null : s.uptime_seconds / 3600, " hours")}`,
      ...(s.disks || []).map(
        (d) =>
          `Disk ${d.name}: read ${perfValue(d.read_ms, " ms")}, write ${perfValue(d.write_ms, " ms")}, queue ${perfValue(d.queue)}, read ${perfBytes(d.read_bytes_sec)}/s, write ${perfBytes(d.write_bytes_sec)}/s`,
      ),
      ...(s.volumes || []).map(
        (v) =>
          `${v.name}: ${perfBytes(v.free_bytes)} / ${perfBytes(v.total_bytes)} free (${perfValue(v.free_percent, "%")})`,
      ),
      ...performanceInsights(s),
      "Process\tPID\tCPU %\tGPU %\tRAM %\tResident\tPrivate commit\tThreads\tHandles\tI/O per sec",
      ...S.processes.map((r) =>
        [
          r.Process,
          r.PID,
          perfValue(r.CPU),
          perfValue(r.GPU),
          perfValue(r.MemoryPercent),
          perfBytes(
            r.MemoryBytes ?? (r.MemoryMB == null ? null : r.MemoryMB * 1048576),
          ),
          perfBytes(r.PrivateBytes),
          perfValue(r.Threads),
          perfValue(r.Handles),
          perfBytes(r.IOBytesPerSec),
        ].join("\t"),
      ),
      ...(processSnapshot.data.warnings || []),
      "Investigation thresholds only; one sample does not establish the cause of slowness.",
    ].join("\n"),
    "Diagnostic report",
  );
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
  add("Inspect CPU threads", () => {
    if (snapshot !== processSnapshot || snapshot.computer !== adminComputer())
      return toast("Process list changed. Select the process again.");
    return showProcessThreads(index);
  }).disabled = !row.CreatedAt;
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
  $("#copyPerformance").onclick = copyPerformanceReport;
  $("#refreshThreads").onclick = refreshProcessThreads;
  $("#closeThreads").onclick = () => $("#threadDialog").close();
  $("#threadDialog").addEventListener("close", () => {
    threadRequest();
    const focus = threadSelection?.focus;
    threadSelection = null;
    focus?.focus({ preventScroll: true });
  });
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
    const threads = event.target.closest("[data-process-threads]");
    if (threads)
      return showProcessThreads(Number(threads.dataset.processThreads));
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
