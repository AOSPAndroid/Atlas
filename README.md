## Launch all six views

Double-click **[Start-All-Atlas.bat](Start-All-Atlas.bat)** to start the shared local services once and open six browser tabs: Classic Admin, Demo and hosted Preview, then Desktop Admin, Demo and hosted Preview. The Preview tabs require internet access. These are six views backed by two local services and the existing hosted site, not six separate installations.

**[Stop-All-Atlas.bat](Stop-All-Atlas.bat)** stops both local servers for every edition. Finish active jobs first. It leaves browser tabs open and does not unpublish hosted Preview. Existing per-edition launchers still work.

## Quick start and stop

| Edition | Start Admin + Demo | Stop local services |
| --- | --- | --- |
| Classic Atlas | [Start-Classic-Atlas.bat](Start-Classic-Atlas.bat) | [Stop-Classic-Atlas.bat](Stop-Classic-Atlas.bat) |
| Desktop Atlas | [Start-Desktop-Atlas.bat](Start-Desktop-Atlas.bat) | [Stop-Desktop-Atlas.bat](Stop-Desktop-Atlas.bat) |

Start opens Admin and Demo in the selected layout. Both editions share local services, so **either Stop script stops both editions' Admin and Demo**; finish queue jobs first. Hosted Preview stays online. To open only one mode, use its edition subfolder launcher.

**[Database update guide](docs/database-update-guide.md)** covers imports, backups, recovery, seating and hosted Preview updates.

## Choose your Atlas edition

- **[Classic Atlas](Classic-Atlas/README.md)** � normal Atlas layout, with Admin, Demo and Preview folders.
- **[Desktop Atlas](Desktop-Atlas/README.md)** � desktop layout, with Admin, Demo and Preview folders.

Both editions use the shared application below, keeping fixes, data and permissions consistent. Clone/download the complete repository; the edition folders contain launch profiles rather than duplicated application code. Existing root launchers still work.

# Atlas 7.0.0

**One workspace to find people, locate equipment and get IT work done.**

Atlas is a self-hosted Windows IT support and administration tool with a browser interface. It connects interactive office floor plans, directory users, machine inventory, application deployment and remote administration. Start with a colleague, a computer or a desk, then follow the links to the information and actions you need.

The **map** helps you explore floors and seating in 2D or 3D. The **IT console** brings user lookup, linked machines, health checks and deployment into one workspace. Both share the same command palette, package catalogue and detail panels. A separate **read-only demo/viewer** now includes the full IT console alongside maps, people and stored machine details.

## What Atlas can do

**New to the performance tools?** Read the [Remote Admin performance guide](docs/REMOTE_ADMIN_PERFORMANCE.md) for what each CPU, GPU, Memory and Overview button does, how to interpret the results, and a practical slowness investigation workflow. All scans require an explicit button click.

**PsExec terminal:** Open **PsExec** below **History** in the admin IT console for 30 templates covering Excel, sessions, diagnostics, networking, services, printing and repairs. Select a target and click **Run** to see live output and exit status in Atlas. Remote Command Prompt supports typed follow-up commands. Runs use the Atlas host account and your existing PsExec in `C:\Data`; repairs require target confirmation. Includes Stop, recent transcripts, favourites and optional command copying. Nothing starts automatically. [Setup, terminal controls and all 30 commands](docs/PSEXEC.md).

| Area | Capabilities |
| --- | --- |
| **Office maps** | Explore multiple floors in 2D and 3D, search desks and rooms, locate colleagues, and manage seating and directory links. |
| **People and machines** | Search directory and inventory exports; inspect accounts, organisation details, assigned machines, last recorded users and original export fields. |
| **Remote administration** | Check machine health and specifications, inspect software and resource usage, manage processes with confirmation, and open Windows support tools. Remote actions use the host account's existing permissions. |
| **Application deployment** | Browse a package catalogue, select install/repair/uninstall scripts, deploy to individual targets or a bulk queue, and follow progress, logs and history. |
| **Data management** | Preview and apply directory imports, review export-column coverage, maintain seating records, and back up or restore the database. |
| **Shared viewer** | Host a separate read-only interface on the local network for maps, people lookup and stored inventory. Editing, deployment and elevated remote operations stay in the admin tool. |

Atlas runs from Python source with FastAPI and SQLite; the interface uses HTML, CSS and JavaScript. The Windows launcher starts the local admin service and shared viewer together. Runtime records live in a persistent database, while deployment packages stay in your configured package repository.

## Atlas 7: Admin, Demo and private preview

All three versions share the current map and full console: Workspace, Remote Admin, Bulk Deploy, History, PsExec and the package catalogue. Demo and the owner-private preview let you explore every console page, select stored machines, switch between Overview/CPU/GPU/Memory, and prepare or copy any of the 30 PsExec commands.

**Deployment, live metrics/health, remote tools and PsExec execution are greyed out** with an explanation: use Atlas Admin from an elevated Windows account. Demo remains read-only even if its host is elevated; its server has no remote execution routes and rejects all writes. The hosted preview has no Windows backend. Neither starts scans or commands when browsing. Real metrics, package-share contents, deployment history and terminal transcripts are not fabricated or copied into the preview.

Admin and Demo use the same console source. The hosted preview receives those same assets while retaining its private directory snapshot and existing owner-only access.

## Map previews

These are screenshots of the Atlas renderer using **entirely fictional floors and sample desks**, with name tags disabled. They contain no real names, accounts, hostnames, IP addresses, seating assignments or office-plan geometry. The layouts illustrate the interface and are not the actual office floors.

| 2D floor navigation | 3D floor exploration |
| --- | --- |
| ![Atlas 2D map with a fictional floor, sample desks and name tags disabled](docs/images/atlas-map-2d.jpg) | ![Atlas 3D map with a fictional floor, sample desks and name tags disabled](docs/images/atlas-map-3d.jpg) |

