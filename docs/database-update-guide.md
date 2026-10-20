# Updating Atlas databases

Admin and the local Demo share one local database. Import once to update both. Hosted Preview uses a separately published snapshot.

## Updating Atlas itself

Run **[Update-Atlas.bat](../Update-Atlas.bat)** from the existing installation to update application code while preserving its data and settings. Git for Windows and access to the GitHub repository are required. Finish active work first. The first run converts a ZIP folder in place after backing it up; future runs update that checkout. You do not need to reimport users, devices, packages or Citrix VDI records just because Atlas was updated.

See [Updating Atlas](updating-atlas.md) for prerequisites, backup and recovery details, `--check`, and updating without starting services. The import instructions below change database content separately from an application update.

## Data locations

- Live database: `data/office_atlas.db` after first launch. `ATLAS_DB_PATH` overrides this when configured.
- Root `office_atlas.db`: distributed seed, copied only on first launch. Replacing it does not refresh an existing runtime database.
- Automatic import backups: `backups/` beside the active database, normally `data/backups/`.
- Calendar, Notes and Reminders: browser-local storage, separate from SQLite.

## Recommended: Admin import

After updating Atlas, restart local Admin and Demo before importing so both load the current workbook support.

1. Obtain the **complete intended directory snapshot** from your approved ServiceNow exports. Export all intended rows, not just the visible page. Keep the agreed location and machine filters consistent. A partial extract can remove other accounts from directory search.
2. Keep the two exports as they are: the **users** file and the **devices** file, `.xlsx` or `.csv`. You can select both together in step 4 (Ctrl-click, or drag them onto the Users & devices card); Atlas works out which is which from the headers and combines them itself. One `.xlsx` with worksheets named **users** and **devices** (or **Users** and **computers**) still works too. Names are case-insensitive; use one user sheet and one device sheet. Keep the original headers, columns and rows: no duplicate cleanup is required. Users require `user_name`, `name` and `email`; devices include `ci` or `name`. If both CI and name columns are present, Atlas prefers the CI and uses a nonempty name when the CI is blank. Other aliases use the first nonempty column.
3. Finish active deployments and queue jobs. Open local **Admin**, then **Manage Database**. Demo and hosted Preview cannot import.
4. Select both exports (or the workbook) and click **Validate and preview**. This creates a separate candidate without changing the live directory.
5. Review added/removed users, machines and assignments, automatic duplicate handling, column coverage warnings, and missing desk accounts. Unexpected large removals usually indicate incomplete exports or changed filters. Discard the preview if necessary.
6. Tick **This is the complete intended directory snapshot, and I have reviewed the removals**, type `APPLY`, then click **Back up and apply**. Atlas creates a full backup first.
7. Search known people and machines, verify assignments, and review missing desk links. Reload or use **Refresh records** in both local layouts and Demo.

The directory is a full snapshot replacement, not an incremental import. Accounts absent from it disappear from directory search. Desk positions, edited labels, confirmed account links, package catalogue and operation history stay in place. Retained desk links to missing accounts need review.

The devices export accepts `ci` as hostname and `model` as model; `assigned_to` and `serial_number` already match. The user headers `u_organisational_unit`, `u_business_unit`, `u_start_date`, `manager`, `location`, `title`, `u_job_type` and `employee_number` are supported unchanged. Atlas retains every original column, including device `asset_tag`, `model_category`, `cmp_last_used`, `install_status`, `assigned`, `display_name` and `location`, in the directory and export details. Compact device badges show Laptop, Desktop or iPhone, Assigned/Unassigned, asset state and Last used when supplied. `assigned` is the assignment date; `cmp_last_used` is the recorded usage date. Numeric Excel dates are converted, while the original cells remain in the archive. Asset state is not substituted for operational status or proof that a device is online.

Phones are searchable inventory and can link to their assigned users. Generic or blank CI labels such as `iPhone` do not merge separate phones: Atlas uses the CMDB `sys_id` when supplied, otherwise serial number, asset tag, or a meaningful CI. These identifiers have separate inventory namespaces, independent of the device category; changing a phone's category does not create another asset. They are inventory IDs, not invented Windows hostnames. With no identifier, each mobile row receives a separate source-row ID scoped to that extract. Row IDs can change with a new extract, so include serial numbers or asset tags when available. The original CI remains searchable (also using `source_ci:`), appears in device details, and is retained with the model, asset tag, serial number and location in export details. Atlas disables PC deployment, health and Windows remote actions for recognized phones/tablets/Macs, including when their original CI is entered manually. Laptops and unassigned Windows computers remain usable as PC targets. This does not provide iPhone management or MDM deployment.

Duplicate accounts and device identities are consolidated automatically. When values differ, the row with the newest `sys_updated_on`/`updated_on` timestamp wins; otherwise the last row wins. The winning row replaces the record as a whole, including blank assignments, rather than carrying forward stale values from an older duplicate. All original rows and columns remain in the source archive. Export details open the selected row and show the number of retained source rows. The preview reports reconciliation counts and examples; duplicate names belonging to different user accounts remain separate and ambiguous name references are not linked automatically.

Blank `assigned_to` does not discard a named device. References match a unique user account, email, employee number or full name. Windows device rows without a `ci`/`name` hostname are retained in the source archive and reported in the preview, but do not create remote targets. Atlas does not invent a Windows hostname from an asset tag or serial number. Keep a Computers export's discovery and last-logon columns if those details are required; fields absent from a replacement snapshot are not carried forward.

## Matching users and machines

