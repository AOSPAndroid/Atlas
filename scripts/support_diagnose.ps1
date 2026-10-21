[CmdletBinding()]
param([Parameter(Mandatory)][string]$Computer, [ValidateRange(1, 30)][int]$Days = 7)
# One-click PC check-up for Live Inbox (support_tools.py). Read-only WMI queries; each section is
# independent, so a blocked part (for example the ConfigMgr client) never hides the others.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$result = [ordered]@{ ok = $true; computer = $Computer.ToUpperInvariant(); checked_at = [datetime]::UtcNow.ToString('o'); days = $Days; errors = @() }
$wmi = @{ ComputerName = $Computer; ErrorAction = 'Stop' }
$since = [Management.ManagementDateTimeConverter]::ToDmtfDateTime((Get-Date).AddDays(-$Days))

function Section([string]$name, [scriptblock]$block) {
    try { $result[$name] = & $block }
    catch { $result[$name] = $null; $result.errors += "${name}: $($_.Exception.Message)" }
}
function When($value) {
    if (!$value) { return $null }
    try { return ([Management.ManagementDateTimeConverter]::ToDateTime($value)).ToUniversalTime().ToString('o') } catch { return $null }
}
function Latest($rows) {
    $row = @($rows) | Sort-Object TimeWritten -Descending | Select-Object -First 1
    if ($row) { return When $row.TimeWritten }
    return $null
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
    $system = @(Get-WmiObject Win32_NTLogEvent @wmi -Filter ("Logfile='System' AND TimeWritten >= '$since' AND " +
        "(EventCode=6008 OR EventCode=41 OR EventCode=1001 OR EventCode=7 OR EventCode=51 OR EventCode=153 OR EventCode=129)"))
    $application = @(Get-WmiObject Win32_NTLogEvent @wmi -Filter "Logfile='Application' AND TimeWritten >= '$since' AND (EventCode=1000 OR EventCode=1002)")
    $shutdowns = @($system | Where-Object { $_.EventCode -in 6008, 41 })
    $bluescreens = @($system | Where-Object { $_.EventCode -eq 1001 -and $_.SourceName -match 'BugCheck|WER-SystemErrorReporting' })
    $disk = @($system | Where-Object { $_.EventCode -in 7, 51, 153, 129 })
    $apps = @($application | Group-Object { [string](@($_.InsertionStrings) | Select-Object -First 1) } | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object {
        [ordered]@{ app = $_.Name; crashes = @($_.Group | Where-Object EventCode -eq 1000).Count; hangs = @($_.Group | Where-Object EventCode -eq 1002).Count; last = Latest $_.Group } })
    [ordered]@{ unexpected_shutdowns = [ordered]@{ count = $shutdowns.Count; last = Latest $shutdowns }
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
    $parsed = @(Get-WmiObject Win32_QuickFixEngineering @wmi | ForEach-Object {
        $date = $null
        foreach ($format in 'M/d/yyyy', 'MM/dd/yyyy', 'yyyyMMdd', 'd/M/yyyy') {
            try { $date = [datetime]::ParseExact([string]$_.InstalledOn, $format, [Globalization.CultureInfo]::InvariantCulture); break } catch { }
        }
        if ($date) { [pscustomobject]@{ kb = [string]$_.HotFixID; description = [string]$_.Description; installed = $date } }
    } | Sort-Object installed -Descending)
    [ordered]@{ last_installed = if ($parsed) { $parsed[0].installed.ToString('yyyy-MM-dd') } else { $null }
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
