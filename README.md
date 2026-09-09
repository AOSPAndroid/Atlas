# Atlas 6.8

Office maps, people, machines and IT administration. This repository is now a normal project tree: Python source, browser assets, floor plans, templates, tests and the existing database. No TXT-to-Python extraction is needed. Previous transfer packages remain in Git history.

## Start on Windows

1. Clone this private repository or download and unzip it.
2. Install Python 3.12. `Python_Settings.bat` detects it through `py -3.12`. To select another installed interpreter, set `WMI_PYTHON` to its full executable path.
3. Run `Install_Dependencies.bat` once.
4. Run **`Start-Office-Atlas.bat`**. It starts both servers and opens two browser tabs.

| Interface | Address | Access |
| --- | --- | --- |
| Your admin tool | `http://127.0.0.1:8770` | Local computer only; existing editing and IT operations |
| Shared read-only viewer | `http://YOUR-IP:8771` | People on your reachable network; maps and directory lookup |

Use the host computer's Wi-Fi/Ethernet IPv4 address in place of `YOUR-IP`. The launcher prints candidate addresses and saves them in `data/share-addresses.txt`. Share the address belonging to the network your colleagues use. The viewer requires only a browser, not Python or Windows elevation on their computers.

**`Stop-Office-Atlas.bat` stops both servers.** Starting again reuses this folder's running servers. Occupied ports fail with an error rather than attaching to another installation. Closing a browser tab does not stop hosting.

To change ports, set `ATLAS_ADMIN_PORT` and `ATLAS_VIEWER_PORT` before launching; they must be different. Logs are in `logs/admin-startup.log` and `logs/viewer-startup.log`.

## One command palette across Atlas and the IT console

Press **Ctrl+K** (or **Cmd+K** on a Mac browser), or click **Search Atlas** in either header. Search people, machines, desk codes, teams and admin views in one place. Use arrow keys and Enter to open a result, and Escape to close.

Use `person:`, `machine:`, `desk:` or `>` to narrow results. People with a single mapped desk open on the map; multiple locations offer a choice. Unmapped people and machines open selected in the existing IT console. Name-only desk matches are identified as unconfirmed. Actions open the existing admin interface and keep its review/confirmation flow. Both admin views load the same component, isolated stylesheet and 26-command catalogue. Commands belonging to the other view navigate there; selected machines carry across where available. Deployment, file-access and remote-operation commands open their existing controls for review. The shared viewer does not expose this admin palette.

## Shared viewer

- Explore the same ten-floor 2D/3D map, search seating, inspect desk records, and export the displayed records.
- Use **User lookup** to search the Europe-wide directory by name, account, email, BRID or machine name. Open a person to see their linked machines and mapped desks.
- Both processes read the same runtime database (`data/office_atlas.db` by default). **Refresh records** reloads seating changes made in the admin interface; directory queries read the current database on each request.
- Read-only means no seating edits, imports, settings changes or deployment actions. Live remote health/software checks that use the host's privileges are unavailable. Stored inventory details remain visible.

The viewer is a separate FastAPI application with only explicitly registered read routes. It does not import or register the admin backend. SQLite is opened with `mode=ro` and `query_only`; mutation requests receive HTTP 403. Administrative GET endpoints, full-database downloads and server files are not served. The admin interface retains its loopback and same-origin checks. Browser controls are hidden for clarity; the server enforces the restrictions.

The host must remain awake and network-reachable. Windows Firewall or your organisation's firewall must allow inbound TCP on the viewer port (8771 by default). If colleagues cannot connect, check that rule and the selected network/IP; changing the admin bind address is unnecessary. The launcher does not change firewall policy. This is an unauthenticated internal viewer: anyone who can reach its port can read the displayed directory and maps.

## Configuration and updates

Set the package repository in the admin Settings dialog, or copy `config.example.json` to `config.json` and edit it. `WMI_PACKAGE_REPO` overrides that value. Local configuration, logs, process records and SQLite journal files are ignored by Git.

The database and floor plans were already part of this private repository's embedded package and are now ordinary files. Keep the repository private. The launcher copies the distributed `office_atlas.db` seed into ignored `data/office_atlas.db` once, preserving existing records with SQLite backup. Subsequent launches keep that runtime database. Stop both servers and back up `data/office_atlas.db` before updating; preserve the `data` directory and `config.json` when moving to a fresh checkout. Set `ATLAS_DB_PATH` to use another existing Atlas database. Direct backend development uses the runtime database if present, otherwise the root seed. Use the admin database manager for supported directory refreshes.

See [README.txt](README.txt) for the existing IT operations and import documentation.

## Development

```powershell
py -3.12 -m pip install -r requirements-dev.txt
npm ci
py -3.12 -X utf8 tests/run_all.py
py -3.12 launcher.py run --no-browser
py -3.12 launcher.py stop
```

`backend/main.py` hosts admin routes; `backend/viewer.py` hosts shared read routes; `directory_lookup.py` shares database-only lookup queries; `atlas/official-app.js` renders the common map; `atlas/viewer.js` provides read-only user and machine inspection.

The test runner uses disposable database copies, starts isolated UI fixtures on ports 8892/8893, and runs 71 Python tests plus eight Node DOM suites. Remote operations are simulated. `npm run format:check` verifies formatting of the maintained browser sources.

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

No frontend runtime library was added. Map camera animations are a separate next step; existing geometry caching is covered by a 60-frame regression check.
