/* Bounded, read-only capture. Findings describe observations, not proven causes. */
(() => {
  const duration = 60000,
    interval = 4000,
    maxSamples = 12;
  const number = (value) =>
    value == null || value === "" || !Number.isFinite(Number(value))
      ? null
      : Number(value);
  const known = (value) => number(value) != null;
  const fmt = (value, unit = "%") =>
    known(value) ? `${Math.round(value * 10) / 10}${unit}` : "Not measured";
  const mean = (values) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const identity = (row) => `${row.PID}|${row.CreatedAt}|${row.Process}`;
  const diskDelay = (sample) => {
    const values = (sample.summary?.disks || [])
      .flatMap((disk) => [
        disk.read_bytes_sec > 0 && known(disk.read_ms) ? disk.read_ms : null,
        disk.write_bytes_sec > 0 && known(disk.write_ms) ? disk.write_ms : null,
      ])
      .filter(known);
    return values.length ? Math.max(...values) : null;
  };
  function leader(samples, field) {
    const groups = new Map();
    for (const sample of samples)
      for (const row of sample.items || []) {
        if (!known(row[field])) continue;
        // Unknown creation times cannot establish identity across samples.
        const key = identity(row) + (row.CreatedAt ? "" : `|${sample.elapsed}`);
        if (!groups.has(key)) groups.set(key, { row, values: [] });
        groups.get(key).values.push(Number(row[field]));
      }
    return [...groups.values()]
      .map((g) => ({ ...g, value: mean(g.values) }))
      .sort((a, b) =>
        ["CPU", "GPU"].includes(field)
          ? b.value * b.values.length - a.value * a.values.length
          : b.value - a.value,
      )[0];
  }
  function analyze(samples) {
    const findings = [];
    function add(id, title, eligible, hits, evidence, next, priority, process) {
      if (!hits.length) return;
      const repeated =
        hits.length >= 3 &&
        hits.length / eligible.length >= 0.6 &&
        hits.at(-1).elapsed - hits[0].elapsed >= 8;
      const support = repeated
        ? "Repeated evidence"
        : hits.length === 1 && eligible.length >= 3
          ? "Brief spike"
          : "Limited evidence";
      findings.push({
        id,
        title,
        evidence,
        next,
        support,
        repeated,
        process,
        priority: priority + (repeated ? 100 : 0),
        observations: `${hits.length} of ${eligible.length} measured samples`,
      });
    }
    const cpu = samples.filter((s) => known(s.summary?.cpu_percent));
    const busyCpu = cpu.filter((s) => s.summary.cpu_percent >= 85);
    const topCpu = leader(busyCpu, "CPU");
    add(
      "cpu",
      "CPU capacity is heavily used",
      cpu,
      busyCpu,
      `Machine CPU peaked at ${fmt(Math.max(...busyCpu.map((s) => s.summary.cpu_percent)))}.${topCpu ? ` Leading observed CPU consumer: ${topCpu.row.Process} (PID ${topCpu.row.PID}), averaging ${fmt(topCpu.value)} of the machine across ${topCpu.values.length} of these ${busyCpu.length} samples.` : ""}`,
      "Inspect the busiest process and its threads. Check whether its work coincides with the reported slowdown.",
      90,
      topCpu?.row,
    );

    const excelGroups = new Map();
    for (const sample of samples)
      for (const row of sample.items || []) {
        if (
          !/^excel\.exe$/i.test(row.Process) ||
          !row.CreatedAt ||
          !known(row.BusiestThreadCPU) ||
          !known(sample.summary?.cpu_percent)
        )
          continue;
        const key = identity(row);
        if (!excelGroups.has(key))
          excelGroups.set(key, { row, eligible: [], hits: [] });
        const group = excelGroups.get(key),
          observation = { ...sample, thread: row };
        group.eligible.push(observation);
        if (row.BusiestThreadCPU >= 85 && sample.summary.cpu_percent < 70)
          group.hits.push(observation);
      }
    const excel = [...excelGroups.values()]
      .filter((g) => g.hits.length)
      .sort((a, b) => b.hits.length - a.hits.length)[0];
    if (excel)
      add(
        "excel",
        "Excel has a busy CPU thread",
        excel.eligible,
        excel.hits,
        `EXCEL.EXE (PID ${excel.row.PID}): its busiest thread reached ${fmt(Math.max(...excel.hits.map((s) => s.thread.BusiestThreadCPU)))} of one logical CPU while machine CPU stayed below 70% in these samples.`,
        "A CPU bottleneck inside Excel is possible. Inspect threads, then distinguish workbook calculation, VBA and add-in work with a controlled reproduction or CPU trace. More RAM alone would not address this observation.",
        95,
        excel.row,
      );

    if (!excel) {
      const cores = cpu.filter((s) =>
        s.summary.cores?.some((core) => known(core.percent)),
      );
      const busyCore = cores.filter(
        (s) =>
          s.summary.cpu_percent < 70 &&
          s.summary.cores.some((core) => core.percent >= 90),
      );
      add(
        "core",
        "One logical CPU is heavily used",
        cores,
        busyCore,
        "At least one logical processor reached 90% while machine CPU was below 70% in these samples.",
        "Inspect CPU threads in the busiest processes. A single busy thread may limit responsiveness; per-processor counters alone cannot identify the responsible application.",
        70,
      );
    }

    const memory = samples.filter((s) => known(s.summary?.memory_percent));
    const highMemory = memory.filter((s) => s.summary.memory_percent >= 90);
    const paging = memory.filter((s) => known(s.summary.page_reads_sec));
    const pressure = paging.filter(
      (s) => s.summary.memory_percent >= 90 && s.summary.page_reads_sec >= 10,
    );
    const topMemory = leader(highMemory, "MemoryBytes");
    const memoryEvidence = highMemory.length
      ? `RAM use reached ${fmt(Math.max(...highMemory.map((s) => s.summary.memory_percent)))}.${topMemory ? ` Largest observed resident process: ${topMemory.row.Process} (PID ${topMemory.row.PID}), averaging ${perfBytes(topMemory.value)}; this does not prove it caused the pressure.` : ""}`
      : "";
    if (pressure.length)
      add(
        "memory-paging",
        "Memory pressure coincides with paging reads",
        paging,
        pressure,
        memoryEvidence +
          ` Paging reads reached ${fmt(Math.max(...pressure.map((s) => s.summary.page_reads_sec)), "/s")}.`,
        "Check whether responsiveness improves when unnecessary applications are closed after saving work. Paging reads also include mapped files; use a trace to confirm paging-related stalls.",
        85,
        topMemory?.row,
      );
    else
      add(
        "memory",
        "Little physical memory headroom",
        memory,
        highMemory,
        memoryEvidence,
        "Check paging activity and commit pressure before blaming memory. A large working set alone is not proof of the slowdown.",
        50,
        topMemory?.row,
      );

    const disks = samples.filter((s) => known(diskDelay(s))),
      slowDisks = disks.filter((s) => diskDelay(s) >= 30);
    add(
      "disk",
      "Disk responses are elevated during I/O",
      disks,
      slowDisks,
      `The slowest active disk averaged up to ${fmt(Math.max(...slowDisks.map(diskDelay)), " ms")} per read or write in a sample.`,
      "Compare the sample with opening, saving or paging. Check storage latency and the file location. Process I/O includes network and device traffic, so it cannot identify the responsible disk by itself.",
      80,
    );

    const gpu = samples.filter((s) => known(s.summary?.gpu_percent)),
      busyGpu = gpu.filter((s) => s.summary.gpu_percent >= 90);
    const topGpu = leader(busyGpu, "GPU");
    add(
      "gpu",
      "A GPU engine is heavily used",
      gpu,
      busyGpu,
      `The busiest GPU engine reached ${fmt(Math.max(...busyGpu.map((s) => s.summary.gpu_percent)))}.${topGpu ? ` Leading observed process GPU reading: ${topGpu.row.Process} (PID ${topGpu.row.PID}), averaging ${fmt(topGpu.value)} on its busiest engine across ${topGpu.values.length} of these ${busyGpu.length} samples.` : ""}`,
      "Compare with scrolling, video or redraw delays. Check the active GPU engine and Citrix graphics/session metrics; GPU activity alone does not explain formula calculation time.",
      65,
      topGpu?.row,
    );

    const commit = samples.filter((s) => known(s.summary?.commit_percent));
    add(
      "commit",
      "Committed memory is close to its limit",
      commit,
      commit.filter((s) => s.summary.commit_percent >= 90),
      `Commit use peaked at ${fmt(Math.max(...commit.map((s) => s.summary.commit_percent)))}.`,
      "Inspect private committed memory and its trend. Commit is different from resident RAM; this is capacity pressure, not proof of a memory leak.",
      55,
    );
    return findings.sort((a, b) => b.priority - a.priority);
  }

  function coverage(samples) {
    const count = (test) => samples.filter(test).length;
    return [
      ["CPU", count((s) => known(s.summary?.cpu_percent))],
      ["Memory", count((s) => known(s.summary?.memory_percent))],
      ["Paging", count((s) => known(s.summary?.page_reads_sec))],
      ["Active disk latency", count((s) => known(diskDelay(s)))],
      ["GPU", count((s) => known(s.summary?.gpu_percent))],
      [
        "Excel threads",
        count((s) => s.items?.some((r) => known(r.BusiestThreadCPU))),
      ],
    ];
  }
  const limits =
    "Citrix session latency, file-share response, VDI host contention and exact Excel formulas/add-ins are not measured by this capture. No finding means the cause is not established.";
  let capture = null;
  function compact(data, elapsed) {
    const fields = [
      "PID",
      "Process",
      "CreatedAt",
      "CPU",
      "GPU",
      "MemoryBytes",
      "MemoryPercent",
      "BusiestThreadCPU",
      "BusiestThreadId",
    ];
    return {
      elapsed,
      checked_at: data.checked_at,
      summary: data.summary || {},
      warnings: data.warnings || [],
      items: (data.items || []).map((row) =>
        Object.fromEntries(fields.map((key) => [key, row[key]])),
      ),
    };
  }
  function stop(reason = "Stopped") {
    if (!capture?.active) return;
    capture.active = false;
    capture.reason = reason;
    clearTimeout(capture.nextTimer);
    clearTimeout(capture.deadlineTimer);
    capture.controller?.abort();
    render();
  }
  function clear() {
    stop();
    capture = null;
    $("#slowdownPanel").hidden = true;
    $("#slowdownFindings").replaceChildren();
    $("#diagnoseSlowness").disabled = false;
  }
  async function start() {
    const pc = adminComputer();
    if (!pc) return toast("Enter a computer first");
    invalidateProcesses();
    const run = (capture = {
      computer: pc,
      active: true,
      started: performance.now(),
      startedAt: new Date().toISOString(),
      samples: [],
      errors: [],
      failures: 0,
    });
    run.deadlineTimer = setTimeout(() => {
      if (capture === run) stop("Capture complete");
    }, duration);
    render();
    await tick(run);
  }
  async function tick(run) {
    const current = () =>
      capture === run && run.active && run.computer === adminComputer();
    if (!current()) {
      if (capture === run && run.computer !== adminComputer()) clear();
      return;
    }
    run.controller = new AbortController();
    try {
      const data = await api(
        `/api/performance/${encodeURIComponent(run.computer)}?kind=diagnose`,
        { signal: run.controller.signal },
      );
      if (!current()) return;
      if (
        !data.ok ||
        data.computer?.toUpperCase() !== run.computer ||
        !Array.isArray(data.items)
      )
        throw Error("Invalid diagnostic sample; refresh and try again.");
      run.samples.push(compact(data, (performance.now() - run.started) / 1000));
      run.failures = 0;
      processSnapshot = Object.freeze({
        computer: run.computer,
        kind: "cpu",
        checked: new Date().toLocaleTimeString(),
        data,
      });
      S.processes = data.items;
      $("#refreshProcesses").disabled = false;
      $("#copyPerformance").disabled = false;
      const expanded = [...$("#adminOverview").querySelectorAll("details")].map(
        (detail) => detail.open,
      );
      renderPerformance();
      [...$("#adminOverview").querySelectorAll("details")].forEach(
        (detail, index) => {
          detail.open = !!expanded[index];
        },
      );
      renderProcesses();
    } catch (error) {
      if (!current() || error.name === "AbortError") return;
      run.errors.push(error.message);
      run.failures++;
      if (run.failures >= 3)
        return stop("Capture interrupted — repeated collection failures");
    }
    if (!current()) return;
    if (
      run.samples.length >= maxSamples ||
      performance.now() - run.started >= duration
    )
      return stop("Capture complete");
    render();
    // Never overlap requests or keep polling after the bounded capture ends.
    run.nextTimer = setTimeout(() => tick(run), interval);
  }
  function sampleRows(samples) {
    return samples.map((s) => {
      const excel = (s.items || []).filter(
        (r) => /^excel\.exe$/i.test(r.Process) && known(r.BusiestThreadCPU),
      );
      return [
        `+${fmt(s.elapsed, "s")}`,
        fmt(s.summary.cpu_percent),
        fmt(s.summary.memory_percent),
        fmt(s.summary.page_reads_sec, "/s"),
        fmt(diskDelay(s), " ms"),
        fmt(s.summary.gpu_percent),
        excel.length
          ? fmt(Math.max(...excel.map((r) => r.BusiestThreadCPU)))
          : "Not measured",
      ];
    });
  }
  function render() {
    if (!capture || capture.computer !== adminComputer()) return;
    const { samples, active, computer, errors } = capture,
      findings = analyze(samples);
    const expanded = $("#slowdownFindings details")?.open;
    $("#slowdownPanel").hidden = false;
    $("#diagnoseSlowness").disabled = active;
    $("#stopDiagnosis").hidden = !active;
    $("#copyDiagnosis").disabled = !samples.length;
    $("#slowdownTitle").textContent = active
      ? "Reproduce the slowdown now"
      : findings[0]?.title || "Cause not established";
    $("#slowdownStatus").textContent =
      `${computer} · ${active ? "Capturing for up to 60 seconds" : capture.reason} · ${samples.length} ${samples.length === 1 ? "sample" : "samples"}${samples.length ? ` · last received +${fmt(samples.at(-1).elapsed, "s")}` : ""}${errors.length ? ` · ${errors.length} failed requests` : ""}`;
    $("#slowdownFindings").innerHTML =
      `<p class="muted">${active ? "Findings update as samples arrive. Repeated evidence is stronger than a brief spike." : "These are investigation leads from the measured samples. Several bottlenecks can coexist."}</p>
      <div class="slowdown-cards">${findings.map((f, index) => `<article class="slowdown-finding ${f.repeated ? "repeated" : ""}"><div class="slowdown-label"><span>${esc(f.support)}</span><small>${esc(f.observations)}</small></div><h4>${esc(f.title)}</h4><p>${esc(f.evidence)}</p><p class="slowdown-next"><b>Next check</b> ${esc(f.next)}</p>${f.process?.CreatedAt ? `<button data-diagnosis-process="${index}">Inspect ${esc(f.process.Process)} threads</button>` : ""}</article>`).join("") || `<p class="slowdown-empty">${samples.length ? "No clear resource bottleneck in the available samples. If the slowdown happened during capture, check Citrix/session performance, file or data-source delays, then an Excel trace." : active ? "Waiting for the first sample. Atlas checks CPU, RAM, active disks, GPU and available Excel thread counters." : "No sample was completed. Check access to the machine and try again."}</p>`}</div>
      <p class="slowdown-limits">${esc(limits)}</p>
      <details class="perf-details" ${expanded ? "open" : ""}><summary>Sample timeline & measurement coverage</summary><p class="muted">Samples are separate observations, not a continuous trace. Thresholds are investigation cues: CPU 85%, RAM 90%, paging reads 10/s with high RAM, active disk response 30 ms, GPU 90%, Excel thread 85% of one logical CPU, or one logical CPU at 90% with machine CPU below 70%. Repeated evidence needs at least three matching observations spanning eight seconds and 60% of measured samples.</p>
      <div class="perf-facts">${coverage(samples)
        .map(
          ([name, count]) =>
            `<span>${esc(name)} <b>${count}/${samples.length} samples</b></span>`,
        )
        .join("")}</div>
      <p class="muted">Excel threads cover up to three instances with the largest working sets. Missing counters and inactive disks are not treated as zero. Process consumers are selected across CPU, memory, GPU and I/O; not every process is retained.</p>
      <div class="tablewrap"><table><thead><tr>${["Received", "CPU", "RAM used", "Paging reads", "Disk response", "GPU", "Excel busiest thread"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${sampleRows(
        samples,
      )
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table></div>
      ${[...new Set([...errors, ...samples.flatMap((s) => s.warnings)])].map((message) => `<p class="muted">${esc(message)}</p>`).join("")}</details>`;
  }
  function report() {
    if (!capture || capture.computer !== adminComputer()) return "";
    const findings = analyze(capture.samples);
    return [
      `${capture.computer} — Slowness capture`,
      `Started: ${capture.startedAt}`,
      `${capture.active ? "Capture in progress" : capture.reason} · ${capture.samples.length} samples`,
      ...(findings.length
        ? findings.flatMap((f) => [
            `\n${f.title} — ${f.support} (${f.observations})`,
            f.evidence,
            `Next check: ${f.next}`,
          ])
        : ["Cause not established from available samples."]),
      "\nMeasurement coverage: " +
        coverage(capture.samples)
          .map(([name, count]) => `${name} ${count}/${capture.samples.length}`)
          .join(" · "),
      limits,
      "Excel thread sampling covers up to three instances. Repeated evidence needs 3 observations spanning 8s and 60% of measured samples; these are investigation cues, not a proven cause.",
      "\nReceived\tCPU\tRAM used\tPaging reads\tActive disk response\tGPU\tExcel busiest thread",
      ...sampleRows(capture.samples).map((row) => row.join("\t")),
      ...new Set([
        ...capture.errors,
        ...capture.samples.flatMap((s) => s.warnings),
      ]),
    ].join("\n");
  }
  window.AtlasDiagnostics = { start, stop, clear, analyze, report };
  $("#diagnoseSlowness").onclick = start;
  $("#stopDiagnosis").onclick = () => stop();
  $("#copyDiagnosis").onclick = () => copy(report(), "Slowness findings");
  $("#slowdownFindings").addEventListener("click", (event) => {
    const button = event.target.closest("[data-diagnosis-process]");
    if (!button || !capture) return;
    const finding = analyze(capture.samples)[
      Number(button.dataset.diagnosisProcess)
    ];
    const index = S.processes.findIndex(
      (row) => identity(row) === identity(finding?.process || {}),
    );
    if (index < 0)
      return toast(
        "This process is no longer in the latest sample. Refresh processes before inspecting it.",
      );
    showProcessThreads(index);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop("Stopped — tab hidden");
  });
  window.addEventListener("pagehide", () => stop());
})();
