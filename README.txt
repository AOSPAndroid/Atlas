OFFICE ATLAS 6.7 - shared read-only viewer
See README.md for dual-server startup and network access.

OFFICE ATLAS 6.6 - detailed maps
See CHANGELOG-6.6.txt for map changes and upgrade instructions.

OFFICE ATLAS 6.5 - conservative optimization
See CHANGELOG-6.5.txt for changes, validation and upgrade instructions.

VERSION 6.4: progressive machine health, specifications, relationship badges and script-name fix.
See CHANGELOG-6.4.txt for upgrade instructions and limitations.

V6.3 — SOFTWARE RIGHT-CLICK ACTIONS
Open Installed software from Remote Admin or the existing machine menu.
Right-click an application, use the keyboard context-menu key, or click Actions.
- Uninstall: MSI ProductCode, registered EXE silent command, or an explicitly
  entered vendor-documented silent argument string for a registered executable.
- Repair: MSI /fomus, or documented silent arguments for an EXE ModifyPath.
  Appx reset is not offered as repair.
- Clean cache: currently unavailable until application-specific disposable
  folders are defined. Windows Installer cache files are never deleted.

Review the exact application, version, target, scope and command. Type the target
hostname to execute. Plans expire after 15 minutes; refreshing inventory invalidates
old plans for that target. Registration is rechecked remotely before execution.
A target lock prevents overlap with this console's deployment/uninstall workers.
Jobs and exit-code outcomes appear in the existing deployment history and monitor.
A successful process launch is never reported as successful uninstallation.
After completion, refresh installed software. The selected registry/package
registration is checked; this does not independently verify application health.

Inventory covers both machine registry views and classic per-user entries for
LOADED profiles. Other users' classic apps are shown but require their owner's
execution context. No impersonation or automatic user-hive loading is attempted.
Optional MSIX / Store discovery offers per-user removal using the exact installed
package and displayed SID; provisioned packages are not removed. Non-removable
registrations and unsupported command types explain why an action is unavailable.
Package-script deployment remains available for app-specific procedures.

Optional Read MSI cache names reads .msi metadata in the Windows Installer cache,
including Subject, ProductName, version and ProductCode. It is limited to 1,500
files / 90 seconds and reports incomplete results. Cache-only files are information,
not uninstall targets. LocalPackage mappings identify the registered product cache.
No Win32_Product query is used, so discovery does not invoke that provider's repair
consistency checks.

Remote scans and actions use WMI process creation plus the admin share. Windows
PowerShell and script execution must be allowed on the target. The target Windows
directory is obtained through WMI; operation files/logs are written below its Temp
folder in a unique AtlasSoftware folder. EXE silent/restart behaviour is vendor
specific; no generic switches are guessed. MSI actions use /qn /norestart and a
verbose log. Appx removal is for the selected user registration, not all users.
Closing the dialog does not stop an action. Monitoring failures or missing results
are not success. Unresolved outcomes block additional actions through this feature
on that host for the session; inspect the recorded remote PID/folder and resolve
its state before restarting the console. Remote processes may outlive the console.

Validation: Python plan/capability tests, target binding and exact confirmation,
replay/stale-plan guards, lock handling, transport mocks, verdict checks and UI
right-click/repair/uninstall/cleanup-disabled tests. No remote Windows, PowerShell
execution or actual uninstall/repair has been exercised in this environment.
Pilot on a designated test machine before trade-floor use.

Microsoft references:
https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/msiexec
https://learn.microsoft.com/en-us/windows/win32/msi/subject-summary
https://learn.microsoft.com/en-us/troubleshoot/windows-server/admin-development/windows-installer-reconfigured-all-applications
https://learn.microsoft.com/en-us/powershell/module/appx/remove-appxpackage

V6.2 — BUILT-IN EXCEL TEMPLATES
Open Manage Database > Download Excel templates.
- Official desk template: blank Users and desks input, Desk reference, Instructions.
- Previous seating template: same format with previous-layout desk references.
- Directory template: blank Users and computers worksheets plus Instructions.

Download, fill the entry worksheet(s), save as .xlsx, upload into the matching
section, review the detected changes and confirm to save them in office_atlas.db.
The desk templates include a Status dropdown. Identifier columns are text-formatted.
Desk reference lists match the bundled release; use the current-data export when
working with desks added later. Blank rows contain no sample people or machines.

The directory template is a COMPLETE snapshot replacement, not an add-only list.
Include the complete Europe directory and computers you want retained. Keep your
normal richer export when additional fields must remain populated. Import the
directory before a seating sheet that refers to newly added Account identifiers.
An untouched blank template is rejected without changing live data.
Verified: template downloads, filled seating imports, directory user/computer
relationship creation, leading-zero BRIDs, blank rejection and seating regressions.

