# Atlas IT reference

This local guide describes Atlas controls and general technical troubleshooting. It is not a live measurement or proof of a machine fault. General questions about Windows, networking, applications and technical concepts do not require a selected Atlas record.

## Operating boundaries

Ask Atlas explains text, saved results and stored directory records. It cannot launch scans, run WMI or PowerShell, open a remote session, kill processes, reboot, deploy packages or change database records. The operator chooses and confirms those actions through existing controls. Opening the palette or selecting a machine does not start a health or performance scan. Never report an action as completed because it was suggested. Missing measurements are unknown.

## Atlas navigation and command palette

Press Ctrl+K or choose Search Atlas to open the shared palette on the floor map or IT Console. Ask Atlas opens the offline assistant. User & machine lookup finds directory records; Floor atlas opens the map; IT workspace opens the Console. Console navigation has Workspace, Remote Admin, Bulk Deploy and History, with Alt+1 through Alt+4 shortcuts. User lookup from the Console stays in its workspace even if the person has a desk. Package catalogue opens within the Console. Palette actions such as Deploy selected package and Target health open controls for review; navigating there does not execute a deployment or scan.

## Startup, dependencies and socket port conflicts

Extract the whole project, install Python 3.12, run Install_Dependencies.bat for initial setup, then Start-Office-Atlas.bat. Normal startup does not require reinstalling dependencies. Stop-Office-Atlas.bat stops both servers; finish deployments first. Closing a browser does not stop hosting. If a socket address is already in use, inspect logs/admin-startup.log or logs/viewer-startup.log. Stop this folder's unresponsive Atlas instance or choose different ATLAS_ADMIN_PORT and ATLAS_VIEWER_PORT values if another application owns the port. Do not kill an unidentified process. Preserve data and config.json when updating.

## Demo viewer, sharing and admin access

The launcher normally serves the local admin tool at http://127.0.0.1:8770 and the demo at http://YOUR-IP:8771. Use the host's reachable network IPv4 address; candidate addresses are in data/share-addresses.txt. The viewer shares maps, seating, directory lookup and stored machine details without requiring Python on visitors' computers. It cannot edit seating, import data, deploy, run privileged health/software checks or use Ask Atlas. The admin interface is local to the host. Custom ports can change these addresses; a viewer access failure can involve network reachability or approved firewall policy.

## Ask Atlas setup, offline answers and existing evidence

Install_Atlas_Assistant.bat prepares the separate Python environment and verified model files. After setup, questions run locally without a cloud AI API, Ollama, llama.cpp or an extra listening port. Click Ask Atlas or submit a question in the palette; opening it or typing does not start inference. Include existing slowness results attaches the report already displayed, not a new scan. Source evidence and View supplied facts show supplied context. Closing the palette cancels the worker. The assistant can explain general IT topics without a selected record, but its answers can be incomplete or outdated and it cannot check live websites.

## Floor map movement and locating desks

Search for a person or desk, choose the correct result and floor, then inspect the highlighted location. Switch 2D / 3D map changes the view; Reset map view fits the current floor. In 3D, left-drag moves the map, right-drag rotates or tilts it, and scrolling zooms. Shift+left-drag also rotates in 3D. In 2D, drag pans and scrolling zooms. Toggle animations changes interface motion and can help on less responsive Citrix connections. A mapped desk is a seating-register assignment, not proof that its occupant is physically present.

## Desk occupants, directory links and seating changes

Select a desk to inspect its user and linked machines. Match to directory and Choose the correct database account let an operator confirm the intended person; a name-only match can be ambiguous. Linking replaces the desk label with the directory name and preserves a permanent account link, but does not rename the directory account or verify physical presence. The desk context menu includes Edit desk / joiner, Move occupant…, Leaver / mark vacant…, Rotate desk 90° and View history. Equipment belongs to the desk and does not automatically follow an occupant move.

## User lookup, machine details and historical inventory