Exact accounts, email addresses and employee identifiers take priority over display names. A supplied account domain is respected: an account in `CLIENT` is not automatically linked to a known account in `INTRANET`. The existing G-number/X-number convention remains supported, but separately exported accounts remain separate when an alias could refer to either person. Duplicate names and ambiguous identifiers offer a choice instead of selecting someone automatically. Search prefixes such as `email:`, `name:` and `brid:` restrict the corresponding field.

Assignment records can use a unique full name when no exact identifier matches. Inventory last-logon references use the same identifier priority and may fall back to a unique exact full name for compatibility with historical exports. Ambiguous names remain unlinked, and domain-qualified accounts or email references never fall back to display names. Workspace device cards identify assignment, Citrix assignment and inventory last-logon relationships separately. These exports describe recorded relationships, not live sessions.

A unique short hostname can find its exported fully qualified hostname, including an optional trailing dot. If multiple exported machines share that short name, choose the intended machine first; Atlas does not choose a Windows target for you. Machines without assigned users remain searchable and usable when they have a supported, unambiguous Windows hostname. Shared Citrix VDIs appear on each uniquely matched assigned user's profile.

Users without a login or email use their supplied source ID or employee number. With neither available, Atlas preserves each row under an extract-scoped key instead of merging people by name or reusing a row number across extracts. Placeholder values such as `(empty)`, `null`, `unassigned` and `-` do not become identifiers.

After this matching update, restarting Admin refreshes derived account aliases and imported relationships once while preserving source records and confirmed desk links. If an older import already consolidated distinct people or assets, reimport the original workbook once to recover those separate records. An ordinary code update does not require a new import.

Validation covers the original directory template and the users/devices export, source-column retention, unique assignment matching, duplicate identities/aliases, preview/apply/backup guards and Demo restrictions. A synthetic scale check imported 300,000 named devices plus one archived device without a hostname; it does not establish performance for a particular production export. The Admin preview was also checked at 390, 768 and 1366 px. The hosted read-only snapshot is separate and unchanged by importer updates.

## Standalone refresh

Finish active jobs, then drag the intended new `.xlsx` workbook, or the users and devices exports together, onto **Refresh-Directory.bat**. It stops both local services, validates the file, displays counts and asks for `APPLY`. A full backup is saved beside the active database in `backups/`, normally `data/backups/`. Start either edition again afterwards, even if you cancelled the import.

Always supply the new file. With no file argument, this script uses the older bundled `database040926.xlsx`.

For validation only, run from the repository root:

```powershell
py -3.12 refresh_directory.py --source "C:\Data\Europe-export.xlsx" --check-only
```

This does not apply changes. Do not run a direct CLI refresh concurrently with servers using the same database.

## Restore and back up

In **Manage Database > Import history**, choose **Restore directory before this import** and review the staged comparison before applying. This restores the directory while preserving current seating and deployment history; it is not a full application rollback.

**Back up .db** downloads a consistent SQLite snapshot. Keep one before manually changing application files; `Update-Atlas.bat` creates backups as part of its update. Preserve the entire `data/` directory (including its backups and `knowledge.sqlite3`), any older installation-level `backups/` directory, local configuration and `config.json` when moving to a new checkout. Never replace your runtime database with the distributed seed. Use Atlas's backup feature rather than copying a running SQLite database as an ordinary file.

## Live floor plan (the assistants' Excel)

**Manage Database > Live floor plan** links official seating to the desk plan the administrative assistants keep in Excel. Enter the folder once, for example the OneDrive-synced `...\PA-IT_shared\02_Current_plan` (quotes from "Copy as path" are fine), tick **Live link on** and click **Save**.

- Atlas checks the folder every minute and uses the newest `.xlsx` that contains desk codes. Other workbooks in the folder (New Joiners, Headcount files) are skipped. A file saved less than 30 seconds ago is read on the next check.
- Every sheet is read. Each box with a desk code becomes a desk: a name that matches exactly one directory person (word order, case and accents ignored) is linked to that person and their machines. Atlas also accepts shorter names that identify one person, uses the Paris location to resolve duplicate names where possible, and recognises close spelling matches among Paris staff when there is no close second match. These matches are listed for checking. "Open", "Vacant" or an empty box frees the desk. Anything else ("Credit Sales", "Private Office (209) … GCAS (…)", someone not in the directory) is shown exactly as written. A code typed without its leading zero (`2R017069`) is corrected to `02R017069` and listed.
- Normal changes are applied straight away with a backup, and open maps (Admin and Demo) refresh within a minute. The map footer names the plan and its time.
- **Held for review** when the plan has problems, the same desk appears with two different names, or one save changes more than the greater of 40 desks and 15% of the plan. The card lists the changes; click **Apply these changes**, or correct the Excel and Atlas reads it again. Approval applies only to the proposal you reviewed; if it has changed, Atlas asks you to review it again.
- Desks the plan does not mention are left as they are. Desk codes not on the map are skipped and listed.
- The card shows what was read: corrected codes, names not matched to one person, unknown codes. The ten most recent live-plan backups are kept in `backups/`.

## Seating updates

Use the separate seating Excel or Desk moves tools in Manage Database. A directory import does not automatically remap desk assignments. See [IT operations and imports](operations.md) for templates and preview steps.

## Hosted Preview

Local imports update local Admin and Demo in **both editions**, but do not automatically update hosted Preview. Its snapshot must be deliberately exported, reviewed for the intended audience and republished through the preview deployment workflow. Both hosted layouts use that same snapshot.

Do not upload the complete live `.db` to the public site or commit runtime databases and backups to GitHub. The Preview shortcut opens the hosted site; it does not synchronize local data.
