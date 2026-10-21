# Atlas Companion

Atlas Admin runs elevated under a separate, otherwise empty account (for example `x01426046_dsk`).
That account cannot see your Outlook or your clipboard. The **Atlas Companion** is a small tray app
you run in your **normal** Windows account (`x01426046`). It collects those two things and sends
them to Atlas Admin on this PC. Atlas keeps doing the admin work; the Companion only collects.

| The Companion does | Atlas Admin does |
| --- | --- |
| Listens to the Windows clipboard: every copy, even with Atlas closed | Keeps the clipboard history and works out machines, people, desks, tickets |
| Reads new classic Outlook mail in your session (when switched on) | Shows it in Live Inbox with sender, machines and request |
| Tray icon: Open Atlas, Pause clipboard, Quit | Settings: clipboard on/off (Clipboard drawer), Outlook on/off (Live Inbox) |

## Set up (once)

1. Start Atlas Admin as usual (elevated). On start it writes the Companion's connection file to
   `%ProgramData%\Atlas\Companion\connection.json`: the local address and a Companion key.
2. In your normal account (not "Run as administrator"), double-click
   **Install-Atlas-Companion.bat** in the Atlas folder. It installs pywin32 for your account
   (Python 3.12 must be runnable by that account, see `Python_Settings.bat`) and asks whether the
   Companion should start when you sign in. It then starts the Companion.
3. Look for the clipboard icon in the notification area. In Atlas, the **Clipboard** drawer
   shows **Companion connected · DOMAIN\you**.

Afterwards, **Start-Atlas-Companion.bat** starts it (or it starts at sign-in). Quit it from the
tray icon. Atlas and the Companion can start in any order: each waits for the other.

## Clipboard

- Every copy goes to Atlas: text, a screenshot copied with Win+Shift+S (read with Windows text
  recognition in Atlas), or copied files (their paths). The same copy twice is sent once.
- Copies that password managers and Windows mark as private (`ExcludeClipboardContentFromMonitorProcessing`,
  `CanIncludeInClipboardHistory = 0`) are skipped and never leave your session.
- **Pause clipboard** in the tray menu stops capture until you resume it. **Capture my clipboard**
  in the Clipboard drawer turns it off from Atlas.
- While the Companion captures, the browser's "Capture when I come back" is not needed and is
  greyed out.

## Outlook (Live Inbox)

- Turn on **Email watcher** in Live Inbox. Once a Companion has connected, that switch controls the
  Companion's Outlook watcher instead of the older normal-user collectors. Live Inbox then reads
  the mail the Companion sends.
- Classic Outlook must be open in your normal account. Mail from the last 24 hours is picked up
  on the first run, then new mail every 15 seconds. The Companion keeps its own checkpoint in
  `%LOCALAPPDATA%\Atlas\Companion\mail`, so nothing is sent twice and nothing is lost while Atlas
  is closed: it is sent when Atlas is back.

## Teams (Live Inbox)

- Turn on **Notification watcher** in Live Inbox. The Companion then starts the Atlas Notification
  Listener app in your session, pointed at its own queue, and sends its Teams previews (and Outlook
  previews, with **Include Outlook previews alongside Teams** under Collectors and alerts) to Live Inbox with the mail. Either switch works on
  its own: Teams without Outlook is fine.
- The listener is a Windows app because Windows only lets installed apps read notifications. It
  must be installed once for your account with your organisation's signed
  `Atlas.NotificationListener.msix`: run **Install-Inbox-Collectors.bat** with its path. Until then
  the Clipboard drawer and the tray menu say **Teams: listener app not installed**.
- The first time, Windows asks for notification access: in Live Inbox press **Listener settings**
  (the Companion shows the listener window), then **Allow access and start**.
- Previews are what Windows shows: text can be cut short or hidden by your notification settings.

## Things Atlas asks the Companion to do

Atlas runs under another account, so anything that needs *your* Outlook, Teams or sign-ins is done
by the Companion, only when you click:

| In Atlas | In your session |
| --- | --- |
| Live Inbox **Reply…** → **Open reply in Outlook** | Outlook opens a reply (or reply all) to the original email, with your text above the quoted message. You check it and press **Send**: the Companion never sends mail. |
| **Open in Outlook** | The original email opens in Outlook, with its attachments and thread. |
| **Mark done** | The email is marked read and gets the Outlook category **Atlas: done** (removed again by **reopen**). |
| **Teams chat**, **Teams call**, **Email** (Person), **Reply in Teams chat** | Teams or Outlook opens, signed in as you. A Teams reply opens the chat with your text ready to send. |
| Deployments, bulk deployments and queues finishing | A Windows alert from the Companion's tray icon. Click it to open Atlas. Several results together become one alert. Switch off with **Windows alerts** in the Clipboard drawer. |

Only web, Teams, mail and phone links are ever opened, never files or programs.

## Files and security

- `%ProgramData%\Atlas\Companion\connection.json` (written by Atlas): the address `http://127.0.0.1:8770`
  and the Companion key. The key only opens Atlas's routes for the Companion
  (`/api/companion/hello`, `clipboard`, `image`, `mail`, `poll` and command results). It cannot run
  remote actions, deployments or scripts, change settings, or read anything back. Commands go one
  way: Atlas (your admin session) asks, the Companion does the listed actions in your session and
  reports back. The Companion only connects to Atlas on this PC.
- `%LOCALAPPDATA%\Atlas\Companion\` (your account): the Outlook and Teams checkpoint queue
  (`mail\`, shared with the notification listener) and `companion.log`. The log never contains
  clipboard, mail or notification content.
- In Atlas: clipboard items in `data\clipboard-history.json`, Companion mail in
  `data\companion-inbox\`, settings in `data\companion-state.json` (or the configured database folder).

## Troubleshooting

- **"Run the Atlas Companion as yourself"**: you started it elevated. Close it and double-click
  `Start-Atlas-Companion.bat` from your normal desktop.
- **Drawer says "Companion not running"**: start it, or check `%LOCALAPPDATA%\Atlas\Companion\companion.log`.
- **Tray tooltip says "waiting for Atlas"**: Atlas Admin is not running, or `connection.json`
  could not be read. Start Atlas Admin once.
- **Outlook: waiting for classic Outlook**: open classic Outlook (not the new Outlook) in your
  normal account.
- **Teams: listener app not installed**: install the signed listener once (see Teams above).
- **Teams: permission required**: press **Listener settings** in Live Inbox and allow access.
- **"Update the Atlas Companion"** in Atlas: the running Companion is version 1.0. Quit it from the
  tray and start it again so Outlook replies, Teams and alerts work.
- After updating Atlas, quit the Companion from the tray and start it again.
