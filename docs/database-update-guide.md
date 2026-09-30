# Updating Atlas databases

Classic and Desktop share one local database. Import once to update both Admin layouts and the local Demo. Hosted Preview uses a separately published snapshot.

## Data locations

- Live database: `data/office_atlas.db` after first launch. `ATLAS_DB_PATH` overrides this when configured.
- Root `office_atlas.db`: distributed seed, copied only on first launch. Replacing it does not refresh an existing runtime database.
- Automatic import backups: `backups/`.
- Calendar, Notes and Reminders: browser-local storage, separate from SQLite.

## Recommended: Admin import

1. Obtain a **complete Europe snapshot** from your approved ServiceNow exports. Export all intended rows, not just the visible page. Keep the agreed location and machine filters consistent. A partial extract can remove other accounts from directory search.
2. Combine the exports into one `.xlsx` file with worksheets named **Users** and **computers**. Preserve original column headings and all useful columns. Keep unique user accounts and machine names, plus assignment fields. The computers sheet requires its Name column. Avoid duplicate identities or duplicate mapped headings.
3. Finish active deployments and queue jobs. Open local **Admin**, then **Manage Database**. Demo and hosted Preview cannot import.
4. Select the workbook and click **Validate and preview**. This creates a separate candidate without changing the live directory.
5. Review added/removed users, machines and assignments, column coverage warnings, and missing desk accounts. Unexpected large removals usually indicate incomplete exports or changed filters. Discard the preview if necessary.
6. Tick **This is the complete Europe snapshot, and I have reviewed the removals**, type `APPLY`, then click **Back up and apply**. Atlas creates a full backup first.
7. Search known people and machines, verify assignments, and review missing desk links. Reload or use **Refresh records** in both local layouts and Demo.

The directory is a full snapshot replacement, not an incremental import. Accounts absent from it disappear from directory search. Desk positions, edited labels, confirmed account links, package catalogue and operation history stay in place. Retained desk links to missing accounts need review.

## Standalone refresh

Finish active jobs, then drag the intended new `.xlsx` onto **Refresh-Directory.bat**. It stops both local services, validates the file, displays counts and asks for `APPLY`. A full backup is saved in `backups/`. Start either edition again afterwards, even if you cancelled the import.

Always supply the new file. With no file argument, this script uses the older bundled `database040926.xlsx`.

For validation only, run from the repository root:

```powershell
py -3.12 refresh_directory.py --source "C:\Data\Europe-export.xlsx" --check-only
```

This does not apply changes. Do not run a direct CLI refresh concurrently with servers using the same database.

## Restore and back up

In **Manage Database > Import history**, choose **Restore directory before this import** and review the staged comparison before applying. This restores the directory while preserving current seating and deployment history; it is not a full application rollback.

**Back up .db** downloads a consistent SQLite snapshot. Keep one before updating Atlas itself. Preserve `data/`, `backups/` and `config.json` when moving to a new checkout. Never replace your runtime database with the distributed seed. Use Atlas's backup feature rather than copying a running SQLite database as an ordinary file.

## Seating updates

Use the separate seating Excel or Desk moves tools in Manage Database. A directory import does not automatically remap desk assignments. See [IT operations and imports](operations.md) for templates and preview steps.

## Hosted Preview

Local imports update local Admin and Demo in **both editions**, but do not automatically update hosted Preview. Its snapshot must be deliberately exported, reviewed for the intended audience and republished through the preview deployment workflow. Both hosted layouts use that same snapshot.

Do not upload the complete live `.db` to the public site or commit runtime databases and backups to GitHub. The Preview shortcut opens the hosted site; it does not synchronize local data.
