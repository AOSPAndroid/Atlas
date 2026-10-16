# Update Atlas without replacing your installation

Use **[Update-Atlas.bat](../Update-Atlas.bat)** in your existing Atlas folder. After its first update, the same folder receives future versions from GitHub; you do not need to download another ZIP or reimport users, devices, packages or Citrix VDI records.

Updates come from **AOSPAndroid/Atlas, main**. Existing Git installs using the old BAtlas URL remain supported. Only merged changes are released.

## Add the updater to an older Atlas folder

If the folder does not contain the updater yet, download these two files from this repository's **main** branch and place both beside `Python_Settings.bat` in your existing Atlas folder:

- [Update-Atlas.bat](https://raw.githubusercontent.com/AOSPAndroid/Atlas/main/Update-Atlas.bat)
- [update_atlas.py](https://raw.githubusercontent.com/AOSPAndroid/Atlas/main/update_atlas.py)

Save the files under those exact names, without an added `.txt` extension. You only need this pair once; the Python updater uses the standard library and obtains the rest of the current application from Git.

Alternatively, open PowerShell **in the existing Atlas folder** and run this download-only command:

```powershell
@('Update-Atlas.bat', 'update_atlas.py') | ForEach-Object { Invoke-WebRequest -UseBasicParsing -Uri ("https://raw.githubusercontent.com/AOSPAndroid/Atlas/main/" + $_) -OutFile (Join-Path $PWD $_) -ErrorAction Stop }
```

This saves files; it does not execute downloaded code. If raw downloads are restricted or repository access requires authentication, download the two files through your signed-in GitHub browser using your approved process. Then follow the steps below.

## Before the first update

1. Keep the complete extracted Atlas folder together. Use the folder where you already run Atlas, rather than extracting a new copy over it.
2. Install **Git for Windows** through your approved software process and make sure `git` is available in Command Prompt. The updater does not install Git. Python 3.12 is selected through the existing `Python_Settings.bat`; `WMI_PYTHON` can specify your approved interpreter.
3. Make sure this Windows account can read the GitHub repository. If authentication is required, use your approved Git authentication; do not put credentials in the batch file or repository URL.
4. Finish active deployments, queues, imports, terminal commands and other remote work. Save open Knowledge Base documents and browser drafts before services stop.
5. Double-click **Update-Atlas.bat**. A successful update starts Admin and Demo without opening duplicate browser tabs. Read the result before closing its window, then refresh your open Atlas tabs. If you already have the current version, Atlas stays running and no update backup is needed.

Git is needed for updating, but it is not required just to run a ZIP installation. Admin and Demo share this folder and its two local services, so one update covers both. The separately hosted Preview is published through its own release workflow.

## What stays in place

The update changes application code in the same folder. It preserves the runtime `data/` directory, `config.json`, local `.env` files, logs and backups. This includes the live directory and seating database, package and Citrix VDI metadata, operation history, and the Knowledge Base database. A configured `ATLAS_DB_PATH` continues to select your existing database.

The root `office_atlas.db` is a distributed seed, not your live database after normal startup. Atlas keeps the live database rather than importing the new seed. For an older installation that still uses the root database, the updater first creates its runtime copy through SQLite backup before changing the distributed seed. A configured external `ATLAS_DB_PATH` stays unchanged and is backed up too.

Before changing code, the updater saves a dated backup under `data/backups/atlas-update-ID/` and prints its location. It contains consistent SQLite snapshots and the previous application/configuration files. Copying a database while it is in use as an ordinary file is not a substitute for a consistent SQLite backup.

Calendar, Notes, Reminders and layout preferences remain in this browser's local storage. Your OneDrive/SharePoint package files remain at their configured source location. Updating code does not synchronize hosted Preview data or change the shared viewer's permissions.

## First update from a downloaded ZIP

A ZIP installation has no Git metadata. The updater fetches the approved Atlas repository into a staging checkout, backs up the existing application files and SQLite databases, then converts that **same folder** into a Git checkout. Existing runtime data and settings stay there, including import histories whose backup paths point into this folder. Future updates use the checkout's Git history and accept only a fast-forward update.

Dependencies are installed using the selected Python after ZIP conversion, or when an update changes `requirements.txt`. Git authentication and access to your approved Python package index must be available when needed.

Do not move or delete the folder while this conversion is running. If it fails, keep the printed backup location and error message; do not solve it by replacing your runtime database with the repository seed.

## Check or update without starting services

From Command Prompt or PowerShell in the Atlas folder:

```powershell
.\Update-Atlas.bat --check
.\Update-Atlas.bat --no-start
```

`--check` fetches and inspects update readiness without stopping services, creating update backups or changing application files. `--no-start` applies an update but leaves the local services stopped. Use the existing Start launcher when you are ready to run Atlas again. If no update is needed, either command leaves running services alone.

For automation, set `ATLAS_UPDATE_NO_PAUSE=1` before calling the batch file. It forwards arguments unchanged to `update_atlas.py` and returns that program's exit code. A normal double-click leaves the result visible until you press a key.

## If the update is refused

| Message or cause | Next step |
| --- | --- |
| Git is missing or authentication fails | Install/configure approved Git for Windows and verify access to the GitHub repository, then retry. |
| Tracked application files have local edits | Preserve and review those edits before updating. The updater does not silently discard them. Runtime data and local configuration are separate from tracked application files. |
| The folder has a different repository, branch, divergent history or untracked files that the update would replace | Preserve those files and use the reported error to review the checkout. Do not force a reset or overwrite the folder. |
| Atlas activity or the running instance cannot be verified | Finish active work, then use `Stop-All-Atlas.bat` in the installation that owns those services and retry. A server belonging to another folder must be handled from that folder. |
| Backup or service shutdown fails | Leave the installation in place and resolve the reported failure before retrying. |
| Application update fails after shutdown | The updater attempts to restore the previous application files and leaves Atlas stopped. Read the recovery result and keep the backup path before manually restarting. A recovery failure needs review of that backup. |
| Dependency installation fails | The updater attempts to restore the previous application files and leaves Atlas stopped. Run `Install_Dependencies.bat` and resolve any package-index/dependency error before starting Atlas or retrying; the Python environment is not rolled back. |
| Update succeeded but startup fails | Read the named startup log and resolve its reported problem, then start Atlas with the usual launcher. The runtime data stays in place. |

An interrupted updater can leave `data/atlas-update.lock`. Confirm that no updater process or update window is still running before removing that lock and retrying. The updater never uses `git reset --hard` or `git clean` to discard local files; do not use them to bypass a refusal.

Keep the printed backup paths with your normal recovery records. [Database update and recovery](database-update-guide.md) explains backups and data imports; importing users or devices is a separate action from updating Atlas itself.
