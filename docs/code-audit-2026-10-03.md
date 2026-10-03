# Code audit and performance cleanup — 3 October 2026

Baseline: `bb657c282c2895b32ac7da788033cd43001ab351`.

## Scope and method

Reviewed Atlas's first-party Python, JavaScript, styles/templates, launchers and PowerShell integration: imports and references, directory/import/identity queries, map rendering, UI event/polling lifecycles, remote operation boundaries and tests. Parsed all first-party Python and JavaScript. Used Ruff's undefined-name/unused-import checks and ESLint's undefined-name/unused-variable checks, accounting for the console's shared script scope and generated map template. Manually checked dead-code candidates against routes, script loading, generators and tests before removing them.

Bundled Draw.io has runtime-loaded shapes, importers and editor resources. It remains intact; an ordinary reference scan cannot prove those files unused. Production Python dependencies are still required. `pip check` found no broken installed requirements. Windows remote actions are validated with simulated responses here; Linux cannot verify execution against live Windows hosts or AD.

## Implemented findings

| Finding | Change |
| --- | --- |
| Import preview materialized both full inventories and both sets of assignment relationships | Merge ordered SQLite cursors and retain only the first 20 added/removed examples. Keep identity-based comparison, counts, relationship deduplication, missing desk-account reporting, warnings and archived-field coverage. |
| Excel parser cleared values but retained every processed row/string element in the XML tree | Detach completed rows and shared-string elements. Preserve sparse cells, rich strings, raw whitespace and the shared-string cache across workbook passes. |
| Assignment and alias rebuilds fetched all source rows before processing | Iterate separate SQLite cursors while writing the destination tables; reuse normalized identity values. |
| Global users with no candidate desk triggered a full-directory name-uniqueness scan | Build the small candidate desk-name set first and skip the scan when none can match. Existing ambiguity and confirmed-account rules still apply. |
| Reading a desk checked the legacy table twice to infer its layout | Retain the layout from the successful read. |
| Floating-controls compatibility code was loaded despite being retired | Remove its script, five HTML inclusions and all no-op callers; keep fixed-layout checks for old browser pin preferences. |
| Unused Python imports, selection parameters and renderer arguments | Remove confirmed unused imports/arguments. Preserve launcher dependency imports because they deliberately check importability. |
| Multi-desk search selection referenced `u` outside its scope | Use the selected result's directory identity when rendering the desk choices. The existing palette regression reproduced this bug. |
| Standard runner omitted 16 existing DOM suites and could wait indefinitely on a failed process | Discover all DOM suites, keep the map/installer suites, bound child test runtime, and report all frontend failures together. Mark unavailable PowerShell executables as explicit skips. Fix two stale fixture expectations left behind by earlier UI/event changes. |

## Measured results

Fictional data only, with before/after code in separate processes on the same Linux workspace. These are local benchmarks, not production throughput guarantees.

| Operation | Before | After | Evidence |
| --- | ---: | ---: | --- |
| Preview comparison: 120,000 users, 300,000 devices, 300,000 assignments; 30,000 changed devices | 5.188 s / 534.6 MiB peak process RSS | 3.812 s / 41.1 MiB | Serialized preview reports identical; approximately 27% less elapsed time and 92% less peak memory. |
| Read 300,000 numeric Excel rows | 23.58 MiB peak traced Python allocations | 0.56 MiB | Same row count and numeric checksum. Traced allocations exclude native-library memory. |
| Look up a user with no candidate desk, 120,000 users and 620 desks | 155.47 ms | 1.85 ms | Median of five calls; both return no desk suggestions. |

New regression cases compare the streaming result with a full in-memory reference over randomized inventories, test changed row IDs and stable relationships, verify missing desk accounts, preserve raw/sparse/rich Excel cells across sheets, and confirm that a user without a desk candidate does not scan every user's name.

## Remaining considerations

- Broad substring searches still use scans; exact account/hostname/serial/asset searches use indexes. A future full-text index must preserve the current literal-substring and identifier matching behavior before replacing those queries.
- A person whose name matches a desk still needs global ambiguity checking. A cross-request cache would need explicit invalidation for imports, restores and all other directory changes; this cleanup avoids introducing stale identity matches.
- Shared strings and the identity matching index are intentionally retained during imports. The changes bound avoidable row/comparison storage; total import memory still depends on the number of unique values.
- The hosted Preview's public audience remains inconsistent with the owner-private requirement in `AGENTS.md`. Shared assets are synchronized into its prepared source with its existing snapshot preserved; no audience change is included.

## Validation

- 175 Python tests: 165 passed, 10 explicitly skipped because the required PowerShell runtime is unavailable.
- All 50 frontend regression suites passed, including the 16 newly included suites.
- Browser checks passed at 390/768/1366 px in Admin, Demo and prepared Preview, including Desktop, fixed controls and phone/PC action restrictions. Running Admin/Demo assets match the edited source.
- First-party Python and JavaScript parsed; reviewed undefined-name/unused-import/unused-variable checks passed.
- The distributed seed database checksum stayed `ab81ee13af9703a0a9afedbae97060443841669bc65fdd3b08a11501034a4e9a`. Prepared Preview's 358 JSON snapshot files remain byte-identical to its original snapshot.