[How the screenshots are produced](docs/images/README.md) · [How to run Atlas](#how-to-run-windows) · [Configuration and updates](#configuration-and-updates)

## How to run (Windows)

### First-time setup

1. On this GitHub repository, select the **main** branch, then **Code → Download ZIP**.
2. Right-click the downloaded ZIP and choose **Extract All**. Open the extracted folder containing `Install_Dependencies.bat` and `Start-Office-Atlas.bat`. Keep all files and subfolders together and run the scripts from the extracted folder.
3. Install **Python 3.12** if it is not already installed, including the Python launcher (`py`). `Python_Settings.bat` detects it through `py -3.12`. If your organisation provides Python elsewhere, set `WMI_PYTHON` to that interpreter's full executable path.
4. Double-click **`Install_Dependencies.bat`**. Wait for **Dependencies installed** and press a key to close the window. This installs the Python packages listed in `requirements.txt` and needs access to your configured Python package index.
5. Double-click **`Start-Office-Atlas.bat`**. It starts both the admin tool and the read-only viewer, then opens two browser tabs.

**Normal startup: `Start-Office-Atlas.bat`.** Dependency installation is needed for the first setup, after changing Python, or when an update changes `requirements.txt`.

Git and Node.js are not needed to run the downloaded application. The download includes the application, maps and initial directory database. Application installers used for deployment stay in your separate package repository. Atlas automatically looks for the synced **EPP_PACKAGE_REPO_BetaPackages - BetaPackages** SharePoint folder in business OneDrive; no repository setting is needed when that folder is available. Sync the SharePoint shortcut through OneDrive before deploying.

This is a normal project tree containing Python source, browser assets, floor plans, templates and tests. No TXT-to-Python extraction is needed.

If you already use Atlas, follow [Configuration and updates](#configuration-and-updates) to retain your live database and settings when updating.

After updating and restarting Atlas, refresh any open browser tabs. Console scripts and styles use versioned URLs, and admin pages revalidate cached files so an older console script cannot keep adding removed interface sections. API responses are not cached.

### Open and share Atlas

| Interface | Address | Access |
| --- | --- | --- |
| Your admin tool | `http://127.0.0.1:8770` | Local computer only; existing editing and IT operations |
| Shared read-only viewer | `http://YOUR-IP:8771` | People on your reachable network; full console, maps and stored directory lookup; execution disabled |

Use the host computer's Wi-Fi/Ethernet IPv4 address in place of `YOUR-IP`. The launcher prints candidate addresses and saves them in `data/share-addresses.txt`. Share the address belonging to the network your colleagues use. The viewer requires only a browser, not Python or Windows elevation on their computers.

**`Stop-Office-Atlas.bat` stops both servers.** Finish active deployments before stopping. Starting again reuses this folder's running servers. Occupied ports fail with an error rather than attaching to another installation. Closing a browser tab does not stop hosting.

To change ports, set `ATLAS_ADMIN_PORT` and `ATLAS_VIEWER_PORT` before launching; they must be different. Logs are in `logs/admin-startup.log` and `logs/viewer-startup.log`.

### If startup fails

- **Python 3.12 not found:** install Python 3.12 with the launcher, or configure `WMI_PYTHON` as described above.
- **Dependency installation failed / Dependencies missing:** rerun `Install_Dependencies.bat` and check its error message; dependencies must be installed for the same Python that starts Atlas.
- **Startup failed / port occupied:** check the startup log named in the error. If this folder has an unresponsive Atlas server, run `Stop-Office-Atlas.bat` before starting again. If another application uses the port, choose different Atlas ports.
- **Browser tabs did not open:** try `http://127.0.0.1:8770` for admin or `http://127.0.0.1:8771` for the viewer after a successful startup.

## One command palette across Atlas, the IT console and the shared viewer

Press **Ctrl+K** (or **Cmd+K** on a Mac browser), or click **Search Atlas** in either header. Search people, machines, desk codes, teams and admin views in one place. Use arrow keys and Enter to open a result, and Escape to close.

Use `person:`, `machine:`, `desk:` or `>` to narrow results. In the IT console, person results open their details and linked machines in the Workspace, even when they have assigned desks; name searches prioritize directory people over desk matches. Explicit desk results open the map. From the map, people with a single mapped desk open there; multiple locations offer a choice. Unmapped people and machines open selected in the existing IT console. Name-only desk matches are identified as unconfirmed. Actions open the existing admin interface and keep its review/confirmation flow. Both admin views load the same component, isolated stylesheet and command catalogue. Commands belonging to the other view navigate there; selected machines carry across where available. Deployment, file-access and remote-operation commands open their existing controls for review. The shared viewer uses the same component, styling, keyboard controls and animation setting, with console navigation enabled and privileged commands shown greyed out. Its person and machine results stay inside the read-only viewer.

## Site information

Click the circled **i** near the lower-right edge of the map for the site VLAN reference and useful phone contacts. The panel has **VLANs** and **Contacts** tabs, with phone-number copying and call links. Search **VLAN** or **Contacts** in the shared command palette to open the corresponding tab from Admin, Demo or the private preview. In the IT console, the same panel opens without leaving the console. These are stored reference details; opening the panel makes no remote checks.

## Shared viewer

- Explore the same ten-floor 2D/3D map, search seating, inspect desk records, and export the displayed records.
- Use **Ctrl+K / Search Atlas** or **User lookup** to search the Europe-wide directory by name, account, email, BRID or machine name. Open a person to see their linked machines and mapped desks. Inspect a machine to see stored inventory, assignment/logon relationships, linked people and recorded desks; copy its stored report when needed.
- Both processes read the same runtime database (`data/office_atlas.db` by default). **Refresh records** reloads seating changes made in the admin interface; directory queries read the current database on each request.
- Read-only means no seating edits, imports, settings changes or deployment actions. Live remote health/software checks that use the host's privileges are unavailable. Stored inventory details remain visible.

The viewer is a separate FastAPI application with only explicitly registered read routes. It does not import or register the admin backend. SQLite is opened with `mode=ro` and `query_only`; mutation requests receive HTTP 403. Administrative GET endpoints, full-database downloads and server files are not served. The admin interface retains its loopback and same-origin checks. Browser controls are hidden for clarity; the server enforces the restrictions.

The host must remain awake and network-reachable. Windows Firewall or your organisation's firewall must allow inbound TCP on the viewer port (8771 by default). If colleagues cannot connect, check that rule and the selected network/IP; changing the admin bind address is unnecessary. The launcher does not change firewall policy. This is an unauthenticated internal viewer: anyone who can reach its port can read the displayed directory and maps.

## Machine details

The console, map and shared viewer use the same Atlas header, blue eagle branding and sidebar dimensions. The console keeps its Workspace, Remote Admin, Bulk Deploy and History navigation below the header. Map import, export and database backup actions are grouped under **More**.

Application deployment appears beneath **History** in the left sidebar after selecting a target in Workspace, giving the directory and machines the full remaining width. Open the package selector to search or choose a favourite/recent package; Escape restores the previous selection. **Install / Repair / Uninstall** choose the action. **Advanced** contains threads, fresh copy, alternative execution modes and package checks. The sidebar scrolls on shorter screens; on phones, use the floating **Deployment · hostname** button. Selection is retained when minimized, and clearing the target hides the panel. A job's compact status and expandable log appear only for its original target; failures open the log automatically.

**Package catalogue** opens the same dialog within the console or map, without navigating away. Browse packages, inspect scripts and edit display names or versions. Closing it returns to your current view and preserves the selected target and deployment form.

**Quick health on machine selection.** Clicking a machine in the map or IT console refreshes ping, C$ access, C: storage/free space, last boot and Windows uptime. A short delay skips targets passed over quickly; clicking the same machine again refreshes these readings after the current check finishes. Automatically displaying a user's only linked machine does not start checks until you select it. **Scan health / Refresh health** explicitly collects the full health readings; specifications also wait for Scan health. CPU, GPU, memory, process/thread and slowness scans remain manual, with no periodic refresh. Demo and hosted preview keep live checks disabled.

In the IT console, scrolling past the full person card or machine-health panel reveals a compact floating version above the machine list. The person card keeps name, account, email, team and office visible; health chips show the selected target's existing readings. Click either heading to return to the full panel. The cards disappear when their original panels return into view, the lookup is cleared, or you leave Workspace. Scrolling does not run additional health checks; refresh from the full health panel or the machine's right-click menu. Hover a health chip for the full reading and its check time.

Right-click a linked machine to refresh health, open Remote Desktop, Computer Management or Event Viewer, or use the existing copy, remote assistance, file, deployment and inventory actions. Actions use the right-clicked machine. The menu stays within the screen and scrolls when needed; use the mouse wheel or arrow keys, Home/End to reach the first/last option, and Escape to close it. Remote tools use the host computer's current account and existing access permissions.

Expand **Machine details** in the IT console, admin map or shared viewer to inspect the machine's stored export fields. Identity shows infrastructure category, manufacturer, model, serial number, correlation ID, record class and description when supplied. Ownership distinguishes the assigned person from the inventory's last logged-on user. Discovery shows the inventory status, discovery source and the discovery/update timestamps. Machine reports use the same fields.

Empty optional fields are omitted. An absent assignment or last user is labelled **Not supplied**. **Operational** is an inventory status, not proof that the machine is online; last logged-on user does not identify a current session. The current computers export does not supply CPU, disk capacity/free space, BIOS, Citrix registration or maintenance state. Available live specifications remain in the admin health/specifications tools.

## Use every directory export column

The included export supplies **14 person columns and 14 machine columns**. All are mapped to the directory database. Person details show **Department**, **Business unit** and **Organisation** separately. Excel serial values in **Last login time** display as readable dates and times; no timezone is inferred from the export.

Open **User details → All export fields**, or **Machine details → All export fields**, to inspect, filter and copy every field for that record. Original column headings, empty values and zero values remain inspectable. When an original value differs from Atlas's formatted or normalized value, both are shown. Fields are fetched only when this inspector opens, so ordinary searches and map animations do not download the source archive.

**User details** groups useful information into Organisation and Account activity. It shows the most precise recorded login, removes duplicate account/date values and omits empty fields. **Find manager**, **Same department** and **Same office** open a prefilled search in the shared palette; your current person remains selected until you choose a result. These shortcuts and the grouped details work in the console, map and demo. The console retains its domain-account display and copy action.

**Domain account** follows the confirmed Windows-login convention: an exported `G` followed entirely by digits uses `x` with the same digits for its login (for example, `G00123456` → `INTRANET\x00123456`). Other usernames and existing domain prefixes are preserved. The console, map and demo show the same derived login; console copies and support reports use it too. Searches accept either the original G identifier or the X login, including domain-qualified logins. The imported Account, Employee ID, original export values and stored relationships remain unchanged. If separate G and X records exist, Atlas asks you to select a result.

Search the console, shared command palette or viewer lookup using field prefixes:

| Find | Examples |
| --- | --- |
| Equipment identifiers | `serial:ABC123`, `asset:12345` (correlation ID); exact serial/correlation IDs also work without a prefix |
| Hardware and inventory | `manufacturer:Dell`, `model:Z2`, `class:computer`, `infrastructure:desktop`, `status:Operational`, `source:discovery` |
| Ownership | `assigned:account`, `last_user:account` (recorded inventory values) |
| Organisation | `team:Support`, `business:Technology`, `organisation:Operations`, `location:Paris`, `manager:Name` |
| Person details | `title:Engineer`, `worker:Permanent`, `start_date:2026`, `last_login:2026-09` |

The underlying directory field names and source column names also work as prefixes. Searches are case-insensitive, limited to 100 results, and treat `%` and `_` literally. Narrow broad searches for more specific results.

**Manage Database → Directory column coverage** shows each column, its populated row count and where it is used. The import preview includes the incoming coverage and warns when columns disappear. **Download all directory fields (.ndjson)** exports the complete stored snapshot, including additional worksheets and rows without a usable identity. NDJSON contains one JSON object per line, starting with the column inventory.

Directory imports now retain the original cell values, worksheet names, row numbers and column headings alongside the existing operational tables. Additional columns and worksheets are retained automatically. Duplicate or blank headings are preserved by column position; two headings that map to the same operational field are rejected to avoid overwriting a value. The archive preserves exported values, not Excel formatting or executable formulas; formula cells contribute their saved cached value. Existing databases without an archive still expose all stored fields and explicitly say that original cells require a directory refresh.

Archive replacement is part of the same database transaction as a directory refresh. Backups retain it. Restoring a pre-archive directory clears the newer archive so it cannot be mistaken for the restored snapshot. Seating records, history and deployment data keep their existing refresh protections.

The demo shares the person/machine inspector, date display and field searches. It serves the established 28 directory fields; newly encountered columns and the full archive remain in the local admin interface until their intended shared use is defined.

## Configuration and updates

The default package repository is the synced **EPP_PACKAGE_REPO_BetaPackages - BetaPackages** SharePoint folder, inside **Shortcuts** or directly inside business OneDrive. Atlas checks `OneDriveCommercial`, the current account's registered business OneDrive folders, and the standard business OneDrive location. When running under a separate admin account, it can use the exact package folder from a loaded Windows profile if only one accessible match exists. It does not guess between multiple users' package folders.

Leave `package_repository` blank in `config.json` (as in `config.example.json`), or omit `config.json`, to use automatic detection. An explicit repository saved through admin **Settings** takes precedence; `WMI_PACKAGE_REPO` overrides both. These defaults do not sign in to SharePoint or create its OneDrive shortcut. Local configuration, logs, process records and SQLite journal files are ignored by Git.

The database and floor plans were already part of this private repository's embedded package and are now ordinary files. Keep the repository private. The launcher copies the distributed `office_atlas.db` seed into ignored `data/office_atlas.db` once, preserving existing records with SQLite backup. Subsequent launches keep that runtime database. Stop both servers and back up `data/office_atlas.db` before updating; preserve the `data` directory and `config.json` when moving to a fresh checkout. Set `ATLAS_DB_PATH` to use another existing Atlas database. Direct backend development uses the runtime database if present, otherwise the root seed. Use the admin database manager for supported directory refreshes.

See [IT operations and imports](docs/operations.md) for deployment modes, software repair/uninstall, directory replacement, seating Excel sync and backup workflows.

## Development

```powershell
py -3.12 -m pip install -r requirements-dev.txt
npm ci
py -3.12 -X utf8 tests/run_all.py
py -3.12 launcher.py run --no-browser
py -3.12 launcher.py stop
```

`backend/main.py` hosts admin routes; `backend/viewer.py` hosts shared read routes; `directory_lookup.py` shares database-only lookup queries; `atlas/official-app.js` renders the common map; `atlas/viewer.js` provides read-only user and machine inspection.

The test runner uses disposable database copies, starts isolated UI fixtures on ports 8892/8893, and runs the Python regressions plus eighteen Node DOM suites. Remote operations are simulated. `npm run format:check` verifies formatting of the maintained browser sources.

The source tree also retains inputs and maintenance tools that are needed to reproduce or import data:

- `directory_workbook.py` provides the workbook parser and schema used by directory imports, seating sync and desk moves.
- `database040926.xlsx`, `atlas/data.json` and `atlas/visual-seating-matches.json` support the initial directory and previous-seating migration. The Excel templates remain available from Manage Database.
- `tools/build_official_3d.py` extracts geometry into `atlas/official-data.json`; `tools/build_studio_plans.py` generates the current `atlas/studio-floor-*.svg` backgrounds from the retained official PDFs. These optional build tools require PyMuPDF and rewrite their outputs; normal startup does not run them.
- The [floor-plan review](FLOOR_PLAN_AUDIT.md) covers all ten original plans, the reviewed furniture/stair/amenity corrections, source-coordinate checks and remaining physical-layout uncertainties. Run the correction generators after rebuilding the base geometry; normal startup loads their checked-in results without parsing PDFs.
- `scripts/serve_documentation_preview.py` generates the fictional map used for the [documentation screenshots](docs/images/README.md).

## Optimization changes

- The IT console is split into shared state, directory, deployment, shell, and software modules. One shell initializer and one shared command catalogue replace the accumulated version overrides and duplicate shortcut definitions.
- `client.js` owns session tokens, stale request cancellation, and job polling with bounded retries. Palette searches revalidate a compact desk index instead of downloading the full map state.
- Shared person cards and dialog styling keep the console, map, and viewer consistent. Shared database-only desk resolution preserves confirmed versus suggested links.
- Official custom locations retain their layout across save, reload, and export. Queues pause, resume, and cancel using the same server queue ID.
- Worker admission, deployment execution, and remote inventory concurrency are bounded. Inventory no longer holds the global directory-mutation gate while querying a remote machine.
- Job snapshots survive restarts. Interrupted work is never replayed automatically. Open **Operation recovery** from either admin palette, inspect the named target, then acknowledge its exact hostname before retrying. Unresolved-target guards survive event retention; deployment history remains available.
- The runtime retains up to 200 completed job snapshots and 200 completed queue snapshots, with 200 events per job. Active work is retained until terminal.
- Workbook shared strings belong to each workbook operation; imports release connections and temporary resources. Static assets revalidate through normal browser caching while API responses remain uncached.
- Removed the unused previous-map renderer and superseded stylesheet; historical seating data and import support remain available.

## Motion and map navigation

**Left-drag moves the map; right-drag rotates and tilts it in 3D.** Rotation stays anchored around the spot you grab. **Shift + left-drag** is an alternative for trackpads. Scroll to zoom, or use the rotation and reset buttons. A simple left-click selects a desk; a right-click without dragging opens its admin menu (or inspects the desk in the read-only viewer). Left-drag moves the map in both 2D and 3D, following the pointer at any zoom level. Admin and demo share these controls.

Search or select a person to glide to their desk with a brief location highlight. Longer moves pull back slightly before closing in, so the destination stays in context. Search groups are framed smoothly; zoom buttons, cursor-anchored wheel zoom, reset, and rotation share the same camera controller. Switching to 3D tilts the map into place, while floor changes fade in briefly.

Palettes, dialogs, person cards, console pages, and drawers use the same short motion timings. Both the admin map and shared viewer receive the map effects. Dragging immediately cancels automatic movement; repeated searches replace the previous destination. The **Animations On/Off** switch is available beside the map view controls; use **Ctrl+K → Toggle animations** in the IT console. **Off** disables map movement and interface animations immediately; **On** enables them. Before you make a choice, Atlas follows your system reduced-motion preference. Your choice is saved for that browser and Atlas address; the viewer has its own preference. Changes apply immediately, including during a camera flight.

No frontend runtime library was added. Camera movement shares the existing render loop and stops when settled. Cached geometry is reused throughout animations. Regression checks cover rapid selection, manual interruption, cursor anchoring, reduced motion, and rendering after the animation ends.

With **Animations On**, selecting a user or machine brings their details or deployment panel up with a quick slide and soft settle. A brief blue outline marks a selected machine; dialogs and the command palette lift into view. Machine, person and health cards appear in a short cascade while scrolling, with at most six effects per batch and 160 ms of stagger. Buttons also give a small press response. Admin, Demo and the private preview share these effects.

Movement and fades use transforms and opacity; there is no idle animation loop, extra library or remote scan. The IT workspace uses a faster profile: panels settle in 280 ms, cards use 180 ms with no stagger delay, and page transitions use 240 ms. The map keeps the richer motion. A panel entrance replaces any card effects inside it, rapid selections replace unfinished entrances, and leaving the tab cancels running effects. Completed effects leave no permanent transforms behind. **Animations Off** and **Citrix / remote** skip these decorative effects immediately. Content stays readable before observation and throughout the stagger.

The map renderer, camera controller, animation switch, person cards, dialog styles and palette are shared source files across admin and viewer. Viewer commands use the common command catalogue and clearly mark unavailable operations; permissions continue to be enforced by the separate read-only server.

Remote Admin shows up to 100 processes sorted by CPU, GPU or memory, with the full process count alongside. Right-click a row, press Shift+F10, or use its **•••** button to **Kill process**, copy its PID or copy its details. Killing a row confirms its name, PID and machine, rechecks the process creation time, reports Windows' result, and refreshes after success. Core Windows processes are blocked. The manual PID/name field also confirms before terminating; a name targets every matching instance. GPU usage reports the busiest engine per process and requires counters exposed by the remote graphics driver; unavailable counters produce an explicit message. These remote operations remain available only in the local admin version.

## Troubleshooting performance in Remote Admin

### Citrix and remote display mode

Choose **Display → Citrix / remote** in the shared header on the map, console or demo. This browser preference is remembered and synchronized between tabs on the same origin; choose it separately in the demo or another browser when needed. It does not start scans or change permissions.

In this mode, map drawing is capped at 30 rendered frames per second. Camera transitions take at most 280 ms and skip the panoramic zoom detour. While moving, the 3D buffer uses 75% width and height (about 44% fewer pixels) and only the selected person's name label remains visible. Full resolution and nearby labels return when movement settles; all desks remain selectable. Decorative CSS animations, scroll reveals, locator pulses and backdrop blur are disabled. The existing Animations Off setting still makes camera transitions immediate. Standard mode retains the normal presentation.

There is no continuous idle rendering or background performance probe. Lower render resolution is a standard [WebGL performance technique](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#consider_rendering_to_a_smaller_back_buffer), but actual Citrix smoothness also depends on the session and connection; validate on the affected desktop.

If WebGL initialization fails, Atlas reports the available error and lets you retry by switching 3D on again. A lost graphics context falls back to 2D; after restoration, manually enable 3D to rebuild the graphics resources. The display mode cannot enable WebGL when the browser or enterprise configuration blocks it.

### Manual performance capture

Click **Scan for slowness** while the user reproduces the problem. Opening Remote Admin, selecting a machine or waiting on the page never starts a scan. Each click starts a light capture: at most six samples over 60 seconds, with at least 10 seconds of rest after each completed check. It highlights busy CPU consumers, individual logical-processor saturation, memory pressure with paging activity, elevated disk response during I/O and commit headroom. Each finding includes measured evidence and a next check. Repeated evidence requires at least three matching observations spanning eight seconds and 60% of the available samples; brief spikes and limited evidence remain labelled separately. These thresholds guide investigation and do not establish a root cause.

To limit overhead, the capture requests selected WMI properties and excludes GPU engine enumeration, individual thread enumeration and volume inventory. Those deeper checks remain available through **GPU**, **Disk** and **Inspect CPU threads**. Only one performance collection runs at a time per Atlas server, with a server-enforced pause between diagnostic samples for the same machine. The collector has a 15-second timeout. The browser rests 20 seconds if CPU is at least 90%, RAM is at least 95% or a check takes at least five seconds; it stops after a failed request, a check lasting at least 10 seconds, or elevated WMI provider CPU (5% of the machine or the equivalent of 50% of one logical processor). WMI provider activity can come from other monitoring software; this does not attribute its load to Atlas. Fewer samples can miss brief spikes. Monitoring still has a cost: [Microsoft documents WMI performance issues from large or frequent queries](https://learn.microsoft.com/en-us/troubleshoot/windows-server/system-management-components/scenario-guide-troubleshoot-wmi-performance-issues), so zero impact cannot be guaranteed.

**Copy findings** produces a ticket-ready report with the timeline, check durations, coverage and collection failures. Captures also stop when cancelled, when the tab is hidden or when leaving Remote Admin, and are kept only in the current page. An already-started remote WMI query may finish after cancellation or the collector timeout. Changing the target clears the capture. The process list selects consumers across CPU, RAM and I/O, plus up to 20 Excel and 20 WMI provider instances, while preserving process identity checks. No workbook is opened or modified, and no process is terminated automatically.

WMI cannot identify a particular slow formula, add-in, Citrix session delay or hypervisor scheduling problem from these counters. The report explicitly lists those gaps; **Cause not established** is a valid result. For deeper investigation, use [Microsoft's Excel calculation guidance](https://learn.microsoft.com/en-us/office/vba/excel/concepts/excel-performance/excel-improving-calculation-performance), [Citrix session performance](https://docs.citrix.com/en-us/citrix-virtual-apps-desktops/director/troubleshoot-deployments/user-issues/session-performance) and host-side VMware metrics where applicable. Diagnostics remain administrator-only.

Enter a machine, select **Overview**, **CPU**, **GPU** or **Memory**, then click that view's **Scan** button. Switching views never starts a scan. Each view keeps its own last result for the current machine; **Refresh** takes another sample and shows percentage-point changes since its previous scan. A failed refresh keeps the previous result with a failure message and its original timestamp. Changing the machine clears all four results. **Copy report** copies only the selected view's readings and process list.

| View | What it collects and displays |
| --- | --- |
| Overview | CPU, GPU, RAM, commit, paging and disk pressure; CPU-ranked processes and expandable disk/processor details. |
| CPU | Machine and logical-processor CPU, queue, total threads and context switches; CPU-ranked processes with manual thread inspection. No GPU, memory or disk providers. |
| GPU | GPU engines and GPU-ranked processes with reported counters, with the busiest engine identified for each process. No CPU, memory or disk providers. Processes with no GPU counters are omitted from this list. Missing GPU counters stay unknown, not 0%. GPU memory is not collected. |
| Memory | Used/available RAM, committed memory and limit, paging reads; resident-memory-ranked processes with RAM percentage, private commit, page faults and handles. No CPU, GPU or disk providers. |

All four scans project only the WMI fields they need. The simulated-provider regression checks 14 queries for Overview, 8 for CPU, 3 for GPU and 6 for Memory; these counts do not measure execution cost. The light slowness capture remains at 12 queries per sample. Nothing polls outside an explicitly started, bounded capture and no collector is installed on the target. The interface prevents overlapping resource scans; the server also enforces its collection limit. Ping, C$ and Disk utility results do not replace the selected performance view.

- CPU, memory and GPU rings show overall usage versus remaining capacity in the relevant view. RAM shows both a percentage of usable physical memory and readable KiB/MiB/GiB sizes. Each process table contains only that view's metrics.
- In Overview, expand **Processor activity & disks** for logical-processor activity, physical-disk read/write latency and queue depth, and volume free space. CPU and GPU views show their processor/engine breakdown directly. Each view has its own measurement guide.
- From CPU or Overview, click a thread count or choose **Inspect CPU threads** from the process menu. Two raw samples, at least one second apart, show each thread's usage of one logical CPU and of the whole machine, context switches, priority, state and wait reason. Process identity is checked before and after collection; new or reused thread IDs have no fabricated CPU rate. The busiest 200 threads are shown with the total thread count.
- Red process values start at 25% machine CPU, 80% GPU or 20% of usable RAM; amber starts at 10% CPU/RAM or 50% GPU. A count of 500+ threads is amber only. These are visible investigation thresholds, not proof of a leak, fault or excessive thread creation. Repeat samples to check whether pressure persists.
- Missing providers produce partial results and explicit warnings. GPU counters depend on Windows, the driver and the Citrix environment. These host-privileged diagnostics remain unavailable in the shared read-only viewer.

CPU and disk rates use differences between raw counters and the target provider's timestamps. Thread wait states are instantaneous observations, not call stacks or a measurement of blocked time; see [Microsoft's thread counter reference](https://learn.microsoft.com/en-us/previous-versions/aa394279(v=vs.85)). GPU summaries follow the busiest-engine principle described in [Microsoft's Task Manager explanation](https://devblogs.microsoft.com/directx/gpus-in-the-task-manager/). Per-process GPU values and resident working sets must not be summed into a capacity pie: engines and memory pages can be shared. The charts instead use machine-level totals. High I/O or page-fault rates alone do not establish disk trouble, and these WMI snapshots cannot measure end-to-end network or Citrix session latency.

### Floor framing and machine filters

The map fits the complete current floor into its available canvas on opening, floor changes and **Fit floor**. While fitted, it adapts to window resizing. Finding a person uses a short, modest zoom that keeps surrounding desks visible; manual pan and zoom remain available. Both 2D and 3D use the same framing in admin and demo, including Citrix display mode.

Linked-machine lists in the map, IT Console and demo offer **All**, **Dedicated desktops**, **VDI**, **Kiosks** and **Other** filters with counts. Select several types to combine them, or choose All to clear the filters. Assigned machines stay first and filtering never changes the selected deployment target or starts a scan. Kiosks follow the `PWMK` naming pattern after any three-letter region prefix (including `GBR`, `PAR` and `NYK`); `PWMF` identifies dedicated desktops, and hostnames containing `VDI` identify VDI machines. Other names stay accessible under Other rather than being guessed from the country code.

The map uses a compact white arrow with a rounded dark outline, changing to Barclays blue over interactive items. Both admin and demo use native browser cursor images with standard fallbacks, a grabbing hand while dragging and a crosshair for desk placement. There is no cursor animation loop or extra remote traffic.

### Enable Remote Registry

Search **Enable Remote Registry** in the palette or right-click a machine in the map or IT console. The action shows the hostname before you click **Enable Remote Registry**. Atlas starts the fixed `RemoteRegistry` service over WMI, changes Disabled startup to Manual only when necessary, verifies Running, and reports failures. It requires remote administrator rights and runs only on explicit request. No reboot or automatic startup is added. Demo and hosted preview disable the action.

### Deployment launch status

Copy & execute shows **Launched** as soon as Windows confirms the remote process started. Script exit codes do not turn that status into Failed or imply installation success. Output and exit codes remain in the log/history; copy or process-start errors still fail. Background log collection retains the target lock while the process runs. Demo and hosted Preview remain read-only.

### Reboot checks in Queue

The Reboot button captures the selected hostname, requests the reboot once, then opens a live ping terminal in the floating Queue drawer. Windows must accept the request. Two consecutive missed IPv4 echo replies followed by two consecutive replies mark the check complete; replies before the offline transition never count as a completed reboot. This confirms network reachability, not that sign-in or applications are ready.

Ping checks run about every two seconds, stop immediately on confirmed return, and completed cards disappear after ten seconds. Stop monitoring ends only the ping checks, not a reboot already requested. A fifteen-minute timeout leaves a visible unconfirmed result for dismissal. At most eight machines can be watched simultaneously; duplicate watches are rejected. Closing the drawer or refreshing the browser leaves the server watch running; stopping Atlas ends it. Demo and Preview display the shared interface but cannot reboot or ping machines.

### Activity widgets in Queue

The floating Queue now includes live widgets for deployments and batches, deployment queues, reboot checks, PsExec sessions, software inventory/actions, CPU/GPU/memory and process scans, health checks, Remote Registry, cleanup, remote tools and database imports. Widgets show the original target, state and available output. The badge combines active widgets with waiting local deployments and reboot checks, without counting child jobs twice.

The activity feed reads existing server state; it never starts a remote scan. Slowness capture has a Stop capture control; PsExec can stop its local session; deployment queues can pause after the current item, resume or cancel waiting items. Ordinary running requests and installers are not given a misleading Cancel button. Completed widgets clear after ten seconds; failed or uncertain results remain briefly for inspection or dismissal. Opening Queue does not repeat an action. Demo and Preview show the shared layout but make no live activity requests.

### Windows features and DISM through PsExec

The Windows features & DISM category provides Enable .NET Framework 3.5, check NetFx3 status, enable Microsoft Print to PDF, list optional features, CheckHealth, ScanHealth, RestoreHealth, AnalyzeComponentStore, and list Windows servicing packages. These templates run DISM on the selected remote machine as SYSTEM (`-s`) using the configured local PsExec path (default `C:\Data\PsExec.exe`).

Feature changes and repair retain the existing typed-hostname confirmation and use `/NoRestart`. Exit 3010 is reported as completed with a restart required, not failure. Long DISM commands have a bounded one-hour terminal timeout, with output in the PsExec terminal and Queue activity widget. Stopping the local session does not guarantee a remote DISM operation stops. Preview/Demo keep execution disabled.

NetFx3 enable applies to Windows 10 and Windows 11 through 25H2. Windows 11 26H1 and later need the standalone .NET 3.5 installer. Component availability and downloads depend on Windows edition and the organisation's repair-source policy. CheckHealth reports known corruption; ScanHealth performs a scan; RestoreHealth repairs; AnalyzeComponentStore only reports usage. See Microsoft: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/repair-a-windows-image and https://learn.microsoft.com/en-us/dotnet/framework/install/dotnet-35-windows-11.

### Package deployment flow

Workspace package selection applies immediately: clicking elsewhere, switching machines or refreshing filtered results keeps the chosen package. Workspace and Bulk deploy use the same Install / Repair / Uninstall switch and load the corresponding scripts. The launch button names the action and target (or bulk machine count). Bulk submissions are blocked while scripts load or a request is being submitted, and each request captures its package, action and targets. Demo and hosted preview show the controls with execution disabled.

### Knowledge Base: Draw.io diagrams and notes

Use Map / Workspace / Knowledge Base in the header. Atlas embeds the actual open-source Draw.io 31.5.3 editor, bundled under `frontend/drawio` with licenses and provenance. It loads only when opened. No external diagram or AI service is used; the editor blocks external network connections.

- Native Draw.io shapes, connectors, pages, layers, formatting, undo/redo and zoom, with incident-triage and network templates.
- Notes to diagram converts steps, indented bullets and `A -> B` connections into editable shapes. `Check ping? -> [Yes] Check application` creates a decision and labelled connection. Conversion is deterministic and local, not AI interpretation. Review the result. Existing diagrams are kept separately.
- Admin auto-saves to `data/knowledge.sqlite3`. Revision checks prevent silent overwrites between windows. Back up this database, or export documents.
- Demo and Preview provide the same editor with downloadable drafts. Download Atlas JSON to retain notes and diagrams before closing. Admin documents are never included in preview builds or exposed through the LAN viewer.
- Open `.drawio`, `.xml` and Atlas JSON. Export Atlas JSON, Draw.io XML, SVG or PNG. Only Atlas JSON includes accompanying notes.
- Search `drawio` in the palette for documents, notes conversion, shapes, connecting two selected shapes, layers, formatting, duplicate/delete, undo/redo, zoom, save, import/export and templates. Ctrl K works inside the editor.

Restart Atlas after updating to register editor and document routes. Remote-administration permissions remain unchanged.

### Optional Atlas Desktop

Choose **Desktop** beside the Map / Workspace / Knowledge Base links, or open `/assets/desktop.html`. Classic remains the initial layout; this browser remembers the chosen layout. Use **Window > Switch to Classic Atlas** to return.

The desktop dock opens Map, Workspace and Knowledge Base on demand. App windows can be dragged, resized on all edges, minimized, maximized by the green control or title-bar double-click, or snapped left/right. Red hides the window without closing its work. Dock indicators identify open and active apps. **All apps** searches the core apps and seven working utilities: Calendar (local events and calendar export), Notes (saved scratchpad and text export), Reminders (checklists), Calculator, Clock (world clocks and stopwatch), Files (local file previews) and Music (local audio playback). Calendar, Notes and Reminders are saved in this browser, not synced to Outlook or a corporate account. Files and audio remain local.

**Window multitasking** switches between floating windows and one active app filling the desktop. App frames stay alive so selection, unsaved notes and operation monitoring survive dock switching. Minimized maps stop drawing. Compact screens automatically use one active app without changing the saved multitasking preference. Animations respect Atlas and system motion preferences. Window positions are stored locally; **Reset window positions** brings them back into view. Focus a title bar and use arrows to move, or Shift+arrows to resize.

Admin, Demo and Preview use the same shell, with existing remote-administration restrictions. Layout changes or browser reloads reload apps; save/download diagrams first. This is a browser desktop theme, not an operating system or virtual machine.

Desktop settings include utility light/dark appearance, four minimal Atlas wallpapers, accent colour, dock size, magnification, auto-hide, transparency, and clock format/seconds. Preferences stay in this browser. Utilities load only when opened; hidden clocks skip rendering.

### PsTools suite in Classic and Desktop

The **PsTools** page (formerly PsExec) now includes a tool selector, searchable templates, command previews and the existing embedded terminal. Search Ctrl+K for PsTools or a utility name. Extract Microsoft's PsTools into `C:\Data` on the **Atlas host**, then start Atlas from an elevated account. The PsExec path determines the folder: `C:\Data\PsExec.exe` selects the adjacent tool executables; a PsExec64 path selects their 64-bit names. Each tool must be present and its Microsoft licence reviewed under the same account before running it here. Atlas does not download tools or accept licences automatically.

| Tool | Included functions |
| --- | --- |
| PsExec | Existing remote commands, interactive command prompt and DISM templates |
| PsFile | List shared open files; close one file ID with confirmation |
| PsGetSid | Computer SID; account/SID lookup |
| PsInfo | System information/uptime, volumes/free space, software, hotfixes |
| PsPing | Ten ICMP pings or TCP connection attempts from the Atlas host |
| PsList | Process snapshot/tree; PID memory and thread details |
| PsKill | Terminate a confirmed PID |
| PsLoggedOn | Profile/share logons or local logons only |
| PsLogList | Recent System/Application events; seven days of restart evidence |
| PsService | Query/configuration/dependencies; start/stop/restart/pause/resume |
| PsShutdown | Restart/shutdown countdown; cancel pending shutdown |
| PsSuspend | Suspend/resume one confirmed PID |
| PsPasswd | Local help only; password changes are deliberately not sent through Atlas's recorded terminal |

PsUptime is incorporated into PsInfo. No alternate credentials are collected by these templates. Review current process/file IDs immediately before a change; they can be reused. Changes require typing the target hostname. Direct tools run with argument arrays without a command shell; they do not inherit PsExec's flags. Terminal completion describes the command process, not proof a reboot or application operation has finished. Some tools have nonstandard exit codes (PsInfo can return the service-pack number); inspect their output. Stopping a local session does not undo a remote operation.

Admin is required for execution; Demo and hosted Preview show the same catalogue with execution blocked. PsInfo and some logon queries require permitted Remote Registry access; Atlas does not enable it implicitly. PsPing tests the path **from the Atlas host**, not the target's historical or outbound internet connectivity. PsPasswd passwords can appear in process arguments, and omitting its new-password argument applies a NULL password, so use your approved password-management workflow.

Sources: [Microsoft PsTools](https://learn.microsoft.com/en-us/sysinternals/downloads/pstools), [PsPasswd](https://learn.microsoft.com/en-us/sysinternals/downloads/pspasswd), [PsPing](https://learn.microsoft.com/en-us/sysinternals/downloads/psping), [PsInfo](https://learn.microsoft.com/en-us/sysinternals/downloads/psinfo). Other utility references are available from the Microsoft suite page.

### Active Directory lookup

Open **Workspace > Active Directory**, or search Ctrl+K for **AD**, **groups** or **OU**. Choose User or Computer, enter an exact account/machine name (users also support UPN and DOMAIN\account), optionally specify a domain/controller, then click **Look up AD**. **Use selected machine** copies the current target without querying. All queries are manual and read-only through the Windows account running local Admin. No passwords are collected and no AD objects are changed.

Results show OU/parent container, full distinguished and canonical names, SID, enabled status, creation/change dates, approximate replicated last-logon date and password timestamps. Users also show lockout, expiration, department, title and manager DN; computers show DNS hostname and OS details. Search groups by name, scope or DN. Membership is **direct groups plus primary group**, not nested/transitive membership or effective permissions. Up to 500 direct groups are displayed, with truncation and unresolved groups reported. Replicated logon timestamps are not precise recent activity records.

Install the RSAT **Active Directory PowerShell** module on the Atlas host using your approved software process. Domain connectivity and permission to read the objects are required. The optional server field selects a domain/controller. Failures report missing RSAT, lookup errors or the 35-second timeout. Atlas does not install RSAT or enable services automatically. Demo and hosted Preview show the page with lookups disabled; live AD results are not added to the hosted snapshot. Classic and Desktop share the feature.

Microsoft references: [Get-ADUser](https://learn.microsoft.com/en-us/powershell/module/activedirectory/get-aduser), [Get-ADComputer](https://learn.microsoft.com/en-us/powershell/module/activedirectory/get-adcomputer), [Get-ADGroup](https://learn.microsoft.com/en-us/powershell/module/activedirectory/get-adgroup).

### Compact interface and loading feedback

Classic and Desktop use tighter shared spacing: smaller desktop controls, 12px console panels, narrower sidebars and compact headers. Touchscreen controls keep larger targets. Knowledge Base navigation and tools have SVG icons, and the editor uses the available window height. Slow foreground requests show a small loading indicator after 180ms; it clears on success or error, including concurrent requests. Background watcher polls stay silent. Draw.io has its own loading indicator and timeout message. Indicators respect Animations Off, reduced motion and Citrix mode; they never show invented percentages.


### AD group inspection and comparison
Right-click a user or machine and choose **See groups** to query its exact account in local Admin. The AD screen supports user/computer comparisons, groups in both objects or only one, and case-insensitive name filters: contains, starts with, ends with, equals and excludes. **Export CSV** downloads the filtered rows, object identities and each object's membership type; spreadsheet formula-like values are escaped. Command palette: See user groups, See machine groups, Compare AD groups, Filter AD group names, Export AD groups to CSV.

Queries use the Windows account running Atlas and require RSAT/domain connectivity. Results cover direct membership plus primary group, not nested/effective permissions. Any lookup warnings or membership limits still apply to comparisons. Demo and Preview expose navigation but never run live AD queries.


Performance and machine views use dense layouts: compact process rows with inline PID/session, small metric charts, expandable logical-processor detail, and compact machine facts. Long process lists scroll inside the list with sticky column headings; full records remain available. Touch devices retain larger action targets.


### One Atlas, two layouts
Use **Ctrl+K > DESKTOP MODE (beta)** to switch between Classic Atlas and the dock/window layout. The command works in Map, Workspace and Knowledge Base, including Demo and Preview. The browser remembers the choice per origin. Save diagrams before switching layouts, since app windows reload.


Desktop layout: open Search Atlas (Ctrl+K), search DESKTOP MODE (beta), then run the command to switch between Classic and Desktop. The choice is remembered in this browser. Save unsaved diagrams before leaving Desktop.


### AD health and comparison

AD lookup shows compact read-only user/machine health, OU, machine password change, and replicated (approximate) last logon. User password expiry uses the directory-computed expiry attribute. Unknown values remain unknown.

Group lookup traverses parents of direct and primary groups, detects cycles, and labels discovered memberships Nested. Traversal is bounded to 1,000 visited groups and a 20-second work budget (the existing 35-second process timeout still applies). Failed resolution or limits produce partial-result warnings. This is scoped directory evidence, not a complete cross-domain authorization calculation or proof of effective access.

Compare users or computers to see both health cards and a property matrix with differences highlighted. Existing group filters and CSV export include nested memberships. Copy support summary (also in the palette) includes both objects, query times, returned properties, group memberships, differences and warnings. No AD changes or additional remote health scans are performed.

References: https://learn.microsoft.com/en-us/powershell/module/activedirectory/get-adgroup and https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-adts/f9e9b7e2-c7ac-4db6-ba38-71d9696981e9
