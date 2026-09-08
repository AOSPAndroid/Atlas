# Office Atlas + IT

## Download one file

Download [Office-Atlas-IT-Software-Actions.txt](Office-Atlas-IT-Software-Actions.txt) using GitHub's raw-file download control. The complete file is **40,598,629 bytes**; no joining is required.

Enable filename extensions in Windows Explorer, rename the file to `Office-Atlas-IT-Software-Actions.py`, and run it with Python 3.12. Follow the extracted README and Python_Settings instructions to install dependencies and start the application. The extractor verifies the embedded files; it does not launch remote operations.

## Existing installations

Finish active jobs, back up the full existing database, and stop the old application. Extract into a new folder. Replace the seeded `office_atlas.db` with your full database backup and carry over your Python_Settings configuration. Check Settings before use and keep the old installation intact until verified. A seating-only export is not a full database backup.

## Included

- Office Atlas maps, assets, shared database and application source.
- Excel templates for users, desks and directory data, with seating change previews and import.
- Installed-software actions for supported remote uninstall and repair operations.
- MSI cache metadata inspection. Cache deletion is disabled.

Python dependencies and external application installers are not embedded. Remote Windows uninstall and repair have not been tested on a real target; validate them on a designated test machine.

## Integrity

SHA-256: `81e801a4a42953a61d8559105a156e78a8a717a494f39f800143107ed04449f1`

This private bundle contains internal employee, machine and floor-plan data. Restrict repository access accordingly.

## Read-only network demo

[Office-Atlas-ReadOnly-Demo.txt](Office-Atlas-ReadOnly-Demo.txt) is a separate **15,635,235-byte** package. Rename it to `.py` and run it, set `Python_Settings.bat`, then run `Start-Atlas-Demo.bat`. Visitors open `http://HOST-PC-IP:8771`; host firewall and network routing must allow TCP 8771. The full IT version stays on localhost:8770.

The map links to a read-only IT directory: users, linked computers, official/previous seating, recorded relationships and histories, package metadata, hosting settings and downloadable Excel templates. Remote tool capabilities are listed with actions disabled. No live software/process scans, deployments, uninstall/repair, cache cleanup, imports or database changes are performed.

Set `package_repository` in the demo's `demo_config.json` to the package root available on the hosting PC. Package folders and recognised script filenames can be inspected; installer files and script contents are not served or embedded. An unavailable repository is reported explicitly.

The included directory is a snapshot. For your latest data, start the demo with `--atlas-folder "C:\Path\Office-Atlas-IT"` to read a consistent snapshot of that installation's database and its package repository setting. Restart the demo to refresh. The source database is opened read-only. `--repository "C:\Packages"` overrides the repository path.

Anyone who can reach this demo can view its internal employee, machine, desk and history data; there is no login or HTTPS. Use it for the intended internal audience only.

Demo SHA-256: `b45d17add2f5d0adb8a07a4b2c6146dfaa0693e6059d2d077d4c5c39ac927e73`.

Validated extraction integrity, HTTP read-only boundaries, data pagination/relationships, package metadata inspection and unchanged source database. JavaScript syntax checked; full browser validation remains outstanding because a test browser could not be downloaded.