V6.1 — USERS AND DESKS FROM EXCEL
Manage Database > Users and desks · Excel sync.
1. Download current users and desks for the official layout (or previous seating).
2. Maintain Desk ID, Name, Team, Account and Status in Excel, one row per desk.
   Account accepts an existing directory login, email or BRID; use it to retain
   identity across name changes. Names without accounts are allowed but remain
   unconfirmed for directory lookup. This sheet does not create Windows accounts
   or replace the Europe users/computers inventory.
3. Upload the latest .xlsx and click Detect changes. Compatible sheets need
   Desk ID and Name headers; Team, Account and Status are optional. Name the
   worksheet Users and desks or Seating, or use a single-sheet workbook.
4. Review before/after assignments, moves, name/team/account/status changes,
   vacancies and conflicts. All changes remain staged until you type APPLY.
5. Applying creates a full database backup, saves per-desk history and records
   the import. Reload open Atlas tabs. Re-uploading the same data is a no-op.

A recognised move automatically vacates its previous desk if that desk has no
replacement row. Swaps work in one import. To explicitly vacate a desk, clear
Name and Account and set Status to vacant. Use assigned for an occupied desk;
unconfirmed is also supported. With Status omitted, a nonempty Name or Account
means assigned; both blank means vacant.

Omitted desks are unchanged by default, except sources of recognised moves.
For a COMPLETE selected-layout snapshot, enable the labelled checkbox: omitted
desks become vacant. This applies to the entire official or previous layout,
not merely the floors listed. Missing users are removed from seating only;
their Europe directory accounts, machines and history are preserved.

Unknown desk codes, unknown/ambiguous supplied accounts, duplicate desks,
new duplicate occupant assignments and formula/error cells block the import.
An unchanged historic duplicate is shown as a warning. Namesakes need distinct
Accounts. Stable Account values are necessary to distinguish a rename from a
replacement reliably. Excel is authoritative for the seating fields supplied;
manual Atlas edits made before a new preview appear as differences. Edits made
after a preview invalidate it. Previews expire after one hour or replacement.
Physical desk geometry, equipment and notes remain at each desk. Changed
records lose physical verification. New physical desks need to exist on the
map first. The existing directory import and explicit desk-move workflow remain.

Validated on isolated databases: real XLSX parsing/export, swaps, inferred moves,
partial/full imports, new occupants, conflicts, replay, stale preview rejection,
backup contents, rollback, token/job guards and import history. Both supplied
layouts export and re-import with zero changes. UI state tests cover export,
preview, confirmation, option invalidation, apply, history and replay.
No full browser visual test or live Windows/WMI execution was performed.

V6.0 — TWO OFFICIAL MAP VIEWS
Simple map opens by default. Optional 3D uses simplified official PDF furniture and walls. Both views use the same official desk IDs, names, account links and selection. Previous seating is retained as history, not as a separate map.

V5.2 — STUDIO MAP
Styled, label-free official vector plans with raised desks and a muted architectural palette. Canvas 2D keeps navigation fast. Desk codes appear on hover and in selected labels/inspector. Original plans remain available through Source plan and Original PDF. No deployment or queue execution changes.

V5.1 — VISUAL SEATING MATCHES
300 previous location labels are now positioned at official desk codes. See VISUAL_SEATING_AUDIT.md. Matches carry corrected names and existing account links; current occupancy remains unverified.

OFFICE ATLAS + IT — MERGED EDITION

START
1. Clone or download the normal project tree from GitHub.
2. Install Python 3.12. Python_Settings.bat detects it, or set WMI_PYTHON.
3. Run Install_Dependencies.bat if dependencies are missing.
4. Run Start-Office-Atlas.bat to start both servers.
5. Admin: http://127.0.0.1:8770. Shared viewer: http://YOUR-IP:8771.
   The launcher opens both local tabs and writes data/share-addresses.txt.
6. Open Settings and save the folder containing the application package subfolders.
   This build defaults to the repository shown in your screenshot:
   C:\Users\x01426046\OneDrive - Barclays Bank PLC\Shortcuts\EPP_PACKAGE_REPO_BetaPackages - BetaPackages
   This may differ from the profile running Python (for example x01426046_dsk).
   The folder contains package subfolders, with *_i.ps1 / *_i.vbs installation,
   *_u.ps1 / *_u.vbs uninstallation, and *_r.ps1 / *_r.vbs repair scripts.
   For offline use, mark required package folders Always keep on this device in
   OneDrive and let synchronization finish. Installers remain in your repository.
   WMI_PACKAGE_REPO can override the setting; Python can be set with WMI_PYTHON.

