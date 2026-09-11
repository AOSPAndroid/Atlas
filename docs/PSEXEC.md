# PsExec command workbench

Open **IT Console → PsExec**, directly below **History**. This Admin-only page builds commands for your existing PsExec installation. It does not execute them, download PsExec, start scans or open remote sessions automatically.

1. Select a machine in Workspace, or enter a target hostname in the PsExec tab. **Follow selected target** uses the Workspace selection. Entering a different hostname creates a separate command target without changing the deployment target.
2. Check the executable path. The default is `C:\Data\PsExec.exe`; use `C:\Data\PsExec64.exe` if that is your executable. Atlas does not check whether that file exists on your admin computer.
3. Choose **PowerShell** or **Command Prompt** to match the terminal you will paste into.
4. Search or filter the templates, complete any parameters, and review **Command on target**. Expand **Full PsExec command** to inspect exactly what will be copied.
5. Click **Copy**, paste into your terminal and review before pressing Enter. Results appear there, not in Atlas History.

Star frequently used commands to find them under **Favourites**. Favourites, executable path and shell choice are saved in this browser. The target and command parameters are not saved. Elevated execution is off initially and resets when changing templates.

## Included templates

| Template | Required input beyond the target | What it does |
| --- | --- | --- |
| **Check execution identity** | None | See the account and groups used on the remote machine. |
| **Logged-on sessions** | None | List session IDs, users and active/disconnected state. |
| **Session connection states** | None | Inspect console and remote session names and states. |
| **Excel process snapshot** | None | List Excel instances, sessions, resident RAM, CPU time and thread counts. |
| **Processes and session owners** | None | List running processes with session, user and memory information. |
| **Largest memory consumers** | None | Show the 20 largest resident working sets with private memory and handles. |
| **Windows boot time and uptime** | None | Get the last boot time, OS version and elapsed uptime. |
| **Disk free space** | None | Show fixed volumes, capacity and free space in GiB. |
| **Recent application errors** | None | Read the latest 30 application errors from the last 24 hours. |
| **Recent system errors** | None | Read the latest 30 system errors from the last 24 hours. |
| **IP and DNS configuration** | None | Inspect adapters, IP addresses, DNS servers and DHCP configuration. |
| **Resolve a hostname from the target** | Destination hostname or IPv4 | Check DNS resolution from the remote machine. |
| **Test a destination TCP port** | Destination hostname or IPv4; TCP port | Test one TCP connection from the target, for example to a file server. |
| **Connections and listening ports** | None | Show current TCP/UDP endpoints and their process IDs. |
| **Routing table** | None | Inspect routes and interfaces used by the remote machine. |
| **List services** | None | List service names, display names and current state. |
| **Inspect one service** | Service name (not display name) | Read status, start mode, executable, account and PID for a named service. |
| **Flush the DNS cache** | None | Clear cached DNS answers on the target. **Changes target.** |
| **Restart one service** | Service name (not display name) | Stop and start a specific service after reviewing its dependencies. **Changes target.** |
| **Refresh computer Group Policy** | None | Reapply computer policy and wait up to 60 seconds for its status. **Changes target.** |
| **End one Excel process** | Excel process ID | Stop only a reviewed Excel PID, without targeting all Excel instances. **Changes target.** |
| **Open a remote Command Prompt** | None | Start an interactive command session in your existing terminal. |

Repairs are marked **Changes target** and explain their effects. Ending Excel can lose unsaved work. The Excel termination template checks that the PID belongs to Excel, but for creation-time identity checks use Remote Admin's existing process action.

## Reading and running commands

PowerShell templates show the readable script and use an encoded UTF-16LE payload in the copied invocation. This keeps pipes, quotes and dollar signs intact through the local and remote command interpreters. The script is visible for review; encoding is not encryption. Native Windows command templates use their executable and arguments directly.

Excel CPU time is cumulative seconds, not current CPU percentage. Tasklist and memory templates are snapshots. Use the [Remote Admin performance tools](REMOTE_ADMIN_PERFORMANCE.md) for sampled CPU/GPU utilization, thread measurements and a bounded slowness capture.

