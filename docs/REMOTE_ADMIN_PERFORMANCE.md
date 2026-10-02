# Remote Admin performance tools

Atlas helps support staff investigate a slow machine from the IT console using on-demand Windows performance counters. Open **Remote Admin**, select the target machine, choose a view and click its **Scan** button.

**Selecting a machine, opening Remote Admin or switching views does not start a scan.** Refresh collects another reading only when clicked. Each view retains its own last result and timestamp for the current target; changing target clears those results. These privileged checks are available in Admin, not the read-only Demo or hosted preview.

All four views share the target toolbar, scan controls and process filter. The scan-state label distinguishes unscanned targets, active scans, stored snapshots and failed refreshes. **Where to look**, processor/disk details and GPU engine activity expand on demand; process counts show how many rows are visible out of the recorded total.

## Which button should I use?

| Button / view | What you get | When to use it |
| --- | --- | --- |
| **Overview → Scan Overview** | Combined CPU, GPU, RAM, commit, paging and disk pressure; processes ranked by CPU; expandable processor and disk details. | A broad snapshot when you do not yet know which resource is busy. |
| **CPU → Scan CPU** | Overall CPU, individual logical processors, processor queue, thread count and context switches; processes ranked by CPU. No GPU, memory or disk collection. | Slow calculations, a busy application, or one saturated logical processor despite modest total CPU. |
| **GPU → Scan GPU** | Graphics-engine utilization and processes ranked by their busiest reported GPU engine. No CPU, memory or disk collection. | Investigating graphics activity, rendering or a process using a GPU engine heavily. |
| **Memory → Scan Memory** | Used and available physical RAM, commit versus commit limit, paging reads; processes ranked by resident memory, with percentages and readable sizes. No CPU, GPU or disk collection. | Low available RAM, heavy Excel workbooks or suspected paging pressure. |
| **Scan for slowness** | A bounded light capture with evidence over time and suggested next checks. Up to six samples over 60 seconds, with rests between checks. | An intermittent problem that the user can reproduce during the capture. |
| **Inspect CPU threads** | A separate, explicitly requested sample of an individual process's threads. | Finding whether one thread dominates an application's CPU use. |

**Refresh** repeats the selected view and shows changes since its previous result. **Copy report** copies that view's readings and process list. **Copy findings** copies the slowness capture's evidence, timeline and coverage for a support ticket. A failed refresh keeps the previous successful reading visible with its original timestamp and an error.

## Understanding the GPU button

GPU is a focused graphics check, not another copy of Overview. The ring shows the busiest reported physical GPU engine. The engine breakdown shows available engines and their utilization, and the process list identifies each process's busiest reported engine.

- Engines can perform different work, such as 3D rendering or video decoding, depending on the counters exposed by Windows and the driver.
- Process GPU percentages and engine percentages are **not shares to add together into a pie chart**. Engines can run concurrently. The ring represents overall busiest-engine usage versus remaining capacity.
- Processes without GPU counters are omitted from the GPU list. Missing counters mean **unknown**, not zero usage. This is especially relevant on virtual desktops or Citrix sessions where counters may not be exposed.
- This scan does **not** measure GPU memory / VRAM, Citrix connection latency, network round-trip time or the user's perceived frame rate.

A high reading identifies graphics work to investigate; it does not by itself prove that the GPU caused the reported slowness.

## CPU, threads and memory in plain language

Process CPU percentages are relative to the whole machine. For example, one fully occupied logical processor on an eight-logical-processor machine accounts for about 12.5% total CPU. Check the logical-processor breakdown before dismissing a low overall reading.

In CPU or Overview, click a process's thread count or right-click it and choose **Inspect CPU threads**. Two samples show thread CPU relative to one logical processor and to the whole machine, plus state, wait reason, priority and context switches. Atlas displays the busiest 200 threads. A high thread count alone is not proof of overload, and a wait reason is an instantaneous observation, not a call stack or elapsed blocked time.

Process memory is its resident working set, shown as a readable size and percentage of usable physical RAM. Private commit is a different measure. Shared pages can appear in multiple working sets, so adding process memory can double-count memory. Look at overall available RAM, commit headroom and paging alongside large processes.

