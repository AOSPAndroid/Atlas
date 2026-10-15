# Live Inbox in the main Atlas GUI

Use **Atlas Admin > Workspace > Live Inbox** in Classic or Desktop. Incoming
Outlook email and Teams/Outlook notification previews share one local feed,
sender lookup, candidate selection and linked-machine panel. Open in Workspace
selects the matched person in the existing Atlas tools. Messages never launch
diagnostics or fixes automatically. Suggested fixes are not part of this release.

## One-time setup on the work PC

1. Keep the Atlas checkout in a local folder readable by both Windows accounts.
   Use Python 3.12+ that the normal account can run. A Python installed only under
   the elevated account's private profile may not be accessible.
2. In the normal Outlook/Teams account (`x01426046`), run
   `Install-Inbox-Collectors.bat "C:\Approved\Atlas.NotificationListener.msix"`
   with your approved, signed package. This installs pywin32 for classic Outlook
   and registers the notification package for that Windows account. To install
   only the email dependency, use `Install-Outlook-Watcher.bat`.
   `WMI_PYTHON` can select the Python used by these BAT files.
3. Open Atlas from the usual elevated PowerShell (`x01426046_dsk`). In Live Inbox,
   expand **Connect collectors**, enter the normal Windows account as
   `DOMAIN\x01426046` (use `whoami` in the normal session for the actual domain),
   and set the same Python executable used in step 2. Click **Connect and start collectors**.
4. Click **Listener settings**. Its window opens in the normal user's session.
   Select **Allow access and start** to grant Windows notification permission.
   Generate a Teams test notification and check the source list; select the
   installed Teams app if its ID differs from the built-in defaults.
5. Open classic Outlook normally for full emails. The watcher waits while it is
   closed. Both collectors continue when you switch Atlas pages or close its tab.

Setup creates an on-demand, limited Windows task using the normal account's
existing interactive sign-in. That account must be signed in on the same PC.
It does not store a password, create a Windows service, add a login trigger,
change notification permissions, enable Developer Mode, or trust certificates.
If workstation policy blocks task registration or package installation, Atlas
shows the error; the rest of the GUI remains available.

## Normal use

- `Start-Office-Atlas.bat`, `Start-Classic-Atlas.bat`, `Start-Desktop-Atlas.bat`,
  `Start-All-Atlas.bat`, and the nested Classic/Desktop Admin/Demo launchers all
  use the same startup hook. After setup, they request collector startup once;
  repeated launches reuse the task and collector locks. Preview-only launchers
  do not start any local process.
- **Email watcher** and **Notification watcher** are always visible above the
  feed. Switches apply immediately and persist for the next Atlas launch. Email
  controls full classic Outlook messages; notifications controls Teams and the
  optionally selected Outlook previews. Turning on a switch after Stop starts
  only that source. Turning off the last source shuts down the supervisor.
- **Start collectors** and **Stop collectors** control the shared normal-user
  supervisor while retaining source preferences. The switches show Off while
  stopped. On means requested; the status badges above confirm actual readiness,
  waiting for Outlook, missing permission or errors. With email still on,
  notification Off pauses capture; the companion may remain in the tray.
- **Sources and connection** contains the optional Outlook preview setting.
- **Listener settings** opens Windows consent and notification-source selection
  even when preview capture is disabled. Enabling Outlook previews alongside
  full emails can show both forms of the same incoming message.
- Every `Stop-*-Atlas.bat` requests cooperative collector shutdown before
  stopping the shared servers. A pending Outlook access prompt may delay its
  shutdown; finish that prompt in Outlook. Atlas never kills Outlook or Teams.
- Standalone watcher start/stop/status and notification start scripts also use
  the saved queue after setup. While the supervisor is running, use the GUI to
  stop a source; otherwise its saved preference may restart it.

An existing manually configured collector can still work without integrated
setup through `ATLAS_MAIL_DIR`. The integrated setup takes precedence once saved.
It does not move or delete any older queue. For the same accounts, an existing
bridge is reused only if its exact permissions match.

## Install Atlas as an app (PWA)

1. Start Atlas with the normal BAT launcher. Open **http://127.0.0.1:8770/installer**
   in Edge or Chrome under your normal Windows account. Keep using the same
   address and port; `localhost` is a different browser origin.
2. In **Live Inbox**, click **Install Atlas app**, then confirm the browser's
   installation dialog. If it is unavailable, use Edge's Apps menu or its address
   bar install icon. Organization policy may disable web-app installation.
3. Use **Atlas desktop alerts** to opt in to Windows notifications and accept the
   browser prompt. This is separate from the notification watcher, which reads
   selected Teams/Outlook notifications with the native companion's permission.