Commands use the current Windows account. The optional **Use elevated token (-h)** requests its elevated token where available; it does not supply credentials or grant missing rights. There is no automatic SYSTEM mode, password storage or automatic licence acceptance. Review Microsoft's licence prompt on first use. The `-n 10` option limits the connection attempt, not the command's runtime. See the [Microsoft PsExec reference](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec).

PsExec starts a service on the remote target even for diagnostic commands. Remote permissions and administrative-share/service-control connectivity must be available. A connection failure is separate from a command reporting an error after it starts. This workbench introduces no remote execution endpoint in Atlas, and privileged tools remain excluded from Demo and the private read-only preview.


## Example: check who is logged on

Choose **Logged-on sessions**, enter your target, then copy the command for your terminal. For the fictional target `TESTPC`, Atlas produces:

**PowerShell:**

```powershell
& 'C:\Data\PsExec.exe' '\\TESTPC' '-n' '10' '-nobanner' 'query.exe' 'user'
```

**Command Prompt:**

```bat
"C:\Data\PsExec.exe" "\\TESTPC" "-n" "10" "-nobanner" "query.exe" "user"
```

Replace `TESTPC` with the machine you intend to inspect. The output appears in that terminal. To inspect a network destination instead, choose **Test a destination TCP port**, fill in its hostname and port, and generate a new command. To reuse a template, star it and select **Favourites**.

## Complete command reference

Below are the readable commands or PowerShell payloads used by all 22 templates. These are **commands for the target**, not complete local PsExec invocations. Use the workbench to add the target and executable path and generate the correctly quoted command for your terminal. PowerShell payloads are encoded in the full invocation.

Parameterized examples use `EXAMPLE_SERVICE`, `SERVER01`, port `445` and PID `1234`; these are illustrative values, not suggested targets. Enter the actual values in the workbench.

### Check execution identity

Diagnostics

See the account and groups used on the remote machine.

```bat
whoami.exe /all
```

Use this to confirm the execution context before investigating an access problem.

### Logged-on sessions

Sessions & Excel

List session IDs, users and active/disconnected state.

```bat
query.exe user
```

Session IDs identify Windows sessions. Disconnected does not mean safe to log off.

### Session connection states

Sessions & Excel

Inspect console and remote session names and states.

```bat
query.exe session
```

Useful alongside logged-on sessions when checking the machine hosting a Citrix desktop.

### Excel process snapshot

Sessions & Excel

List Excel instances, sessions, resident RAM, CPU time and thread counts.

```powershell
$ErrorActionPreference='Stop'; Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object Id,SessionId,@{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='CPU_seconds';e={$_.CPU}},@{n='Threads';e={$_.Threads.Count}},Responding | Format-Table -AutoSize
```

CPU seconds are cumulative, not CPU utilization. Use Remote Admin CPU for a sampled percentage. Responding is not a diagnosis of workbook health.

### Processes and session owners

Diagnostics

List running processes with session, user and memory information.

```bat
tasklist.exe /v /fo table
```

Tasklist is a snapshot; it does not provide current CPU or GPU utilization.

### Largest memory consumers

Diagnostics

Show the 20 largest resident working sets with private memory and handles.

```powershell
$ErrorActionPreference='Stop'; Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Name,Id,@{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='Private_MB';e={[math]::Round($_.PrivateMemorySize64/1MB,1)}},Handles | Format-Table -AutoSize
```

Shared memory can appear in several processes. Do not add working sets to calculate total RAM usage.

### Windows boot time and uptime

Diagnostics

Get the last boot time, OS version and elapsed uptime.

```powershell
$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{Windows=$os.Caption;Version=$os.Version;LastBoot=$os.LastBootUpTime;Uptime=((Get-Date)-$os.LastBootUpTime).ToString()} | Format-List
```

This executes one local CIM query on the target after PsExec connects.

### Disk free space

Diagnostics

Show fixed volumes, capacity and free space in GiB.

```powershell
$ErrorActionPreference='Stop'; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,@{n='Size_GiB';e={[math]::Round($_.Size/1GB,1)}},@{n='Free_GiB';e={[math]::Round($_.FreeSpace/1GB,1)}} | Format-Table -AutoSize
```

Capacity is not disk latency. Use Overview in Remote Admin for sampled disk response times.

