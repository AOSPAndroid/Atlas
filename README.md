# Atlas 6.7

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

## Shared viewer

- Explore the same ten-floor 2D/3D map, search seating, inspect desk records, and export the displayed records.
- Use **User lookup** to search the Europe-wide directory by name, account, email, BRID or machine name. Open a person to see their linked machines and mapped desks.
- Both processes read the same `office_atlas.db`. **Refresh records** reloads seating changes made in the admin interface; directory queries read the current database on each request.
- Read-only means no seating edits, imports, settings changes or deployment actions. Live remote health/software checks that use the host's privileges are unavailable. Stored inventory details remain visible.

The viewer is a separate FastAPI application with only explicitly registered read routes. It does not import or register the admin backend. SQLite is opened with `mode=ro` and `query_only`; mutation requests receive HTTP 403. Administrative GET endpoints, full-database downloads and server files are not served. The admin interface retains its loopback and same-origin checks. Browser controls are hidden for clarity; the server enforces the restrictions.

The host must remain awake and network-reachable. Windows Firewall or your organisation's firewall must allow inbound TCP on the viewer port (8771 by default). If colleagues cannot connect, check that rule and the selected network/IP; changing the admin bind address is unnecessary. The launcher does not change firewall policy. This is an unauthenticated internal viewer: anyone who can reach its port can read the displayed directory and maps.

## Configuration and updates

Set the package repository in the admin Settings dialog, or copy `config.example.json` to `config.json` and edit it. `WMI_PACKAGE_REPO` overrides that value. Local configuration, logs, process records and SQLite journal files are ignored by Git.

The database and floor plans were already part of this private repository's embedded package and are now ordinary files. Keep the repository private. Stop both servers and back up `office_atlas.db` before updating; preserve your working database and `config.json` when moving to a fresh checkout. Use the admin database manager for supported directory refreshes.

See [README.txt](README.txt) for the existing IT operations and import documentation.

## Development

```powershell
py -3.12 -m pip install -r requirements-dev.txt
py -3.12 -m unittest discover -s tests -v
py -3.12 launcher.py run --no-browser
py -3.12 launcher.py stop
```

`backend/main.py` hosts admin routes; `backend/viewer.py` hosts shared read routes; `directory_lookup.py` shares database-only lookup queries; `atlas/official-app.js` renders the common map; `atlas/viewer.js` provides read-only user and machine inspection.
