# Classic Atlas

Launch shortcuts for Atlas. (The optional Desktop layout was removed; Atlas has one layout.)

| Mode | Launch | Behaviour |
| --- | --- | --- |
| Admin | [Start Admin](Admin/Start-Admin.bat) | Local full console; remote actions use the host account and existing elevation requirements. |
| Demo | [Start Demo](Demo/Start-Demo.bat) | Local read-only LAN viewer with the full interface and restricted remote operations. |
| Preview | [Open Preview](Preview/Open-Preview.url) | Hosted showcase; no local Python required. |

Download or clone the **whole repository** before running Admin or Demo. Run the root `Install_Dependencies.bat` once. These launchers use the root application, assets and database; they are launch shortcuts, not copies. Starting one local mode ensures both local services are available, then opens only the mode chosen. The root `Stop-Office-Atlas.bat` stops both services. Admin remains bound to localhost; Demo keeps its read-only restrictions.

## Start, stop and database updates

[Start Classic](../Start-Classic-Atlas.bat) opens Admin and Demo together. [Stop Classic](../Stop-Classic-Atlas.bat) stops the local services. Finish ongoing jobs first. Hosted Preview stays online.

Read the [database update guide](../docs/database-update-guide.md).
