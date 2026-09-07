# Atlas

Complete portable Atlas transfer bundle, split into three parts. The joiner reconstructs one Python installer and verifies every part with SHA-256.

## Download on your Windows PC

Sign in to GitHub with an account that can access this private repository. Download these four files into the same folder, preserving their names:

- [Atlas-Join.txt](Atlas-Join.txt)
- [Atlas-Part-1.txt](Atlas-Part-1.txt) — 14,000,000 bytes
- [Atlas-Part-2.txt](Atlas-Part-2.txt) — 14,000,000 bytes
- [Atlas-Part-3.txt](Atlas-Part-3.txt) — 12,507,709 bytes

Use each file's raw-file download control. Do not save the GitHub HTML page or copy the displayed text. If ZIP downloads are available, you can instead download and extract the repository ZIP.

## Reconstruct and run

1. Enable file-name extensions in Windows File Explorer.
2. Rename only `Atlas-Join.txt` to `Atlas-Join.py`. Keep the three part filenames unchanged.
3. Open a terminal in that folder and run:

```bat
python Atlas-Join.py
```

4. After the joiner reports success, run:

```bat
python Atlas-Installer.py
```

If `python` is not available on PATH, use the full path to your installed Python executable in quotation marks. The joiner needs Python 3.8 or newer; the app has its own dependencies and setup requirements.

The joiner creates `Atlas-Installer.py` (40,507,709 bytes). It does not execute the application or deploy software to remote machines. Follow the reconstructed installer's instructions to extract and start Atlas.

## Existing Atlas installations

Back up your existing Atlas installation and database before applying this bundled snapshot. Extract into a separate folder first so existing desk edits and directory updates are preserved for migration.

## Troubleshooting

- **Missing part:** put all four downloaded files in the same folder and remove download-added suffixes such as `(1)`.
- **Incomplete or changed part:** download that part again using the raw-file download control. The checksum check also rejects HTML pages saved as TXT.
- **Installer already exists with different content:** move or rename the existing `Atlas-Installer.py` before joining again.
- **Download blocked:** browsing repository pages does not guarantee file downloads are permitted. Use your organization's approved transfer route if downloads are blocked.

## Contents and access

This bundle includes application files, employee and machine data, and internal floor plans. Keep this repository private and restrict access appropriately. Application package payloads remain in the separately configured package repository; they are not bundled here.
