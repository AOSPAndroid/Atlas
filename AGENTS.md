# Release consistency

User requirement: always update Admin, Demo (read-only LAN viewer), and the owner-private hosted preview together for shared Atlas changes.

- Share map assets and behavior between Admin and Demo; preserve Demo restrictions.
- Sync shared changes into the existing private preview without replacing its real-data snapshot or broadening access.
- Restart local services when backend routing changes, then verify the actual running Admin and Demo serve the new assets.
- Publish and verify the private preview before reporting shared changes complete. Report any version that remains out of date.