Workspace search accepts username, email, name or machine hostname. Choose the right colleague, review linked machines and use Set as target for the intended machine. Assigned-to and last-logged-on relationships differ; last logon is historical, not the current session. Operational is inventory status, not a reachability check. Machine details and All export fields show stored data and provenance. Record-updated and inventory-discovered timestamps help assess freshness. The current computers export does not establish installed CPU, GPU, RAM or video-memory specifications from a product model name alone.

## Domain account, login and employee identifiers

In this organisation, G followed only by digits maps to X followed by the same digits for Windows login. Preserve the digits and the original export identifier. Other naming schemes, including ordinary usernames, remain unchanged. BRID or employee ID, exported login, Windows domain account and email can differ. Use explicit account links or a confirmed identifier to resolve a person; matching names alone can join the wrong people. The G-to-X convention is local to this environment, not a general Windows rule.

## Manual health scans and performance capture

Scan health or Refresh health runs the selected machine's health checks. Remote Admin has Scan for slowness, Performance overview, Ping, C$, Disk, CPU, GPU and Memory buttons. Scan for slowness is a bounded light capture lasting at most 60 seconds; Stop capture ends it sooner. It limits sampling and backs off or stops when checks are expensive. GPU-engine and individual-thread inspection are separate explicit checks. Copy findings and Copy diagnostic report reuse collected results. Missing, unavailable or old readings are unknown, not zero or healthy. Capture while the delay occurs.

## CPU usage, logical processors and process threads

Overall CPU percentage describes the whole machine; a busy logical processor can be hidden by a low average. One fully used logical processor on an otherwise idle eight-logical-processor machine is about 12.5% total CPU. Twelve percent total CPU is not high whole-machine usage, while one logical CPU at 98% warrants inspecting its workload. A logical processor is a scheduling resource, not necessarily a separate physical core. Thread count measures how many threads exist, not their CPU consumption; high thread count alone does not diagnose overload.

## Inspect CPU threads and kill process actions

After loading CPU, GPU or Memory processes in Remote Admin, filter by process, PID or session. Click a process's thread count or right-click and choose Inspect CPU threads. The table separates One logical CPU % from Whole machine %, alongside state, wait reason and context switches. This is a short CPU sample, not a call stack or time spent blocked; waiting is often normal. Right-click also offers Copy PID, Copy process details and Kill process. Termination requires the operator's confirmation and valid process identity and may discard unsaved work. Ask Atlas never terminates a process.

## Memory, RAM, commit and paging

RAM usage is physical memory in use; commit is memory Windows has promised to back with RAM or page-file capacity. Interpret available RAM, commit headroom and paging together. Sixty percent RAM usage with negligible paging does not by itself establish memory pressure. Process Memory / RAM % is its resident working set relative to machine RAM; shared pages mean process values should not simply be added. Private commit differs from resident RAM. Page faults include soft and hard faults, so the count alone does not prove disk paging. Divide bytes by 1,073,741,824 for GiB. See Microsoft's [page-file overview](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/introduction-to-the-page-file).

## GPU engines, graphics memory and display lag

Use the explicit GPU or Performance overview control for graphics evidence. Atlas labels overall GPU utilisation as the busiest physical GPU engine, not a sum of process percentages. Engine activity differs from memory allocation; shared GPU memory uses system RAM while dedicated memory belongs to the graphics device. Graphics, encoding or desktop-composition activity alone does not prove why Excel calculation or Citrix input is slow. An unavailable GPU counter does not mean zero utilisation. See Microsoft's [GPU metrics explanation](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/).

## Disk latency, free space and process I/O

A drive can have plenty of free space and still suffer slow I/O. Consider latency with active read/write traffic, queueing and the timestamp; an idle disk's retained latency value is not evidence of a current problem. Process I/O can include file, network and device activity, so it does not identify a particular workbook or storage volume. A short sample can miss stalls. Disk, Memory and the light capture provide different evidence; select another check only when it addresses the question. Red or amber display thresholds are investigation prompts, not proof of a root cause.

## Excel opening, calculation, refresh and saving slowness

