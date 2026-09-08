# Office Atlas + IT

**[Download the latest complete Atlas package](Office-Atlas-Latest.txt)** · [Changelog](Office-Atlas-6.4-Changelog.txt) · [Demo](demo/) · [Old releases](old/)

## Full IT application — version 6.4

This is the complete Office Atlas toolbox. The previous filename, `Office-Atlas-IT-Software-Actions.txt`, referred to this same full package; it was not a separate software-only tool. References to that filename inside the 6.4 package and changelog still refer to this download.

Progressive machine health, specification views and separate Assigned / Last logged-on badges. Includes the script-name compatibility fix.

[Read the 6.4 changelog](Office-Atlas-6.4-Changelog.txt). The intermittent software-inventory issue is deferred.

## Download one file

Download [Office-Atlas-Latest.txt](Office-Atlas-Latest.txt) using GitHub's raw-file download control. The complete file is **40,611,550 bytes**; no joining is required.

Enable filename extensions in Windows Explorer, rename the file to `Office-Atlas-Latest.py`, and run it with Python 3.12. Follow the extracted README and Python_Settings instructions to install dependencies and start the application. The extractor verifies the embedded files; it does not launch remote operations.

## Existing installations

Finish active jobs, back up the full existing database, and stop the old application. Extract into a new folder. Replace the seeded `office_atlas.db` with your full database backup and carry over your Python_Settings configuration. Check Settings before use and keep the old installation intact until verified. A seating-only export is not a full database backup.

## Included

- Office Atlas maps, assets, shared database and application source.
- Excel templates for users, desks and directory data, with seating change previews and import.
- Installed-software actions for supported remote uninstall and repair operations.
- MSI cache metadata inspection. Cache deletion is disabled.

Python dependencies and external application installers are not embedded. Remote Windows uninstall and repair have not been tested on a real target; validate them on a designated test machine.

## Integrity

SHA-256: `6519684601b47bec76bed221e5351bf7a8df2ef33c731a26cd280f1c24e95c0a`

This private bundle contains internal employee, machine and floor-plan data. Restrict repository access accordingly.

## Read-only network demo

[Office-Atlas-ReadOnly-Demo.txt](demo/Office-Atlas-ReadOnly-Demo.txt) is a separate **15,635,235-byte** package. Rename it to `.py` and run it, set `Python_Settings.bat`, then run `Start-Atlas-Demo.bat`. Visitors open `http://HOST-PC-IP:8771`; host firewall and network routing must allow TCP 8771. The full IT version stays on localhost:8770.

The map links to a read-only IT directory: users, linked computers, official/previous seating, recorded relationships and histories, package metadata, hosting settings and downloadable Excel templates. Remote tool capabilities are listed with actions disabled. No live software/process scans, deployments, uninstall/repair, cache cleanup, imports or database changes are performed.

Set `package_repository` in the demo's `demo_config.json` to the package root available on the hosting PC. Package folders and recognised script filenames can be inspected; installer files and script contents are not served or embedded. An unavailable repository is reported explicitly.

The included directory is a snapshot. For your latest data, start the demo with `--atlas-folder "C:\Path\Office-Atlas-IT"` to read a consistent snapshot of that installation's database and its package repository setting. Restart the demo to refresh. The source database is opened read-only. `--repository "C:\Packages"` overrides the repository path.

Anyone who can reach this demo can view its internal employee, machine, desk and history data; there is no login or HTTPS. Use it for the intended internal audience only.

Demo SHA-256: `b45d17add2f5d0adb8a07a4b2c6146dfaa0693e6059d2d077d4c5c39ac927e73`.

Validated extraction integrity, HTTP read-only boundaries, data pagination/relationships, package metadata inspection and unchanged source database. JavaScript syntax checked; full browser validation remains outstanding because a test browser could not be downloaded.

## Older full IT installations

The script-name fix is included in version 6.4; a separate patch is not needed. [Atlas-Script-Names-Fix.txt](old/6.3/Atlas-Script-Names-Fix.txt) remains available for older full IT installations. The standalone demo is frozen and should not be patched.

For upgrades, follow the changelog to preserve your database, Python path, repository configuration and any custom launcher settings. Live Windows hardware queries and full browser rendering remain to be validated in the target environment.

## Release archive

Previous full IT releases are retained in [old](old/). Version [6.3](old/6.3/) includes its original package, README and script-name patch. Future releases should archive the outgoing version before replacing the current package.
