# Classic Atlas

The familiar Atlas navigation and page layout.

| Mode | Launch | Behaviour |
| --- | --- | --- |
| Admin | [Start Admin](Admin/Start-Admin.bat) | Local full console; remote actions use the host account and existing elevation requirements. |
| Demo | [Start Demo](Demo/Start-Demo.bat) | Local read-only LAN viewer with the full interface and restricted remote operations. |
| Preview | [Open Preview](Preview/Open-Preview.url) | Hosted showcase; no local Python required. |

Download or clone the **whole repository** before running Admin or Demo. Run the root `Install_Dependencies.bat` once. Both editions share the root application, assets and database; these folders are explicit launch profiles, not independent copies. Starting one local mode ensures both existing local services are available, then opens only the mode chosen. The root `Stop-Office-Atlas.bat` stops both services.

Classic launches explicitly select the Classic layout; Desktop launches open the desktop directly. The browser remembers subsequent layout choices. Admin remains bound to localhost; Demo keeps its existing read-only restrictions. A Desktop appearance never grants administration permissions.