### Recent application errors

Diagnostics

Read the latest 30 application errors from the last 24 hours.

```powershell
$ErrorActionPreference='Stop'; Get-WinEvent -FilterHashtable @{LogName='Application';Level=1,2;StartTime=(Get-Date).AddDays(-1)} -MaxEvents 30 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,ProviderName,Message | Format-List
```

Event messages may include workbook paths or user details. Review output before sharing a ticket.

### Recent system errors

Diagnostics

Read the latest 30 system errors from the last 24 hours.

```powershell
$ErrorActionPreference='Stop'; Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddDays(-1)} -MaxEvents 30 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,ProviderName,Message | Format-List
```

Match timestamps to the reported issue; an old error may be unrelated.

### IP and DNS configuration

Networking

Inspect adapters, IP addresses, DNS servers and DHCP configuration.

```bat
ipconfig.exe /all
```

Shows the remote machine configuration, not the local kiosk configuration.

### Resolve a hostname from the target

Networking

Check DNS resolution from the remote machine.

```bat
nslookup.exe SERVER01
```

Compare the answer with the affected application destination.

### Test a destination TCP port

Networking

Test one TCP connection from the target, for example to a file server.

```powershell
$ErrorActionPreference='Stop'; Test-NetConnection -ComputerName 'SERVER01' -Port 445 -InformationLevel Detailed
```

A successful TCP connection does not prove application performance. Test duration depends on the network timeout.

### Connections and listening ports

Networking

Show current TCP/UDP endpoints and their process IDs.

```bat
netstat.exe -ano
```

Match the PID with the process list. Listening ports alone do not establish a problem.

### Routing table

Networking

Inspect routes and interfaces used by the remote machine.

```bat
route.exe print
```

Useful when a destination is reached through an unexpected interface or gateway.

### List services

Services

List service names, display names and current state.

```powershell
$ErrorActionPreference='Stop'; Get-Service | Sort-Object Status,Name | Format-Table Status,Name,DisplayName -AutoSize
```

Use the service name, not its display name, in the service-specific templates.

### Inspect one service

Services

Read status, start mode, executable, account and PID for a named service.

```powershell
$ErrorActionPreference='Stop'; Get-CimInstance Win32_Service -Filter 'Name=''EXAMPLE_SERVICE''' | Select-Object Name,DisplayName,State,StartMode,StartName,ProcessId,PathName | Format-List
```

The configured service account is not necessarily the identity running this diagnostic.

### Flush the DNS cache

Repairs · **Changes target**

Clear cached DNS answers on the target.

```bat
ipconfig.exe /flushdns
```

Changes the target DNS cache. Applications may need to resolve names again; this does not change DNS server settings.

### Restart one service

Repairs · **Changes target**

Stop and start a specific service after reviewing its dependencies.

```powershell
$ErrorActionPreference='Stop'; Restart-Service -Name 'EXAMPLE_SERVICE' -ErrorAction Stop; Get-Service -Name 'EXAMPLE_SERVICE' | Format-Table Status,Name,DisplayName -AutoSize
```

Interrupts clients of the selected service. Does not force dependent services to stop. Agree the interruption with the affected users first.

### Refresh computer Group Policy

Repairs · **Changes target**

Reapply computer policy and wait up to 60 seconds for its status.

```bat
gpupdate.exe /target:computer /force /wait:60
```

Reapplies policy on the target and can affect active work. It does not request an automatic reboot or logoff; some policies may still require one later.

### End one Excel process

Repairs · **Changes target**

Stop only a reviewed Excel PID, without targeting all Excel instances.

```powershell
$ErrorActionPreference='Stop'; $p=Get-Process -Id 1234 -ErrorAction Stop; if($p.ProcessName -ne 'EXCEL'){throw 'This PID is not Excel'}; Stop-Process -InputObject $p -Confirm
```

Can lose unsaved work. Recheck the PID before running and confirm in the terminal. For stronger creation-time identity checks, use Kill process in Remote Admin.

### Open a remote Command Prompt

Terminal

Start an interactive command session in your existing terminal.

```bat
cmd.exe
```

The shell uses your current account. Type exit to close it. Commands you type can change the target; this is not the logged-on user’s desktop.
