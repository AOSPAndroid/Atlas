# Office Atlas + IT integration

The Atlas floor workspace is the main application. Its original WebGL renderer,
floor geometry, furniture orientations, source images and name visibility controls
are retained. The inspector now connects the selected desk to directory identities,
linked machines, package scripts and deployment outcomes. A separate full IT console
shares the same backend, database and Atlas colour/font treatment.

## Shared data model

`office_atlas.db` holds the directory tables (`users`, `user_aliases`, `machines`,
`assignments`), Atlas tables (`records`, `history`), deployment table (`deployments`),
explicit links (`desk_user_links`), link audit (`desk_link_history`), and immutable
submission context (`desk_deployments`). Metadata keys for Atlas initialization and
directory refresh are separated. Read connections close reliably; writes use SQLite
transactions and seating mutations retain optimistic revision checks.

The supplied initial Atlas has 524 locations: 243 assigned desks, 221 unconfirmed
desks, 17 vacant desks and 43 rooms/areas. The reviewed WMI directory has 18,739 users,
69,289 machines, 31,557 relationship rows and 22 original deployment history records.
The shared database preserves these inputs. No saved Atlas database was attached:
local edits from another installation require Import Atlas .db or `merge_data.py`.

Plan names are matched by case-normalized word sets (allowing given/family name order
changes and punctuation differences), requiring at least two tokens. The resulting
161 unique matches are labelled suggestions; 2 ambiguous names and 80 unmatched names
need manual selection. A confirmed link stores the user's canonical key rather than
an import-dependent numeric row ID. The UI lets operators verify the displayed name,
login, email and location before linking. No approximate/fuzzy ownership guesses are used.

Moves transfer confirmed occupant links, while equipment stays at the physical desk.
Vacating or changing an occupant clears their explicit link. Link changes are audited.
Directory refresh replaces only directory tables and preserves desk/history tables;
missing directory identities remain visibly unresolved instead of binding to another ID.

## Desk deployment

The operator selects a machine from the resolved user's links or the recorded desk
hostname. The backend validates that the submitted target belongs to that current
context, and that the desk revision and user key still match. It rejects unrelated
machines, invalid installer paths, mismatched action suffixes and stale revisions.
Before any worker starts, it commits a deployment history record and a desk/user/target
snapshot in one transaction. It then uses the existing reviewed WMI deployment worker.

Script preview reads the selected installer as text; it does not execute it. Package
and script selection is constrained to the configured repository. The repository can
be set through Settings or the existing environment override. Runtime jobs continue
when an inspector closes; the global history and full IT console retain access.

The main floor map and IT console use the Atlas palette: white surfaces, pale blue-grey
backgrounds, navy text, cyan-blue actions, and consistent borders and rounded controls.
The complete IT console retains directory search, queue/bulk, remote admin and inventory.

## Validation

- 22 backend regression tests pass, covering the original reviewed WMI behavior plus:
  all assigned desk context routes; unambiguous/ambiguous resolution; link/move/vacate
  persistence; revision conflicts; desk deployment target checks and audit snapshot;
  script preview; CSRF token enforcement; shared backup; directory refresh preservation;
  importing an existing Atlas backup and repeated-import detection.
- The full Atlas JavaScript is loaded into a jsdom DOM with real HTTP API calls against
  a temporary shared database. The test clicks a desk, selects a machine, loads an
  application/script, previews the script, submits a simulated deployment and reads its
  desk history. It verifies that switching desks clears the target and name tags toggle.
- The DOM test substitutes WebGL with the source-scan fallback and stubs remote execution.
  It does not validate GPU rendering, browser layout or Windows WMI behavior.
- Installer JavaScript state regression checks pass. All JS modules pass syntax checks.
- The final transfer is extracted in an isolated directory, its file hashes and SQLite
  integrity are verified, and repeat extraction preserves the existing installation.

## Limitations

The original transfer did not include installers or Python dependencies; neither does
this merged package. They must be available through the work environment. Windows batch
launchers, domain permissions, PowerShell/WMI and real installer scripts still require
an on-network test. Exit-code success is not independent product/version detection.
Browser visual verification was unavailable; the included DOM test verifies interactions,
not the final rendered pixels. Floor assets are unchanged from the supplied Atlas.

The local server does not provide multi-user authentication or persistent job resumption.
Do not stop it while monitoring deployments. Database backups cover both apps; exported
seating JSON only covers desk records. Imported Atlas backups update matching desk records
but do not delete unmatched current locations or import a separate WMI directory.

## Reproduce tests

```text
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node tests/installer_frontend_regression.cjs
```

For the DOM integration test, install jsdom separately, start
`python tests/serve_ui_fixture.py`, then run `node tests/atlas_dom.cjs` with
`JSDOM_MODULE` pointing to the jsdom module if it is not on Node's module path.
The fixture uses a temporary database and a simulated deployment worker.

## Release 4.1 corrections

- Replaced the default map view with Canvas 2D; WebGL initializes only on request.
- Reduced 3D workstation detail and removed facade posts. Kept source orientations.
- Reused keyed HTML/SVG nodes and suppressed unselected labels during movement.
- Corrected lookup eligibility: unconfirmed names can resolve directory evidence.
- Found an additional import error: Sabri's L3-093 is an area, not a desk. Display
  directory evidence and require explicit confirmation to convert it before deployment.
- Added local diagnostics and real Chromium coverage with a temporary test DB.
- Kept the original seeded DB unchanged; corrections also work with existing backups.

## Release 4.2 — operational evidence

Paris-only map audit; Europe-wide directory scope is retained. No requirement
for European directory users to appear on the Paris plan. Suggestions are read-only.
Machine evidence keeps assigned, historical last-logon and desk equipment links,
without presenting inventory timestamps as live presence.
Catalogue metadata is stored by repository and folder, with revision checks.
Metadata inspection reads filesystem attributes only and reports incomplete scans.
It is informational and does not gate the existing script picker/deployment path.
Backend installation, remote administration and queue functions and frontend
single/bulk/Atlas deployment handlers were compared to release 4.1 and preserved.
Friday directory refresh accepts a dated .xlsx path, validates required sheets,
shows count changes, requires APPLY, and backs up the entire database before merge.
Existing directory merge preserves all other tables, including package metadata.