## Colours and charts

| Process metric | Amber | Red |
| --- | --- | --- |
| CPU, percentage of the whole machine | 10% or more | 25% or more |
| GPU, busiest reported engine | 50% or more | 80% or more |
| Resident memory, percentage of usable RAM | 10% or more | 20% or more |
| Thread count | 500 or more | No red threshold based on count alone |

These are investigation cues, not fault diagnoses. Machine-level cards and engine details have their own thresholds. Ring charts show overall resource usage versus remaining capacity; they do not divide shared resources between processes.

## A practical Excel / Citrix investigation

1. Select the machine actually running Excel. If a kiosk only connects to a remote desktop, inspect the remote desktop hosting Excel.
2. Ask the user to reproduce the slowdown, then click **Scan for slowness**. No capture starts until you click it.
3. Follow the measured evidence: use CPU and thread inspection for calculation load, Memory for RAM and paging, or Overview's disk details for response time during I/O. Use GPU when graphics activity is relevant.
4. Compare manual scans during the slowdown and after it clears. Copy the report or findings into the ticket.
5. If these counters do not explain the delay, investigate the workbook, add-ins, data connections, Citrix session and underlying host separately. Atlas does not currently measure those causes directly.

The light capture excludes GPU engine enumeration, individual thread enumeration and volume inventory. It rests at least ten seconds between completed checks, backs off under pressure, and stops for failures or slow checks. Cancel it explicitly, hide the tab or leave Remote Admin to stop further samples; an already-started remote query may finish. It runs no continuous background monitoring and installs no target agent. Manual WMI checks still have some collection cost.

## Process actions

Right-click a listed process to copy its PID/details or choose **Kill process**. Termination requires confirmation, rechecks process identity and blocks core Windows processes. Nothing is killed automatically by scans or warning colours. Ending Excel can lose unsaved work, so confirm the user's work is saved before using this action.

For direct entry, expand **Terminate by PID or name** above the process table. Enter a PID or executable name and choose **Terminate…** (or press Enter). The confirmation identifies the target and whether the action affects one PID or all processes with that executable name.

**Kill OpenFin…** targets every process named `openfin.exe` on the selected machine. **Kill matching processes…** uses the adjacent **Process name contains** field, initially `a180`: for example, it matches `a180.exe`, `A180Updater.exe` and `tool-a180-worker.exe`. Matching is a literal, case-insensitive substring of the executable name, across all sessions; command-line arguments and wildcards are excluded. Enter 3–64 characters starting with a letter or number.

Both quick actions require confirmation and work without a performance scan. They query the full live process list rather than the displayed or filtered rows, recheck each process's name and creation time before termination, skip protected or changed processes, and report unsuccessful results without retrying. Demo and hosted Preview show the controls but cannot run them.

## Service actions

Choose **List services** in the target toolbar to load a compact, searchable inventory. Each row shows the display name, Windows service name, status, startup mode and PID. Search matches names, status and startup mode; **Refresh** explicitly reloads the selected target. Selecting a machine or opening Remote Admin starts no service query.

Choose **Stop…** on a running or paused service and confirm its name and target. Atlas rechecks the service configuration and Windows stop permission, calls `Win32_Service.StopService()` and waits up to ten seconds to verify `Stopped`. A pending stop, access denial or running dependents is reported without claiming success or retrying automatically; refresh the list before another attempt. Atlas preserves startup settings, does not cascade to dependent services and does not kill a shared service-host PID. Core Windows and remote administration services are protected on the server.

Demo and hosted Preview display the controls but cannot query or stop live services. Changing the target clears the list and cancels an open stop confirmation; results from the previous machine cannot appear on the new target.

## Implementation and validation

The collector lives in [`performance.py`](../performance.py) and [`scripts/performance.ps1`](../scripts/performance.ps1). The view rendering and actions are in [`console-processes.js`](../frontend/assets/console-processes.js). Regression tests use simulated providers and fictional process data; passing them does not establish counter availability or performance on a particular Citrix desktop.

See the [main README](../README.md#troubleshooting-performance-in-remote-admin) for collection limits, display settings and additional technical notes.