DESK TO DEPLOYMENT
Select a desk on the map or in the office directory.
The right inspector shows its user and machines from the shared database.
A unique plan-name match is shown with a verification label. Confirm it by expanding
Change / confirm directory link and choosing the user. Ambiguous/unmatched desks
need a directory search and explicit user selection. Linking updates the desk's
occupant name/team and is recorded in history.
Choose ONE machine, choose the application, action and installation script.
View script displays the actual .ps1 or .vbs text from the configured repository.
Choose Copy + execute, Copy only, or Execute existing. Confirm the named target.
Live events and installer exit-code results appear below the deployment controls.
Desk deployment history and the header's Deployments list use the same database.
The IT console link provides directory search, bulk deployments, queues, remote
administration and software inventory in the Atlas colour scheme.

SEATING
The supplied floor geometry, desk orientations, floor images, source scans and
name-tag switch are retained. Unnamed desks do not get name labels.
Right-click remains available for edit, move, vacate, rotation and history.
Desk record & seating changes contains the existing editable record form.
Confirmed directory links follow an occupant move. Equipment/hostname remains
at each physical desk. Vacating clears its confirmed occupant link.

ONE DATABASE
All live data is in office_atlas.db:
- users, aliases, machines and user-machine assignments;
- desk records and seating history;
- confirmed desk-user links and link audit;
- deployment history and deployment-to-desk snapshots.
There are no separate runtime atlas.db, wmi_packager_master.db or operations.db.
The initial package contains 524 locations, 18,739 directory users, 69,289 machines,
31,557 user-machine relationship rows and 22 supplied deployment history records.
Among 243 assigned desks, 161 plan names have one exact normalized-name match,
2 are ambiguous, and 80 are unmatched. These are suggestions, not live verification.
No uncertain name match is silently bound to a directory user.

EXISTING ATLAS EDITS
The supplied Atlas transfer contained seed records, NOT an existing atlas.db.
If you already edited desks on another PC, use that Atlas app's database backup,
then click Import Atlas .db in this merged app. Review the import confirmation.
Matching seating records are replaced by the backup; directory users, machines
and deployment history stay intact. Imported seating history is retained.
Importing the same backup again is ignored. Back up the merged database first.
The import accepts an Atlas database backup, not unrelated SQLite databases.

BACKUP / REFRESH / TRANSFER
Back up .db downloads a consistent snapshot of the ENTIRE shared database.
The record JSON export/import is for desk records only, not the complete app state.
Stop active deployment work before closing the server or refreshing the directory.
Refresh-Directory.bat rebuilds the workbook directory and updates only directory
tables. It preserves desks, confirmed links (by canonical user key), and histories.
If a user disappears from the new directory, its old link is shown as unavailable.
Use normal Git source updates. Back up your database before upgrading; stop both
servers and keep your database and local config.json. No embedded package is needed.

REQUIREMENTS / LIMITS
Application: Windows, Python 3.12+, dependencies in requirements.txt, browser with
WebGL for 3D (source scan and directory fallback remain available without WebGL).
Python dependencies and external application installers are NOT embedded.
Remote operations require your Windows account's existing WMI and admin-share rights.
Keep the server on loopback; this is a local operator console, not a shared public service.
Source-based seating and ownership are snapshots, not live presence or identity proof.
An installer exit code is not independent installed-product/version verification.
If monitoring times out, the remote process may still run. Inspect before retrying.
Closing a desk inspector does not cancel its deployment. Stopping the Python server
stops monitoring; remote installers may continue. Queues/active jobs do not resume.
Live Windows/WMI/Robocopy execution has not been tested here.

Read MERGE_REVIEW.md for the integration design, tests and limitations.

UPDATING AN EXISTING MERGED INSTALLATION
Before updating, wait for all deployment jobs to finish and use Back up .db.
Stop the old app with Stop-Office-Atlas.bat. Extract this release into a NEW folder.
Replace the new folder's seeded office_atlas.db with your downloaded backup,
renaming the backup office_atlas.db. Keep the original folder intact.
Copy your existing Python_Settings.bat into the new folder if customized.
Start the new folder and verify Settings shows your accessible repository.
Do not use Import Atlas for a full merged-app upgrade: it imports seating only.

