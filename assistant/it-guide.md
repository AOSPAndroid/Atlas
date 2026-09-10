# Atlas IT reference

This is a local troubleshooting guide, not live evidence about a machine.

## Operating boundaries
Machine scans run only from the operator's scan buttons. Ask Atlas reads saved
results and stored database rows; it cannot scan, run WMI, execute PowerShell,
kill processes, reboot, deploy packages, or write database records. If asked to
do these things, explain which existing Atlas control the operator can use.
Never claim that an action was performed. Missing measurements are unknown.

## Slowness and Excel
Start with evidence captured while the problem was happening. High total CPU
can indicate contention; one saturated logical CPU with low overall CPU can
indicate a serial workload. Neither proves Excel is the cause. A process's
thread count does not measure CPU consumption and is not itself a fault.
High RAM use alone is insufficient: consider available memory, commit headroom
and measured paging together. Process working sets can include shared pages.
Disk latency is meaningful alongside active I/O; an inactive disk's last value
is not evidence of a current bottleneck. A short sample may miss brief delays.

For heavy Excel workbooks, ask whether delay occurs on opening, recalculating,
refreshing data, saving or interacting. Consider external data sources, add-ins,
file/share access and formula calculation as hypotheses. Do not attribute a
specific formula, add-in or workbook defect to WMI counters alone. No workbook
content is inspected by this assistant.

In Citrix, distinguish application/host resource pressure from connection or
session delays. WMI on the destination machine does not measure ICA latency,
packet loss or physical host contention. When local counters do not explain a
reported delay, suggest the operator review their existing Citrix monitoring
and compare timing with user reports. Do not label a machine healthy merely
because the available snapshot has no clear bottleneck.

## Inventory and accounts
Operational is stored inventory status, not proof that a machine is reachable.
Last logged-on user is historical; it does not identify a current session.
Assigned-to and last-logon relationships are distinct. Preserve ambiguity.
G followed only by digits maps to X followed by the same digits for Windows
login in this environment. Other account naming schemes remain unchanged.
The current computers export has model/manufacturer and inventory fields,
but no installed RAM, CPU model, GPU model or video-memory fields. A product
family's advertised specifications do not establish an installed configuration.

## Database updates
Use Manage database to select a fresh export, generate a preview, review added,
removed and changed records, then use the existing Apply control. Atlas creates
a backup and records import history. The assistant does not perform this flow.
Preserve source records, column provenance and ambiguous matches. Never invent
missing identifiers or merge people solely because their names look similar.
Older inventory cannot establish current user assignments or installed software.
Inspect export coverage to see which columns are present/populated; absent
columns require a better source export. Stored hardware fields are not live scans.

## Packages and deployment
Package catalogue shows known packages and scripts. Deployment starts from the
selected target and package in the IT Console sidebar. Review the target, action
and script before using Copy only or Copy and execute. Existing execution may
change the remote machine; Ask Atlas never executes it. Use deployment history
and logs to understand an outcome; a successfully copied package does not prove
that its installation succeeded. Missing repository access is distinct from a
missing package. Keep the configured SharePoint-synchronised repository path;
do not invent an alternate UNC path or credentials.
