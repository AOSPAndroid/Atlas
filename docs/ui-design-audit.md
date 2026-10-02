# Atlas UI consistency audit — 30 September 2026

## Shared rules

`frontend/assets/design-system.css` is loaded last by Map, IT Console, Manage Database, Desktop and utility entry points. Existing compact overrides were moved out of atlas-shell.css into this shared layer.

- Body text: 13 px; controls/data: 12 px; supporting labels: 11 px.
- Page titles: 18 px; subsection headings: 14 px.
- Desktop controls: 28 px minimum; touch controls: 42 px minimum.
- Compact process actions: 22 px on pointer devices; 42 px on touch.
- Spacing scale: 4 / 6 / 8 / 12 px.
- Control corners: 7 px; panels: 9 px; dialogs: 12 px.
- Shared blue accent, text/muted colours, focus outline and disabled appearance.
- Alerts and destructive actions retain semantic colours. Data never depends on colour alone.
- Foreground network requests use the existing delayed loading indicator; polling stays silent. Motion settings and reduced-motion remain respected.

## Findings and repairs

| Surface | Drift found | Repair |
| --- | --- | --- |
| Workspace and machine cards | Shared density scattered across late shell overrides; search fixed at 52 px | Centralized density; search follows control height; compact machine facts retained |
| Remote Admin / CPU / GPU / memory | Legacy large charts and table spacing | Previous dense metrics and process rows retained in final design layer |
| Bulk Deploy and History | Page-local heading/control/table styles | Shared type, spacing, controls and table styles |
| PsTools | 38 px inputs overriding shared geometry | Explicit workbench control rules and consistent card gaps |
| Active Directory | Unstructured form wrapping | Responsive labelled form, compact groups and details table |
| Knowledge Base | Grid-stretched search field and separate toolbar geometry | Fixed token-based search height and shared toolbar/panel dimensions |
| Map / person / machine details | Different panel, health and menu spacing | Shared health, person, context-menu and dialog rules |
| Health and specifications | Forced 14 px padding; 24 px dialogs | Removed padding override; compact health cards and dialog contract |
| Catalogue | 24 px column gaps and large headings | 8 px gap, shared headings and controls |
| Command palette | Shadow-root styles isolated from normal CSS | Companion rules inherit common tokens; compact trigger and results |
| Manage Database | Inline 28 px page padding, large titles and review cards | Shared stylesheet loaded after inline rules; compact review layout |
| Desktop settings | 22 px padding and 15 px field gaps | Shared compact settings geometry |
| Calendar, Notes, Reminders, Calculator, Clock, Files, Music | Independent typography and large headers/cards | Shared utilities class, tokens and compact layout; dark-mode colours preserved |

## Verification

- Browser navigation through all seven console pages at actual 808 px and narrow 487 px widths: no horizontal document overflow.
- Browser computed controls: 28 px and 12 px text on operational pages; fixed legacy Workspace and KB searches found during inspection.
- Browser checked Map, Manage Database and all seven utility pages: shared stylesheet present, no horizontal overflow at checked widths.
- Visual screenshot review of PsTools confirmed compact navigation, controls and card layout.
- Functional suites: performance, process menus, deployment flow, Knowledge Base, desktop/window management, utilities, loading, AD groups and shared context actions.
- Native remote administration was not executed. Responsive checks do not certify every viewport or every possible data length.

## Intentional exceptions

Map labels and drawing surfaces retain their own geometry to avoid clipping or changing picking. Draw.io owns its embedded editor internals. Desktop dock/window chrome retains its desktop appearance. Calculator keys and calendar cells remain larger than ordinary controls. Long records wrap and long lists scroll rather than being truncated or hidden.


## Navigation and layout follow-up (2026-09-30)

- Removed the console-only divider and extra padding above the Preview notice. Map and console now use the same two-row header contract.
- Explicit grid placement prevents old mobile flex-order rules from relocating the app tabs. Equal tab font weight prevents small shifts when the active tab changes.
- Removed toolbar overflow clipping so the More menu can extend below the header.
- Desktop switching is only the shared `DESKTOP MODE (beta)` palette command, available in Admin, Demo and Preview. In an embedded app it requests Classic mode through the origin-checked desktop bridge; at top level it opens Desktop mode.
- Reviewed all seven console pages in the browser: shared 48px local header, no horizontal document overflow at the tested desktop width. Knowledge Base intentionally expands the editor and hides the operations sidebar; app navigation stays visible.
- Map, console and utility visual density continues to use the shared design contract. Long data lists remain scrollable; no data was hidden to force it onto one screen.

- Narrow 600px check exposed a Map-only content-box height on More (38px versus 28px). Applied border-box sizing to the shared control; mobile app links keep the same row and column positions.


