# Release consistency

User requirement: always update Admin, Demo (read-only LAN viewer), and the owner-private hosted preview together for shared Atlas changes.

- Share map assets and behavior between Admin and Demo; preserve Demo restrictions.
- Sync shared changes into the existing private preview without replacing its real-data snapshot or broadening access.
- Restart local services when backend routing changes, then verify the actual running Admin and Demo serve the new assets.
- Publish and verify the private preview before reporting shared changes complete. Report any version that remains out of date.

# UI density

Keep all Atlas surfaces dense by default, including new features. Use compact cards, short toolbars, 4-8 px gaps/padding, and readable 11-13 px operational text. Process tables use compact rows; avoid large metric cards or charts that push the primary list below the fold. Keep secondary detail expandable, all records accessible, and touch targets usable. Apply changes to Classic/Desktop and Admin/Demo/Preview together.
