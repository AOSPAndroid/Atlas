/* Shared progressive health widget for the real Atlas and IT console. */
(() => {
  "use strict";
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
  const labels = {
    wmi: "WMI",
    cshare: "C$",
    ping: "Ping",
    cpu: "CPU",
    ram: "RAM",
    gpu: "GPU",
    storage: "Storage",
    system: "Windows / uptime",
  };
  const snapshots = new WeakMap();
  const active = new WeakMap(),
    num = (v) =>
      v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
        ? Number(v)
        : null;
  const gib = (v) =>
    num(v) === null
      ? "Unavailable"
      : (Number(v) / 1073741824).toFixed(1) + " GiB";
  function format(key, d) {
    if (["wmi", "cshare", "ping"].includes(key))
      return d.available === true
        ? "Available"
        : d.available === false
          ? key === "ping"
            ? "No ping reply"
            : "Unavailable"
          : "Unavailable";
    if (key === "cpu")
      return (
        (d.processors || [])
          .map(
            (x) =>
              `${x.Name || "Unknown CPU"} · ${num(x.LoadPercentage) === null ? "Utilisation unavailable" : x.LoadPercentage + "% utilisation"} · ${x.NumberOfCores ?? "?"} cores / ${x.NumberOfLogicalProcessors ?? "?"} threads`,
          )
          .join("; ") || "Unavailable"
      );
    if (key === "gpu")
      return (
        (d.adapters || []).map((x) => x.Name || "Unknown adapter").join("; ") ||
        "Unavailable"
      );
    if (key === "ram") {
      const total = num(d.usable_kib),
        free = num(d.free_kib);
      return `${gib(d.installed_bytes)} installed · ${total > 0 && free !== null && free >= 0 && free <= total ? ((total - free) / 1048576).toFixed(1) + " / " + (total / 1048576).toFixed(1) + " GiB usable in use (" + (((total - free) * 100) / total).toFixed(0) + "%)" : "Usage unavailable"}`;
    }
    if (key === "storage")
      return `C: ${gib(d.free_bytes)} free / ${gib(d.total_bytes)} total`;
    if (key === "system") {
      const n = num(d.uptime_seconds);
      return `${d.windows || "Windows unavailable"} ${d.version || ""} · Uptime ${n === null ? "unavailable" : Math.floor(n / 86400) + "d " + Math.floor((n % 86400) / 3600) + "h " + Math.floor((n % 3600) / 60) + "m"} · Boot ${d.last_boot || "unavailable"} (target local time)`;
    }
    return "Unavailable";
  }
  function badges(m) {
    const explicit =
      m.assigned_relationship !== undefined ||
      m.logon_relationship !== undefined;
    const entries = explicit
      ? [
          [!!Number(m.assigned_relationship), "Assigned", "assigned"],
          [!!Number(m.logon_relationship), "Last logged-on", "logon"],
        ]
      : [
          [!!m.assigned_to, "Assigned: " + m.assigned_to, "assigned"],
          [
            !!m.last_logon_user,
            "Last logged-on: " + m.last_logon_user,
            "logon",
          ],
        ];
    return (
      '<div class="atlas-relationships">' +
      entries
        .filter((x) => x[0])
        .map((x) => `<span class="atlas-relation ${x[2]}">${esc(x[1])}</span>`)
        .join("") +
      "</div>"
    );
  }
  function cancel(host) {
    const old = active.get(host);
    if (old) {
      old.abort();
      active.delete(host);
    }
  }
  async function mount(host, pc, isCurrent = () => true) {
    if (!host) return;
    cancel(host);
    const controller = new AbortController();
    active.set(host, controller);
    const current = () =>
      active.get(host) === controller && host.isConnected && isCurrent();
    snapshots.set(host, { pc, metrics: {} });
    host.classList.remove("hidden");
    host.classList.add("atlas-health");
    host.innerHTML = `<div class="atlas-health-heading"><b>${esc(pc)} · Live health</b><button type="button" data-health-refresh disabled>Checking…</button></div><div class="atlas-health-grid">${Object.entries(
      labels,
    )
      .map(
        ([key, label]) =>
          `<div class="atlas-health-item"><b>${label}</b><div data-metric="${key}">Loading…</div><small data-time="${key}"></small></div>`,
      )
      .join("")}</div>`;
    const button = host.querySelector("[data-health-refresh]");
    button.onclick = () => mount(host, pc, isCurrent);
    await Promise.allSettled(
      Object.keys(labels).map(async (key) => {
        const timed = new AbortController();
        const stop = () => timed.abort();
        controller.signal.addEventListener("abort", stop, { once: true });
        const timer = setTimeout(stop, 24000);
        try {
          const r = await fetch(
            "/api/machine-health/" + encodeURIComponent(pc) + "/" + key,
            { signal: timed.signal },
          );
          if (!r.ok) throw Error("Health request failed");
          const d = await r.json();
          if (!current()) return;
          if (d.computer.toUpperCase() !== pc.toUpperCase() || d.metric !== key)
            throw Error("Target mismatch");
          const el = host.querySelector('[data-metric="' + key + '"]');
          el.textContent =
            d.state === "ready" ? format(key, d.data || {}) : "Unavailable";
          el.title = d.error || "";
          el.dataset.state = d.state;
          snapshots.get(host).metrics[key] = d;
          if (key === "system") {
            const overdue =
              d.state === "ready" &&
              num(d.data?.uptime_seconds) !== null &&
              Number(d.data.uptime_seconds) > 8 * 86400;
            el.classList.toggle("atlas-uptime-overdue", overdue);
            if (overdue)
              el.title =
                "Uptime exceeds 8 days. Weekend restart may have been missed.";
          }
          host.querySelector('[data-time="' + key + '"]').textContent =
            d.checked_at
              ? "Checked " + new Date(d.checked_at).toLocaleTimeString()
              : "";
        } catch (e) {
          if (current()) {
            const el = host.querySelector('[data-metric="' + key + '"]');
            el.textContent = "Unavailable";
            el.title = e.name === "AbortError" ? "Check timed out" : e.message;
            el.dataset.state = "unavailable";
            snapshots.get(host).metrics[key] = { state: "unavailable" };
          }
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", stop);
        }
      }),
    );
    if (current()) {
      button.disabled = false;
      button.textContent = "Refresh health";
    }
  }
  function specs(pc) {
    document.querySelectorAll(".atlas-spec-dialog").forEach((x) => x.close());
    const d = document.createElement("dialog");
    d.className = "atlas-spec-dialog";
    d.innerHTML =
      '<div class="atlas-health-heading"><h2>Machine specifications</h2><button type="button" aria-label="Close specifications">Close</button></div><p>Live queries under your current account. Missing or failed readings are unavailable.</p><div data-spec-health></div>';
    document.body.append(d);
    const host = d.querySelector("[data-spec-health]");
    d.querySelector("button").onclick = () => d.close();
    d.addEventListener(
      "close",
      () => {
        cancel(host);
        d.remove();
      },
      { once: true },
    );
    d.showModal();
    mount(host, pc, () => d.open);
  }
  function report(host, pc) {
    const snapshot = snapshots.get(host);
    return Object.entries(labels).map(([key, label]) => {
      const metric =
        snapshot && snapshot.pc === pc ? snapshot.metrics[key] : null;
      return (
        label +
        ": " +
        (!metric
          ? "Not collected / loading"
          : metric.state === "ready"
            ? format(key, metric.data || {})
            : "Unavailable") +
        (metric?.checked_at ? " [checked " + metric.checked_at + "]" : "")
      );
    });
  }
  function compact(host, pc) {
    const snapshot = snapshots.get(host);
    return Object.entries(labels).map(([key, label]) => {
      const metric = snapshot?.pc === pc ? snapshot.metrics[key] : null;
      const d = metric?.data || {};
      let text = !metric
        ? "Checking…"
        : metric.state !== "ready"
          ? "Unavailable"
          : format(key, d);
      if (metric?.state === "ready") {
        if (key === "cpu")
          text =
            num(d.processors?.[0]?.LoadPercentage) === null
              ? "Unavailable"
              : d.processors[0].LoadPercentage + "%";
        if (key === "ram")
          text =
            num(d.usable_kib) > 0 &&
            num(d.free_kib) !== null &&
            num(d.free_kib) >= 0 &&
            num(d.free_kib) <= num(d.usable_kib)
              ? Math.round((1 - d.free_kib / d.usable_kib) * 100) + "% used"
              : "Unavailable";
        if (key === "storage")
          text =
            num(d.free_bytes) === null
              ? "Unavailable"
              : gib(d.free_bytes) + " free";
        if (key === "gpu")
          text = (d.adapters || []).length
            ? d.adapters.length + " adapter(s)"
            : "Unavailable";
        if (key === "system")
          text =
            num(d.uptime_seconds) === null
              ? "Unavailable"
              : Math.floor(d.uptime_seconds / 86400) +
                "d " +
                Math.floor((d.uptime_seconds % 86400) / 3600) +
                "h uptime";
      }
      return {
        label,
        text,
        warning:
          text === "Unavailable" ||
          d.available === false ||
          (key === "system" && num(d.uptime_seconds) > 8 * 86400),
        title:
          (metric?.state === "ready" ? format(key, d) : metric?.error || text) +
          (metric?.checked_at
            ? " · Checked " + new Date(metric.checked_at).toLocaleString()
            : ""),
      };
    });
  }
  window.AtlasHealth = {
    mount,
    cancel,
    specs,
    badges,
    format,
    report,
    compact,
  };
})();
