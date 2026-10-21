[CmdletBinding()]
param([Parameter(Mandatory)][string]$Computer, [ValidateRange(1, 30)][int]$Days = 7, [switch]$Updates)
# One-click PC check-up for Live Inbox (support_tools.py). Read-only; each section is independent, so
# a blocked part (for example the ConfigMgr client) never hides the others.
# Light on the PC: event logs are read through its Event Log service with the filter (log, event IDs,
# date, a maximum count) applied there, not record by record through WMI. Only when remote event log
# access is blocked does it fall back to WMI, limited to 7 days. Installed updates come from the same
# event log; the slow hotfix list (Win32_QuickFixEngineering) is read only with -Updates.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = [ordered]@{ ok = $true; computer = $Computer.ToUpperInvariant(); checked_at = [datetime]::UtcNow.ToString('o'); days = $Days; errors = @() }
$wmi = @{ ComputerName = $Computer; ErrorAction = 'Stop' }

function Section([string]$name, [scriptblock]$block) {
    try { $result[$name] = & $block }
    catch { $result[$name] = $null; $result.errors += "${name}: $($_.Exception.Message)" }
}
function Latest($rows) {
    $row = @($rows) | Sort-Object Time -Descending | Select-Object -First 1
    if ($row) { return $row.Time.ToUniversalTime().ToString('o') }
    return $null
}
$script:eventlog = $null  # $true once the Event Log service answered, $false after it refused.
# Events as {Id, Provider, Time, App}, newest first, filtered on the PC.
function Events([string]$log, [int[]]$ids, [datetime]$from, [int]$max, [string]$provider = '') {
    if ($script:eventlog -ne $false) {
        $filter = @{ LogName = $log; Id = $ids }
        if ($from -gt [datetime]::MinValue) { $filter.StartTime = $from }
        if ($provider) { $filter.ProviderName = $provider }
        try {
            $found = @(Get-WinEvent -ComputerName $Computer -FilterHashtable $filter -MaxEvents $max -ErrorAction Stop)
            $script:eventlog = $true
            return @($found | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Provider = $_.ProviderName; Time = $_.TimeCreated; App = [string](@($_.Properties)[0].Value) } })
        } catch {
            if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { $script:eventlog = $true; return @() }
            if ($script:eventlog) { throw }
            $script:eventlog = $false  # The Event Log service is not reachable: WMI, over a shorter period.
        }
    }
    $start = [Management.ManagementDateTimeConverter]::ToDmtfDateTime([datetime]::Now.AddDays(-[Math]::Min($Days, 7)))
    $where = "Logfile='$log' AND TimeWritten >= '$start' AND (" + (($ids | ForEach-Object { "EventCode=$_" }) -join ' OR ') + ')'
    @(Get-WmiObject Win32_NTLogEvent @wmi -Filter $where | Select-Object -First $max | ForEach-Object {
        [pscustomobject]@{ Id = [int]$_.EventCode; Provider = [string]$_.SourceName; Time = [Management.ManagementDateTimeConverter]::ToDateTime($_.TimeWritten); App = [string](@($_.InsertionStrings) | Select-Object -First 1) } })
}

Section 'session' {
    $system = Get-WmiObject Win32_ComputerSystem @wmi
    $os = Get-WmiObject Win32_OperatingSystem @wmi
    $users = @(Get-WmiObject Win32_Process -Filter "Name='explorer.exe'" @wmi | ForEach-Object {
        $owner = $_.GetOwner(); if ($owner.User) { "$($owner.Domain)\$($owner.User)" } } | Sort-Object -Unique)
    $boot = $os.ConvertToDateTime($os.LastBootUpTime)
    [ordered]@{ console_user = [string]$system.UserName; users = $users; last_boot = $boot.ToUniversalTime().ToString('o')
                uptime_hours = [math]::Round(((Get-Date) - $boot).TotalHours, 1); model = [string]$system.Model }
}

Section 'events' {
    $from = (Get-Date).AddDays(-$Days)
    $system = @(Events 'System' @(6008, 41, 1001, 7, 51, 153, 129) $from 200)
    $application = @(Events 'Application' @(1000, 1002) $from 300)
    $shutdowns = @($system | Where-Object { $_.Id -in 6008, 41 })
    $bluescreens = @($system | Where-Object { $_.Id -eq 1001 -and $_.Provider -match 'BugCheck|WER-SystemErrorReporting' })
    $disk = @($system | Where-Object { $_.Id -in 7, 51, 153, 129 })
    $apps = @($application | Group-Object App | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object {
        [ordered]@{ app = $_.Name; crashes = @($_.Group | Where-Object Id -eq 1000).Count; hangs = @($_.Group | Where-Object Id -eq 1002).Count; last = Latest $_.Group } })
    [ordered]@{ source = if ($script:eventlog -eq $false) { 'wmi' } else { 'eventlog' }; days = if ($script:eventlog -eq $false) { [Math]::Min($Days, 7) } else { $Days }
                unexpected_shutdowns = [ordered]@{ count = $shutdowns.Count; last = Latest $shutdowns }
                bluescreens = [ordered]@{ count = $bluescreens.Count; last = Latest $bluescreens }
                disk_errors = [ordered]@{ count = $disk.Count; last = Latest $disk }
                app_problems = $apps }
}