ATLAS 4.1 — FAST MAP AND SIMPLE 3D
Fast map is the default. It uses Canvas 2D with cached floor backgrounds and
oriented desk markers; WebGL is not initialized unless Simple 3D is opened.
Simple 3D uses the existing WebGL renderer, simplified to three boxes per desk
(desktop, display bank and seat), with cached geometry and reduced rendering
resolution. Three.js is not required or bundled in this release.
Both modes support selection, right-click editing, moves, rotation and deployment.
Camera focus is immediate, without the old animated flight.
During pan/zoom only the selected user's name and connector remain visible.
Other names return 160 ms after movement stops and pointers are released.
The existing name-tag switch still hides all names when explicitly turned off.
Label and connector elements are reused; the complete overlay is not rebuilt.
Unnamed and vacant desks do not get person labels. Background cache is limited
to two floors. Rendering is on demand, with no continuous idle animation loop.
Performance shows local drawing/label time, movement frame intervals and buffer
size. It does not measure remote-display latency or guarantee a Windows FPS.

DIRECTORY LOOKUP CORRECTION
Named unconfirmed locations now resolve directory candidates without pretending
that their seating has been verified. Vacant desks exclude former occupants.
Sabri El Jailani's supplied location L3-093 is both unconfirmed and typed as AREA.
Its directory match now shows all eight linked machines, the same as the console.
For a person imported as an area, choose Confirm as desk & link user before
running a deployment. This explicitly records the classification correction and
stable directory link, preserves equipment, and leaves on-site verification off.
Real rooms without directory candidates remain room/area records. Ambiguous
names require explicit user selection. No blanket database reclassification runs.

VERIFICATION
Backend regressions cover Sabri/console parity, unconfirmed ambiguous names,
vacant records, links, moves, revisions, deployment guards and database backups.
Real Chromium checks cover Fast map without WebGL initialization, Simple 3D,
selected-label reuse during movement, name toggling, floor selection, resize,
no-WebGL fallback and Sabri's explicit area-to-desk confirmation on a test DB.
Browser tests use a local mocked deployment fixture; no work machines are used.
Actual responsiveness on your Windows or Citrix session still needs comparison.

IT CONSOLE REDESIGN
The console now uses one Atlas stylesheet instead of layered legacy themes.
A labelled sidebar provides Workspace, Remote Admin, Bulk Deploy and History.
On wide screens directory/machine results and deployment controls sit side by
side. Smaller windows stack these panels. Queue, live deployment and software
inventory drawers, keyboard shortcuts and context menus remain available.
UI checks exercise real DOM navigation, directory lookup and drawer controls;
visual appearance still needs confirmation in your Windows browser.

RELEASE 4.2 — PARIS MAP / EUROPE DIRECTORY
The six mapped floors belong to Paris. The Users and computers extract covers
Europe; directory refreshes must retain that complete scope. Users outside the
Paris map are not missing-seat errors. Additional offices require their own map,
site identifier and scoped desk IDs before being added; they are not enabled yet.

Review mappings flags possible person/area errors, unmatched/ambiguous names,
unconfirmed directory links, missing linked accounts, possible duplicate seating
and duplicate recorded hostnames. It does not modify records. Open each location,
verify the evidence and explicitly confirm a link or edit/move/vacate the desk.
Possible duplicates may be legitimate; they are not automatically merged.

Machine cards distinguish equipment recorded at the desk, machines assigned to
the user and inventory last-logon relationships. Machines with overlapping links
appear once, retaining their relationship evidence. Dates are inventory source
timestamps, not live presence or a guarantee that a machine remains in service.

Package catalogue lists repository folders with optional saved application names
and versions. Missing versions are not guessed. Inspect a selected package for
install/uninstall/repair scripts and Windows offline/recall attribute evidence.
Inspection is bounded and reports incomplete scans. It does not hydrate packages,
check external script dependencies or guarantee offline installation success.
Catalogue edits are scoped to repository and folder, stored in office_atlas.db,
and protected against stale saves. Package folders and scripts remain unchanged.
The desk inspector and console display the deployment selection for review.
Installation, remote administration and queue execution code is unchanged.

FRIDAY DIRECTORY UPDATE
1. Export the COMPLETE Europe dataset in the existing .xlsx format, retaining
   worksheet names Users and computers and their existing column headers.
2. Finish active deployments and queues first.
3. Drag the new .xlsx onto Refresh-Directory.bat. Alternatively replace the bundled
   database040926.xlsx with the new extract under that exact name and double-click
   Refresh-Directory.bat. Python_Settings.bat must point to your installed Python.
4. Review the old/new user, machine and relationship counts. Unexpected large drops
   usually indicate an incomplete or filtered export; cancel and investigate.
5. Type APPLY only for the intended full extract. A complete shared-DB backup is
   created in backups before the directory replacement transaction.