## Reachable actions — 2026-10-01
- Shared floating Actions panel indexes visible controls on the current page only when opened. Search by control or section; fields receive focus and buttons use the original handler. Disabled and stale targets are rechecked at activation. Escape/outside click closes it.
- Performance view/scan/PID controls and bulk rollout actions remain sticky beside long results. Short windows use the floating panel instead of a tall sticky performance block. Result tables scroll within bounded areas.
- Native Draw.io iframe controls remain owned by the editor. Closed disclosures are reached through their summary, then indexed after opening.
- Verified action search, field focus, original handlers, disabled/hidden and stale targets, Escape, and process termination confirmation tests. Demo browser inspection confirms live actions stay disabled.

Actions panel correction: non-shrinking rows, capped 520px panel, one section heading per group and cleaned labels excluding select options. Verified no overlapping rows at default viewport and 600x650; panel stays within viewport. Existing action/field, disabled-state and Escape tests pass.

## Remote Admin consistency — 2026-10-02

- Labelled target toolbar and consistent Overview/CPU/GPU/Memory controls, with explicit scan-state labels. Slowness capture is disabled until a target is entered.
- Separate process heading, visible row count and labelled filter. Direct PID/name termination is an expandable control before the scrollable table; confirmation and target checks are preserved.
- Investigation cues and GPU engine details expand on demand, matching the existing processor/disk disclosures. Remote Admin component spacing and responsive rules live in the final shared design layer.
- Browser checks used fictional performance responses against running Admin and Demo services at 390, 487, 600, 768, 1000 and 1366 px widths. Classic and Desktop frames, manual-only scans, cached views, filters/counts and termination confirmations passed. The prepared hosted preview was checked locally with its read-only adapter; no performance values were added to it. Native Windows actions were not executed.
- Performance, process-action, slowness-capture, reachable-action, console, desktop and header-navigation suites passed. Backend checks confirmed the full Demo console is served while privileged reads and all writes are blocked. Two broader viewer DOM tests also fail on the unchanged repository baseline: an old PsExec template count (39 versus 72) and an old PsExec navigation label.
- The hosted update preserves all 358 directory/snapshot files. Publication is pending resolution of the existing Sites public audience, which conflicts with this repository's owner-private preview requirement.

### Quick process termination

- Added visible **Kill OpenFin…** and **Kill matching processes…** controls; the editable name fragment defaults to `a180`. Both bind to the displayed target, cover all sessions, require confirmation and stay disabled in Demo/Preview.
- Contains matching queries the full live process list, uses a literal case-insensitive name substring and ignores command-line arguments. Every candidate's PID, name and creation time is checked again before termination; protected, changed and disappeared processes are skipped and partial failures remain visible.
- Six Python process tests passed, including both PowerShell provider fixtures with simulated WMI/Terminate methods. API-route and Demo write-blocking checks, quick-action DOM checks, existing process/performance suites and Classic/Desktop browser checks passed. No live process was terminated.

### Service inventory and stopping

- Added **List services** beside Installed software, opening a compact searchable table with display/service names, state, startup mode, PID and confirmed **Stop…** controls. Refresh is explicit; entering or selecting a target does not query Windows. The same dialog and shared design tokens are used in Classic/Desktop; Demo/Preview block inventory and stop execution.
- Stop requests bind to the confirmed machine, exact service name and a configuration fingerprint. The server rechecks identity, protects core Windows/remote administration services, uses Windows service control, preserves startup settings and never stops dependencies or kills a shared host process. `Stopped` must be verified; pending, blocked, changed, missing and failed outcomes remain explicit with no automatic retry.
- Six service Python tests passed, including the simulated PowerShell provider fixture. Service API validation, cross-origin rejection, existing RemoteRegistry tests and Demo write blocking passed. DOM checks covered search, safe metadata rendering, confirmation, duplicate prevention, stale responses, target changes, pending/errors and read-only guards. Existing console/process/performance/action suites also passed.
- Browser checks used 201 fictional services at 390, 768 and 1366 px, confirming native modal/Escape behavior, search, exact stop payloads, responsive scrolling, Classic/Desktop and Demo/Preview restrictions. The broader Remote Admin browser checks also passed. No live Windows service was queried or stopped.
- Restarted Admin and Demo after adding routes, verified their served assets against the prepared Preview and preserved the original database and all 358 preview snapshot files. Saved Preview version **94**, source `fb5f81b4d48d324576f25299b83aedf73e5e6204`, with a verified 3,674-file static archive. It is not deployed; live Preview remains out of date pending the owner-only access decision described above.


## Controls at the edges — 2026-10-02

