# Updating Atlas databases

Classic and Desktop share one local database. Import once to update both Admin layouts and the local Demo. Hosted Preview uses a separately published snapshot.

## Data locations

- Live database: `data/office_atlas.db` after first launch. `ATLAS_DB_PATH` overrides this when configured.
- Root `office_atlas.db`: distributed seed, copied only on first launch. Replacing it does not refresh an existing runtime database.
- Automatic import backups: `backups/`.
- Calendar, Notes and Reminders: browser-local storage, separate from SQLite.

## Recommended: Admin import

After updating Atlas, restart local Admin and Demo before importing so both load the current workbook support.

1. Obtain the **complete intended directory snapshot** from your approved ServiceNow exports. Export all intended rows, not just the visible page. Keep the agreed location and machine filters consistent. A partial extract can remove other accounts from directory search.
2. Combine the exports into one `.xlsx` file with worksheets named **users** and **devices**. The existing **Users** and **computers** format remains supported. Names are case-insensitive; use one user sheet and one device sheet. Preserve the original headers and all useful columns. Users require `user_name`, `name` and `email`; devices require `ci` or `name` for the hostname. Avoid duplicate identities or two headings mapping to the same field.
3. Finish active deployments and queue jobs. Open local **Admin**, then **Manage Database**. Demo and hosted Preview cannot import.
4. Select the workbook and click **Validate and preview**. This creates a separate candidate without changing the live directory.
5. Review added/removed users, machines and assignments, column coverage warnings, and missing desk accounts. Unexpected large removals usually indicate incomplete exports or changed filters. Discard the preview if necessary.
6. Tick **This is the complete intended directory snapshot, and I have reviewed the removals**, type `APPLY`, then click **Back up and apply**. Atlas creates a full backup first.
7. Search known people and machines, verify assignments, and review missing desk links. Reload or use **Refresh records** in both local layouts and Demo.

The directory is a full snapshot replacement, not an incremental import. Accounts absent from it disappear from directory search. Desk positions, edited labels, confirmed account links, package catalogue and operation history stay in place. Retained desk links to missing accounts need review.

The devices export accepts `ci` as hostname and `model` as model; `assigned_to` and `serial_number` already match. The user headers `u_organisational_unit`, `u_business_unit`, `u_start_date`, `manager`, `location`, `title`, `u_job_type` and `employee_number` are supported unchanged. Atlas retains every original column, including device `asset_tag`, `model_category`, `cmp_last_used`, `install_status`, `assigned`, `display_name` and `location`, in the directory and export details. Compact device badges show Laptop, Desktop or iPhone, Assigned/Unassigned, asset state and Last used when supplied. `assigned` is the assignment date; `cmp_last_used` is the recorded usage date. Numeric Excel dates are converted, while the original cells remain in the archive. Asset state is not substituted for operational status or proof that a device is online.

Phones are searchable inventory and can link to their assigned users. Their CI, model, asset tag, serial number and location remain available, but Atlas disables PC deployment, health and Windows remote actions for recognized phones/tablets/Macs. Laptops and unassigned Windows computers remain usable as PC targets. This does not provide iPhone management or MDM deployment.

Blank `assigned_to` does not discard a named device. References match a unique user account, email, employee number or full name. Device rows without a `ci`/`name` hostname are retained in the source archive and reported in the preview, but do not create searchable machines or remote targets. Atlas does not invent a hostname from an asset tag or serial number. Keep a Computers export's discovery and last-logon columns if those details are required; fields absent from a replacement snapshot are not carried forward.

Validation covers the original directory template and the users/devices export, source-column retention, unique assignment matching, duplicate identities/aliases, preview/apply/backup guards and Demo restrictions. A synthetic scale check imported 300,000 named devices plus one archived device without a hostname; it does not establish performance for a particular production export. The Admin preview was also checked at 390, 768 and 1366 px. The hosted read-only snapshot is separate and unchanged by importer updates.

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