6. Start-Office-Atlas.bat and open Review mappings. A missing account is flagged;
   the refresh does not silently vacate its Paris desk or erase its history.
Refresh preserves Paris records/equipment, confirmed canonical account links,
seating history, deployment history and catalogue metadata. Keep backup files for
recovery. The hosted preview is a separate snapshot and does not refresh itself.
For validation only: python refresh_directory.py --source "Europe-Friday.xlsx" --check-only

RELEASE 4.3 — IT CONSOLE POLISH
Unified system sans-serif typography, clearer controls and active navigation.
Click-based target menus with outside-click / Escape dismissal.
One side panel at a time, labelled close buttons, focus restoration, and closed panels excluded from keyboard focus.
Removed legacy pointer ripple effects; notifications stack without overlap.
Installation, remote administration and queue execution code unchanged.

RELEASE 4.4 — COMMAND SEARCH
Ctrl+K (or Cmd+K) opens searchable commands. Use arrows and Enter.
Commands and Shortcuts buttons support mouse/touch access.
Alt+1..4 navigate; / focuses search; ? shows shortcuts; Escape closes panels.
Existing deployment and remote-action shortcuts remain available in the Windows app.
Hosted preview disables Windows-only actions, including shortcut entry points.

MATCH A FLOOR NAME TO THE DIRECTORY
Select a desk > Match to directory > search by name, login or email.
Check the account, team and office, then choose Use this name and account.
Confirm the old/new label. The desk name and stable directory link are saved
with history; machine lookup follows that account. This does not rename the
source directory user or verify physical seating. Hosted preview is read-only.

RELEASE 4.5 — MANAGE DATABASE
Open Manage Database from Atlas or IT Console. Upload the complete Europe
.xlsx extract (Users / computers, case-insensitive sheet names), validate,
review changes and removals, confirm the full snapshot and type APPLY.
Duplicate account identities / machine names and empty sheets are rejected.
Validation and imports are blocked while deployments or queues are active.
Imports create full backups under backups/ and record GUI import history.
Restore directory stages the directory from a recorded pre-import backup;
it preserves current seating, links, labels and deployment history.
Refresh-Directory.bat remains the standalone recovery/import path.
Keep only one app instance using this DB; do not run CLI refresh concurrently.
The hosted preview remains read-only and does not have this new manager.

BULK DESK MOVES
Manage Database > Desk moves > Export current desks (.xlsx).
Fill only Move to desk for each occupant moving; use an existing Desk ID.
Keep all rows, identifiers and revisions. For swaps fill both source rows.
Upload under Desk moves (not the Europe directory import), review and type MOVE.
Occupied destinations must move out in the same batch. Otherwise vacate them
in Atlas first. Stale exports, duplicate destinations and areas are rejected.
Coordinates, desk equipment and desk notes stay in place. Occupant, team,
occupancy and existing confirmed account link move; verification resets.
The batch is atomic and creates a full DB backup with per-desk audit history.
Export again after applying or after other desk edits.

RELEASE 5.0 — OFFICIAL 52 HOCHE PLANS
The home page now opens the official plans. All 10 supplied PDFs (B1,00–08)
and rendered plan images are embedded. 620 unique desk codes were extracted
from selectable PDF text: 00:10, 02:90, 03:120, 04:119, 05:112, 06:94, 07:75.
Floors B1,01,08 remain viewable with their room detail; no matching desk codes
were present. Original PDF opens the complete authoritative drawing.
The fast 2D map uses the actual plan artwork, including desk orientation.
Markers locate code labels, not measured desk centers. No invented 3D model
is presented as the official geometry.
IMPORTANT: PDFs contain desk codes but no occupant names. No automatic spatial
assignment was made. The previous 524-location seating register, corrections,
account links and all history remain in the same DB, under Previous seating.
Select an official desk > Carry over previous seating > choose the recorded
person from that floor > confirm. This copies occupant/team/account link only,
records the cross-reference and keeps the previous record/history. Desk
hostnames, ports and other equipment need review before carrying them across.
Alternatively use Match to directory to assign the official desk directly.
Official records persist in official_records, independently of previous records.
Manage Database offers separate official / previous desk-move exports.
Bulk moves work within either layout; cross-layout mapping uses the explicit
Carry over workflow. The Europe directory and WMI execution are unchanged.
Import previous seating .db imports only the previous register. To restore the
whole app including official seating, stop it and replace office_atlas.db with
a full backup. Upgrades retain existing DB; official records initialize once
on startup without replacing previous seating or existing official edits.
Hosted preview has not been changed by this release.