The installed app uses the same Classic/Desktop preference and GUI. It gives
Atlas its own window and taskbar entry; it does not install or start the Python
server. Keep using the elevated Atlas launcher (`x01426046_dsk`) and the normal
mail user's collector task (`x01426046`). If the server is stopped, the app shows
startup instructions and a Retry link. A PWA cannot read another app's Windows
notifications or replace the native collectors.

Alerts poll a count-only local endpoint every five seconds while an Atlas window
is open, including minimized. Browser suspension, Do Not Disturb and organization
settings can delay or silence delivery. Closing all Atlas windows stops app
alerts; collector capture can continue until Stop Atlas. There is no cloud push
provider or closed-app background polling in this release.

The alert shows a new-item count, without names or message bodies. Clicking it
focuses Atlas and opens Live Inbox. Old items are skipped when enabling or opening
alerts. Concurrent windows in the same browser profile share a lock and cursor
to avoid duplicate alerts. Different browser profiles/origins have independent
settings. The service worker stores no UI, mail or API response cache; browser
storage contains only the alert preference and numeric cursor. Demo/Preview do
not expose the app capability or arrival-count endpoint.

OpenFin is a possible later wrapper if the workstation already has an approved
OpenFin deployment. Its runtime and Notification Center integration are separate
from a PWA; neither wrapper grants access to Outlook or Teams. No OpenFin runtime
or dependency is included here.

References: [Edge PWA installation](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/),
[Edge app notifications](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/notifications-badges),
[OpenFin Notification Center](https://developer.openfin.co/docs/services/notifications/stable/api/index.html).

## Accounts, data and control

`data/inbox-integration.json` stores local account names, paths and the task name;
it is ignored by Git and preserved by `Update-Atlas.bat`. No per-PC values are
committed. After moving the checkout, stop collectors and reconnect from the new
path to update the task action. Reconfiguration is allowed once its agent exits.

For different accounts, `%ProgramData%\Atlas\OutlookBridge\<mail-SID>` gives the
normal account Modify, the Atlas account ReadAndExecute, and SYSTEM FullControl.
Atlas's API opens SQLite read-only. A separate protected
`%ProgramData%\Atlas\InboxControl\<installation-id>` lets Atlas write desired
source states while the normal user has read access. The normal-user supervisor
accepts only start/stop/show and source preferences; it writes its own heartbeat
and bounded listener commands to the queue. No command field can name an
executable, script, recipient or remote machine.

Demo and hosted Preview show an Admin-only explanation and never request mail,
collector status or control APIs. Admin's loopback, host and origin checks apply
to these routes. Mail and notification text are never included in preview sync,
source uploads or the notification package.

## Installation package and troubleshooting

The repository includes a compiled development folder under
`notification-listener/package` and a validated **unsigned** MSIX under
`notification-listener`. The unsigned MSIX needs your organization's approved
signing/deployment process before production installation. Its publisher must
match the signing certificate. The installer can register the development
folder only where Developer Mode is already enabled.

To rebuild, run `Build-Notification-Listener.ps1`; add `-MakeAppxPath` pointing to
the Windows SDK's x64 `makeappx.exe` to create the unsigned MSIX in `output`.
Use `-Publisher` for your signing identity and `-IncludeTests` for native writer
tests. Build output is ignored by Git. The checked-in package has a SHA-256
manifest tying it to the listener sources.
After rebuilding both the loose folder and MSIX, run
`py -3.12 scripts/package_notification_listener.py` to refresh those distributable
files and their manifest. `tests/test_inbox_package.py` rejects stale packages.

- **Task never connects:** confirm the normal account is signed in, the configured
  Python and Atlas folder are readable by it, and inspect the saved
  `Atlas-Inbox-...` task's Last Run Result in Task Scheduler.
- **pywin32 missing:** install `requirements-outlook.txt` using the exact Python
  selected in Live Inbox, under the normal account.
- **Package missing / permission required:** install the signed package in the
  normal account, then use Listener settings. Subsequent Atlas starts reuse an
  existing grant and run the listener in the tray.
- **No Teams previews:** only notifications actually exposed to Windows are
  available. Hidden previews, app-only banners and notifications cleared between
  polls cannot supply complete messages. This is not a full Teams connector.
- **Changing accounts/Python:** Stop collectors, wait for shutdown, then use
  **Sources and connection > Change connection**. The equivalent script is
  `Configure-Inbox-Integration.ps1 -MailUser 'DOMAIN\user' -PythonPath 'C:\Python312\python.exe'`
  from the elevated Atlas account and relaunch Atlas. Old queues are retained.

Validation covers queue migration, sender matching, NTFS read-only handoff,
control/task definitions, duplicate starts, cooperative stop, source failures,
compiled GUI controls and simulated notifications. Actual work-PC policies,
the two domain accounts and notification consent still require on-device testing.