Identify the slow operation: opening, recalculating, refreshing external data, saving, or interacting. Ask whether one workbook or all workbooks are affected and compare timings under similar conditions. Calculation dependencies, volatile functions, VBA or COM user-defined functions and some data-table operations can limit parallelism. External feeds, add-ins, network file access and workbook design are separate hypotheses. WMI cannot identify a specific formula or add-in defect. Test changes on a copy with the owner; avoid casually switching a trading workbook to manual calculation or disabling required feeds. See Microsoft's [Excel calculation-performance guide](https://learn.microsoft.com/en-us/office/vba/excel/concepts/excel-performance/excel-improving-calculation-performance).

## Citrix session latency, kiosks and destination machines

Separate the endpoint or kiosk, Citrix session, and destination desktop or VDI. Here PARPWMK names identify Paris kiosks, GBRPWMF names identify dedicated UK desktops, and names containing VDI identify virtual desktops. Naming does not identify the cause of delay. Destination WMI does not provide ICA latency, packet loss or physical hypervisor contention. Missing Citrix measurements leave that layer unassessed, not cleared. Compare complaint times with approved Citrix Director or Monitor session metrics. ICA round-trip time includes interaction and processing components and differs from network RTT. See [Citrix ICA RTT guidance](https://support.citrix.com/external/article?articleUrl=CTX201968-accessing-ica-rtt-metrics-for-citrix-hdx-and-xendesktop-and-xenapp&language=en_US).

## Remote Desktop, MSRA and administration consoles

The selected machine's Open menu offers Offer Remote Assistance, Quick Assist, Intune Remote Help, Remote Desktop, Computer Management, Event Viewer, Open C$, Open C:\Temp and Open Packages. The machine context menu also offers Open MSRA, Remote Desktop, Computer Management and Event Viewer. These launch local Windows tools; availability and permissions depend on the host and organisation. MSRA assistance differs from an RDP sign-in, which can affect an existing interactive session. Computer Management and Event Viewer offer their own remote views. Launching them does not mean Atlas retrieved or analysed their contents.

## WMI, access denied and RPC connectivity

WMI exposes Windows management information and operations; Atlas uses it for explicit remote actions. An unavailable WMI result does not prove the target is off. Check the exact hostname, Atlas process identity and error first. RPC server unavailable can involve connectivity, services or approved firewall rules. Access denied can involve account rights, DCOM permissions or the WMI namespace. Compare with a known working target under the same approved identity and inspect WMI-Activity events. Do not disable UAC or the firewall, grant broad rights or rebuild WMI as a first response. See Microsoft's [WMI troubleshooting guide](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmi-troubleshooting).

## DNS, DHCP, ping and network reachability

DNS resolves names to addresses; DHCP leases network settings such as an IP address, gateway and DNS servers. A DNS lookup failure and a DHCP lease failure are different problems. Ping tests ICMP replies; a service connection tests a particular protocol and port. Missing ping replies can reflect filtering, not complete unreachability. Atlas has a manual Ping button but no general DNS or packet-capture agent. Outside Atlas, inspect settings with ipconfig /all, resolve names with Resolve-DnsName and test a service with Test-NetConnection. See Microsoft's [DHCP overview](https://learn.microsoft.com/en-us/windows-server/networking/technologies/dhcp/dhcp-top) and [Test-NetConnection reference](https://learn.microsoft.com/en-us/powershell/module/nettcpip/test-netconnection).

## SMB shares, C$ and access denied

SMB carries Windows file-sharing traffic. Ordinary shares do not require administrator rights: access depends on the user's share and filesystem permissions. C$ is an administrative share and requires administrative access. Atlas's Open C$, Open C:\Temp and Open Packages use the selected remote machine's administrative share. A successful ping proves only an ICMP reply, not SMB availability or file access. For access denied, inspect the actual error, account, authentication, share permissions and filesystem permissions. For connection failures, check name resolution and SMB connectivity separately. Never request passwords or bypass enterprise controls. See Microsoft's [SMB troubleshooting guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/troubleshoot-smb-guidance).

## Package catalogue and SharePoint repository settings

Package catalogue browses available packages and scripts and opens within IT Console when launched there. Workspace's left deployment panel appears after selecting a target. Choose Find a package, Use selected package, then Install, Repair or Uninstall and the script. Favourites and recent packages speed selection. The default repository is the business-OneDrive-synchronised EPP_PACKAGE_REPO_BetaPackages - BetaPackages SharePoint folder. Sync it first; Settings can specify a repository when needed. Atlas does not sign into SharePoint or invent a replacement path. Repository access failure, an absent package and a missing script are different issues.

## Copy only, Copy & execute and Execute existing deployment

Workspace's Copy & execute transfers the selected package and launches its chosen script on the target. Advanced contains Copy only, Execute existing, Fresh copy and Threads. Copy only transfers files without installing; Execute existing uses the remote copy already present. Pre-flight checks deployment prerequisites when the operator chooses it. Review the target, package, action, script and mode before execution. Copy success, process launch and installation completion differ; inspect completion, exit code and logs before claiming success. Threads here means file-copy parallelism, not application CPU threads. Ask Atlas never executes deployments.

## Deployment queue, bulk rollout, history and recovery

Add deployment to queue prepares an item; Start queue runs it, Pause after current pauses between items, and Clear waiting removes waiting work without stopping a script already executing. Bulk Deploy accepts targets, package/action/script, Concurrent deployments and Robocopy threads; Deploy to targets starts the reviewed rollout. Copy failed and Export CSV expose results. History, Ongoing deployments and Recent deployment logs show recorded progress. Operation recovery lists interrupted or unmonitored work; inspect the target and logs before typing its hostname and choosing Acknowledge. Unknown completion is neither success nor a reason to rerun blindly.

## Installed software, repair, uninstall and package cleanup

Remote Admin's Installed software or a machine's Software inventory opens explicit software inspection. Review product, version, scope and proposed command before Repair or Uninstall. Machine-wide and user-specific installations differ; an unloaded profile can limit visibility. Cached MSI metadata does not prove an application is installed. Windows\Installer contains repair and uninstall files and is not disposable staging. Clean package folder or Clean Packages concerns Atlas's remote package folder, not arbitrary application files. The assistant cannot execute software actions or decide that an unrecognised package is safe to remove.

## Directory database import and complete snapshots

Manage Database → Users and computers import accepts an .xlsx workbook with Users and computers worksheets. Choose Validate and preview, review added/removed/changed users, machines and relationships, confirm the complete Europe snapshot, type APPLY, then choose Back up and apply. This directory import replaces the snapshot: omitted rows are removed. Do not upload one edited user as a complete directory. Discard preview leaves the directory unchanged. Imports are blocked while relevant jobs are active. Preserve identifiers, original columns and ambiguous relationships; never invent missing data. Ask Atlas cannot apply an import.

## Export column coverage, backups and restore

Directory column coverage shows imported columns, populated-row counts and their use. Download all directory fields (.ndjson) exports retained original directory cells. Empty fields require a newer or richer export, not inference. Back up and apply creates a backup and import-history entry. Import history's Restore directory before this import stages a preview from backup, preserving current seating and deployment history; review and apply explicitly. Refresh records reloads saved data, not live health. Reopen or refresh Atlas views after a successful import to display updated records.

## Seating Excel sync, vacancies and desk moves

Manage Database offers Official desk template, Previous seating template and Directory template; preserve sheet names and headers. Users and desks · Excel sync uses Desk ID, Name, Team, Account and Status. Download current users and desks, edit rows, upload and choose Detect changes, then review and type APPLY for Back up and apply seating changes. Leave Complete layout snapshot unchecked for partial edits; checking it vacates omitted desks. Vacating seating does not delete a directory account. For Desk moves, edit only Move to desk in the exported workbook, use Preview desk moves, type MOVE and apply. Occupants and account links move; equipment stays.
