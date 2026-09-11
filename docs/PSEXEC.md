# PsExec command workbench

Open **IT Console → PsExec**, directly below **History**. This Admin-only page builds commands for your existing PsExec installation. It does not execute them, download PsExec, start scans or open remote sessions automatically.

1. Select a machine in Workspace, or enter a target hostname in the PsExec tab. **Follow selected target** uses the Workspace selection. Entering a different hostname creates a separate command target without changing the deployment target.
2. Check the executable path. The default is `C:\Data\PsExec.exe`; use `C:\Data\PsExec64.exe` if that is your executable. Atlas does not check whether that file exists on your admin computer.
3. Choose **PowerShell** or **Command Prompt** to match the terminal you will paste into.
4. Search or filter the templates, complete any parameters, and review **Command on target**. Expand **Full PsExec command** to inspect exactly what will be copied.
5. Click **Copy**, paste into your terminal and review before pressing Enter. Results appear there, not in Atlas History.

Star frequently used commands to find them under **Favourites**. Favourites, executable path and shell choice are saved in this browser. The target and command parameters are not saved. Elevated execution is off initially and resets when changing templates.

## Included templates

| Category | Commands |
| --- | --- |
| Diagnostics | Execution identity; processes and session owners; largest memory consumers; Windows boot time and uptime; disk free space; recent application and system errors |
| Sessions & Excel | Logged-on sessions; session connection states; Excel process snapshot |
| Networking | IP/DNS configuration; resolve a hostname from the target; test a destination TCP port; connections and listening ports; routing table |
| Services | List services; inspect one service's status, executable, account and PID |
| Repairs | Flush DNS; restart one service; refresh computer Group Policy; end one reviewed Excel PID with terminal confirmation |
| Terminal | Open a remote Command Prompt in your existing terminal |

Repairs are marked **Changes target** and explain their effects. Ending Excel can lose unsaved work. The Excel termination template checks that the PID belongs to Excel, but for creation-time identity checks use Remote Admin's existing process action.

## Reading and running commands

PowerShell templates show the readable script and use an encoded UTF-16LE payload in the copied invocation. This keeps pipes, quotes and dollar signs intact through the local and remote command interpreters. The script is visible for review; encoding is not encryption. Native Windows command templates use their executable and arguments directly.

Excel CPU time is cumulative seconds, not current CPU percentage. Tasklist and memory templates are snapshots. Use the [Remote Admin performance tools](REMOTE_ADMIN_PERFORMANCE.md) for sampled CPU/GPU utilization, thread measurements and a bounded slowness capture.

Commands use the current Windows account. The optional **Use elevated token (-h)** requests its elevated token where available; it does not supply credentials or grant missing rights. There is no automatic SYSTEM mode, password storage or automatic licence acceptance. Review Microsoft's licence prompt on first use. The `-n 10` option limits the connection attempt, not the command's runtime. See the [Microsoft PsExec reference](https://learn.microsoft.com/en-us/sysinternals/downloads/psexec).

PsExec starts a service on the remote target even for diagnostic commands. Remote permissions and administrative-share/service-control connectivity must be available. A connection failure is separate from a command reporting an error after it starts. This workbench introduces no remote execution endpoint in Atlas, and privileged tools remain excluded from Demo and the private read-only preview.