- Added one shared control manager to Map, the console, Database Manager, Desktop and utilities. Original controls and their handlers move into overlays; default content fills the reclaimed space. Map labels, Draw.io internals, native dialogs and Desktop drag/resize handlers retain their geometry and behavior.
- Labelled handles reveal after 140ms of proximity; panels fold after 700ms away. Typing, keyboard focus, open menus, pinning and active dragging prevent accidental folding. Clicking a handle always opens it. Escape/Close fold unpinned panels. Layout offers a saved Always show controls preference shared by same-origin frames. Touch handles, row actions and reduced-motion/Citrix settings remain usable.
- Remote Admin retains target and scan state above its information, plus termination outcomes outside the controls. AD result filters and browser inputs move off the result list; replacing results also removes their old controls. Workspace target status, Knowledge Base title and the calendar month stay visible. Actions search and existing shortcuts reveal the original control before focusing it.
- Browser checks covered all seven console pages, seven utilities, Map, Database Manager, Classic/Desktop and Demo at 390, 768 and 1366px. At 1366px, Map canvas width increased from 770 to 1366px. Revealing controls left content bounds unchanged. All remote test responses were fictional; no live Windows action was executed.
- Dedicated control-manager regression checks cover identity, delay, focus/pin/Escape, dialogs, drag guards, preference changes, active-page scoping and dynamic cleanup. Existing process/service/performance, AD, Knowledge Base, utilities, reachable-action and deployment checks passed.
- The hosted preview is prepared with the same assets and its original read-only snapshot. Live publication remains blocked by its public audience, which conflicts with the owner-private requirement above.


## Direct hostname targets — 2026-10-02

- An empty Workspace lookup now offers **Use hostname as target** for a literal hostname or `machine:HOSTNAME`, using the backend's name rules. The entered hostname is selected only on that action; normal deployment tools open without requiring a directory record. No inventory record is added and no package is launched by selection.
- The offer reports that the hostname is absent from the directory. Editing the query, starting another lookup or receiving an old response cannot select an old hostname. Known inventory/user lookups retain their existing path; Demo/Preview can select a hostname but cannot deploy.
- Regression checks use simulated responses and verify the deployment payload, canonical hostname/FQDN, invalid input, stale queries/selection handlers and read-only enforcement. Existing deployment and edge-control checks pass.
- Browser checks passed in Classic, Desktop, Demo and the prepared Preview at 390 and 1366 px. A simulated Admin API job completed with the exact entered hostname and selected script; read-only deployment controls stayed disabled. Served Admin/Demo/Preview assets match, and the original database plus all 358 preview JSON assets are unchanged. No live Windows action was executed.


## UI overhead cleanup — 2026-10-02

- Shared edge proximity uses the control manager’s current visibility and measures only handles beside the pointer’s edge. Its existing delay, cancellation, keyboard/touch, focus, pin and drag guards remain covered by regression checks. In Chromium, 500 mouse moves over the centre of Workspace caused 11,000 style reads and 2,000 handle bounds reads before cleanup; both are now zero in Admin and Demo. Map dropped from 5,000 style and 2,500 bounds reads to zero for the same movement. These are measured API-call counts, not an end-to-end latency claim.
- Workspace starts with one catalogue and one script request instead of two of each. Bulk/rollout packages load on first opening, keep their own filtered selection, reject duplicate loads, and retry after a failed first lookup. Package filters and script checks continue to fetch current results.
- Repeating an unchanged deployment summary/favourite refresh now makes no DOM writes. Changes to the target, action, loading and submission state still update labels, availability and accessible state immediately. Removed the unused software health slot, unused map display query and identity-only package-folder compatibility wrapper.
- Dedicated efficiency checks cover startup requests, first-use loading, duplicate prevention, failed-lookup retry, independent package selection and unchanged/changed summaries. Existing deployment, direct-hostname, console, reachable-action and geometry-cache checks pass. Updated the map-motion test’s old Demo context-menu expectation after confirming it also failed on the previous commit: Demo’s current stored-directory “See groups” action is available, with no desk editing actions.
- The bundled Draw.io editor loads on opening Knowledge Base; floor plans, seed data and migration sources still support active features. They are retained. Shared preview assets are synced without changing any of its 358 JSON snapshot files or its custom SVG background choice. Live preview remains out of date pending the public/owner-private access decision.
- Browser checks passed all seven console pages in Admin/Demo/prepared Preview, Map in all three modes, Desktop Workspace, all seven utilities, Database Manager and mobile Workspace/Bulk Deploy at 390 px. Real mouse proximity reveals and Close actions worked; rollout first-use/reopen request counts matched, read-only controls stayed disabled, and no live Windows action was executed. Served scripts match across modes with the existing Preview-only SVG source preserved.
