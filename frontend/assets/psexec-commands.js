/* Local command templates. Building or copying a command never executes it. */
(() => {
  const service = {
    key: "service",
    label: "Service name (not display name)",
    placeholder: "Spooler",
    pattern: /^[A-Za-z0-9_.$-]{1,128}$/,
  };
  const destination = {
    key: "destination",
    label: "Destination hostname or IPv4",
    placeholder: "SERVER01",
    pattern: /^(?![-.])(?!.*\.\.)[A-Za-z0-9_.-]{1,253}$/,
  };
  const pid = {
    key: "pid",
    label: "Excel process ID",
    placeholder: "1234",
    pattern: /^[1-9][0-9]{0,9}$/,
  };
  const commands = [
    {
      id: "identity",
      category: "Diagnostics",
      title: "Check execution identity",
      description: "See the account and groups used on the remote machine.",
      args: ["whoami.exe", "/all"],
      insight:
        "Use this to confirm the execution context before investigating an access problem.",
    },
    {
      id: "sessions",
      category: "Sessions & Excel",
      title: "Logged-on sessions",
      description: "List session IDs, users and active/disconnected state.",
      args: ["query.exe", "user"],
      insight:
        "Session IDs identify Windows sessions. Disconnected does not mean safe to log off.",
    },
    {
      id: "session-detail",
      category: "Sessions & Excel",
      title: "Session connection states",
      description: "Inspect console and remote session names and states.",
      args: ["query.exe", "session"],
      insight:
        "Useful alongside logged-on sessions when checking the machine hosting a Citrix desktop.",
    },
    {
      id: "excel",
      category: "Sessions & Excel",
      title: "Excel process snapshot",
      description:
        "List Excel instances, sessions, resident RAM, CPU time and thread counts.",
      script:
        "Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object Id,SessionId,@{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='CPU_seconds';e={$_.CPU}},@{n='Threads';e={$_.Threads.Count}},Responding | Format-Table -AutoSize",
      insight:
        "CPU seconds are cumulative, not CPU utilization. Use Remote Admin CPU for a sampled percentage. Responding is not a diagnosis of workbook health.",
    },
    {
      id: "processes",
      category: "Diagnostics",
      title: "Processes and session owners",
      description:
        "List running processes with session, user and memory information.",
      args: ["tasklist.exe", "/v", "/fo", "table"],
      insight:
        "Tasklist is a snapshot; it does not provide current CPU or GPU utilization.",
    },
    {
      id: "memory",
      category: "Diagnostics",
      title: "Largest memory consumers",
      description:
        "Show the 20 largest resident working sets with private memory and handles.",
      script:
        "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Name,Id,@{n='RAM_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}},@{n='Private_MB';e={[math]::Round($_.PrivateMemorySize64/1MB,1)}},Handles | Format-Table -AutoSize",
      insight:
        "Shared memory can appear in several processes. Do not add working sets to calculate total RAM usage.",
    },
    {
      id: "uptime",
      category: "Diagnostics",
      title: "Windows boot time and uptime",
      description: "Get the last boot time, OS version and elapsed uptime.",
      script:
        "$os=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{Windows=$os.Caption;Version=$os.Version;LastBoot=$os.LastBootUpTime;Uptime=((Get-Date)-$os.LastBootUpTime).ToString()} | Format-List",
      insight:
        "This executes one local CIM query on the target after PsExec connects.",
    },
    {
      id: "space",
      category: "Diagnostics",
      title: "Disk free space",
      description: "Show fixed volumes, capacity and free space in GiB.",
      script:
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,@{n='Size_GiB';e={[math]::Round($_.Size/1GB,1)}},@{n='Free_GiB';e={[math]::Round($_.FreeSpace/1GB,1)}} | Format-Table -AutoSize",
      insight:
        "Capacity is not disk latency. Use Overview in Remote Admin for sampled disk response times.",
    },
    {
      id: "app-errors",
      category: "Diagnostics",
      title: "Recent application errors",
      description:
        "Read the latest 30 application errors from the last 24 hours.",
      script:
        "Get-WinEvent -FilterHashtable @{LogName='Application';Level=1,2;StartTime=(Get-Date).AddDays(-1)} -MaxEvents 30 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,ProviderName,Message | Format-List",
      insight:
        "Event messages may include workbook paths or user details. Review output before sharing a ticket.",
    },
    {
      id: "system-errors",
      category: "Diagnostics",
      title: "Recent system errors",
      description: "Read the latest 30 system errors from the last 24 hours.",
      script:
        "Get-WinEvent -FilterHashtable @{LogName='System';Level=1,2;StartTime=(Get-Date).AddDays(-1)} -MaxEvents 30 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,ProviderName,Message | Format-List",
      insight:
        "Match timestamps to the reported issue; an old error may be unrelated.",
    },
    {
      id: "ip",
      category: "Networking",
      title: "IP and DNS configuration",
      description:
        "Inspect adapters, IP addresses, DNS servers and DHCP configuration.",
      args: ["ipconfig.exe", "/all"],
      insight:
        "Shows the remote machine configuration, not the local kiosk configuration.",
    },
    {
      id: "dns",
      category: "Networking",
      title: "Resolve a hostname from the target",
      description: "Check DNS resolution from the remote machine.",
      fields: [destination],
      args: (v) => ["nslookup.exe", v.destination],
      insight: "Compare the answer with the affected application destination.",
    },
    {
      id: "tcp",
      category: "Networking",
      title: "Test a destination TCP port",
      description:
        "Test one TCP connection from the target, for example to a file server.",
      fields: [
        destination,
        {
          key: "port",
          label: "TCP port",
          placeholder: "445",
          pattern: /^[0-9]{1,5}$/,
        },
      ],
      script: (v) =>
        `Test-NetConnection -ComputerName '${v.destination}' -Port ${Number(v.port)} -InformationLevel Detailed`,
      insight:
        "A successful TCP connection does not prove application performance. Test duration depends on the network timeout.",
    },
    {
      id: "connections",
      category: "Networking",
      title: "Connections and listening ports",
      description: "Show current TCP/UDP endpoints and their process IDs.",
      args: ["netstat.exe", "-ano"],
      insight:
        "Match the PID with the process list. Listening ports alone do not establish a problem.",
    },
    {
      id: "routes",
      category: "Networking",
      title: "Routing table",
      description: "Inspect routes and interfaces used by the remote machine.",
      args: ["route.exe", "print"],
      insight:
        "Useful when a destination is reached through an unexpected interface or gateway.",
    },
    {
      id: "services",
      category: "Services",
      title: "List services",
      description: "List service names, display names and current state.",
      script:
        "Get-Service | Sort-Object Status,Name | Format-Table Status,Name,DisplayName -AutoSize",
      insight:
        "Use the service name, not its display name, in the service-specific templates.",
    },
    {
      id: "service",
      category: "Services",
      title: "Inspect one service",
      description:
        "Read status, start mode, executable, account and PID for a named service.",
      fields: [service],
      script: (v) =>
        `Get-CimInstance Win32_Service -Filter 'Name=''${v.service}''' | Select-Object Name,DisplayName,State,StartMode,StartName,ProcessId,PathName | Format-List`,
      insight:
        "The configured service account is not necessarily the identity running this diagnostic.",
    },
    {
      id: "dns-flush",
      category: "Repairs",
      title: "Flush the DNS cache",
      description: "Clear cached DNS answers on the target.",
      args: ["ipconfig.exe", "/flushdns"],
      change: true,
      insight:
        "Changes the target DNS cache. Applications may need to resolve names again; this does not change DNS server settings.",
    },
    {
      id: "restart-service",
      category: "Repairs",
      title: "Restart one service",
      description:
        "Stop and start a specific service after reviewing its dependencies.",
      fields: [service],
      script: (v) =>
        `Restart-Service -Name '${v.service}' -ErrorAction Stop; Get-Service -Name '${v.service}' | Format-Table Status,Name,DisplayName -AutoSize`,
      change: true,
      insight:
        "Interrupts clients of the selected service. Does not force dependent services to stop. Agree the interruption with the affected users first.",
    },
    {
      id: "policy",
      category: "Repairs",
      title: "Refresh computer Group Policy",
      description:
        "Reapply computer policy and wait up to 60 seconds for its status.",
      args: ["gpupdate.exe", "/target:computer", "/force", "/wait:60"],
      change: true,
      insight:
        "Reapplies policy on the target and can affect active work. It does not request an automatic reboot or logoff; some policies may still require one later.",
    },
    {
      id: "excel-stop",
      category: "Repairs",
      title: "End one Excel process",
      description:
        "Stop only a reviewed Excel PID, without targeting all Excel instances.",
      fields: [pid],
      script: (v) =>
        `$p=Get-Process -Id ${Number(v.pid)} -ErrorAction Stop; if($p.ProcessName -ne 'EXCEL'){throw 'This PID is not Excel'}; Stop-Process -InputObject $p -Confirm`,
      change: true,
      insight:
        "Can lose unsaved work. Recheck the PID before running and confirm in the terminal. For stronger creation-time identity checks, use Kill process in Remote Admin.",
      interactive: true,
    },
    {
      id: "shell",
      category: "Terminal",
      title: "Open a remote Command Prompt",
      description:
        "Start an interactive command session in your existing terminal.",
      args: ["cmd.exe"],
      insight:
        "The shell uses your current account. Type exit to close it. Commands you type can change the target; this is not the logged-on user’s desktop.",
      interactive: true,
    },
  ];
  function build(
    id,
    { target, path, shell = "powershell", elevated = false, values = {} },
  ) {
    const item = commands.find((c) => c.id === id);
    if (!item) throw Error("Choose a command.");
    target = String(target || "")
      .trim()
      .toUpperCase();
    if (!/^(?![-.])(?!.*\.\.)[A-Z0-9_.-]{1,64}$/.test(target))
      throw Error("Enter one valid hostname or IPv4 address.");
    path = String(path || "").trim();
    if (!/^[A-Za-z]:\\(?:[A-Za-z0-9 _.-]+\\)*PsExec(?:64)?\.exe$/i.test(path))
      throw Error(
        "Use a full local path ending in PsExec.exe or PsExec64.exe (for example C:\\Data\\PsExec.exe).",
      );
    if (!["powershell", "cmd"].includes(shell))
      throw Error("Choose PowerShell or Command Prompt.");
    const clean = {};
    for (const field of item.fields || []) {
      clean[field.key] = String(values[field.key] || "").trim();
      if (!field.pattern.test(clean[field.key]))
        throw Error("Enter a valid " + field.label.toLowerCase() + ".");
    }
    if (clean.port && (Number(clean.port) < 1 || Number(clean.port) > 65535))
      throw Error("TCP port must be between 1 and 65535.");
    if (clean.pid && Number(clean.pid) > 4294967295)
      throw Error("Enter a valid Windows process ID.");
    let script =
      typeof item.script === "function" ? item.script(clean) : item.script;
    if (script) script = "$ErrorActionPreference='Stop'; " + script;
    const args = typeof item.args === "function" ? item.args(clean) : item.args;
    // UTF-16LE avoids two shells reinterpreting pipes, quotes or dollar signs.
    const encoded = script
      ? btoa(
          Array.from(script, (c) =>
            String.fromCharCode(c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8),
          ).join(""),
        )
      : null;
    const remote = script
      ? [
          "powershell.exe",
          "-NoProfile",
          ...(item.interactive ? [] : ["-NonInteractive"]),
          "-EncodedCommand",
          encoded,
        ]
      : args;
    const tokens = [
      path,
      "\\\\" + target,
      "-n",
      "10",
      "-nobanner",
      ...(elevated ? ["-h"] : []),
      ...remote,
    ];
    const quote = (s) =>
      shell === "powershell"
        ? "'" + s.replace(/'/g, "''") + "'"
        : '"' + s + '"';
    return {
      command:
        (shell === "powershell" ? "& " : "") + tokens.map(quote).join(" "),
      readable: script || args.join(" "),
      encoded: !!script,
      target,
    };
  }
  window.AtlasPsExecCommands = Object.freeze({ commands, build });
})();