Section 'pending_reboot' {
    $registry = Get-WmiObject -List StdRegProv -Namespace root\default @wmi
    $machine = [uint32]2147483650  # HKEY_LOCAL_MACHINE
    $reasons = @()
    if ($registry.EnumKey($machine, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending').ReturnValue -eq 0) { $reasons += 'Windows component servicing' }
    if ($registry.EnumKey($machine, 'SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired').ReturnValue -eq 0) { $reasons += 'Windows Update' }
    $rename = $registry.GetMultiStringValue($machine, 'SYSTEM\CurrentControlSet\Control\Session Manager', 'PendingFileRenameOperations')
    if ($rename.ReturnValue -eq 0 -and @($rename.sValue).Count) { $reasons += 'Files waiting to be replaced' }
    try {
        $client = Invoke-WmiMethod -Namespace root\ccm\ClientSDK -Class CCM_ClientUtilities -Name DetermineIfRebootPending @wmi
        if ($client.RebootPending -or $client.IsHardRebootPending) { $reasons += 'Software Center' }
    } catch { }  # No ConfigMgr client on this PC.
    [ordered]@{ pending = [bool]$reasons.Count; reasons = $reasons }
}

Section 'updates' {
    # "Installation Successful" (Windows Update client event 19): the newest 50, filtered on the PC.
    if ($script:eventlog -ne $false) {
        $installed = @(Events 'System' @(19) ([datetime]::MinValue) 50 'Microsoft-Windows-WindowsUpdateClient')
        if ($script:eventlog) {
            $recent = @($installed | Select-Object -First 6 | ForEach-Object {
                $kb = if ($_.App -match 'KB\d{6,8}') { $Matches[0] } else { '' }
                [ordered]@{ kb = $kb; description = $_.App; installed = $_.Time.ToString('yyyy-MM-dd') } })
            return [ordered]@{ source = 'eventlog'; last_installed = if ($installed) { $installed[0].Time.ToString('yyyy-MM-dd') } else { $null }
                               last_30_days = @($installed | Where-Object { $_.Time -ge (Get-Date).AddDays(-30) }).Count; recent = $recent }
        }
    }
    if (!$Updates) { return [ordered]@{ skipped = $true } }  # The hotfix list is slow; read it when asked.
    $parsed = @(Get-WmiObject Win32_QuickFixEngineering @wmi | ForEach-Object {
        $date = $null
        foreach ($format in 'M/d/yyyy', 'MM/dd/yyyy', 'yyyyMMdd', 'd/M/yyyy') {
            try { $date = [datetime]::ParseExact([string]$_.InstalledOn, $format, [Globalization.CultureInfo]::InvariantCulture); break } catch { }
        }
        if ($date) { [pscustomobject]@{ kb = [string]$_.HotFixID; description = [string]$_.Description; installed = $date } }
    } | Sort-Object installed -Descending)
    [ordered]@{ source = 'hotfix'; last_installed = if ($parsed) { $parsed[0].installed.ToString('yyyy-MM-dd') } else { $null }
                last_30_days = @($parsed | Where-Object { $_.installed -ge (Get-Date).AddDays(-30) }).Count
                recent = @($parsed | Select-Object -First 6 | ForEach-Object { [ordered]@{ kb = $_.kb; description = $_.description; installed = $_.installed.ToString('yyyy-MM-dd') } }) }
}

Section 'network' {
    $adapters = @{}
    foreach ($adapter in @(Get-WmiObject Win32_NetworkAdapter -Filter 'NetEnabled=TRUE' @wmi)) { $adapters[[int]$adapter.Index] = $adapter }
    @(Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=TRUE' @wmi | ForEach-Object {
        $adapter = $adapters[[int]$_.Index]
        [ordered]@{ name = if ($adapter -and $adapter.NetConnectionID) { [string]$adapter.NetConnectionID } else { [string]$_.Description }
                    description = [string]$_.Description; ip = @($_.IPAddress); gateway = @($_.DefaultIPGateway); dns = @($_.DNSServerSearchOrder)
                    mac = [string]$_.MACAddress; dhcp = [bool]$_.DHCPEnabled; suffix = [string]$_.DNSDomain
                    speed_mbps = if ($adapter -and $adapter.Speed) { [math]::Round([double]$adapter.Speed / 1e6) } else { $null } } })
}

if ($result.errors.Count -eq 5) { $result.ok = $false; $result.error = 'The PC did not answer any check: ' + ($result.errors -join ' | ') }
$result | ConvertTo-Json -Depth 6 -Compress
