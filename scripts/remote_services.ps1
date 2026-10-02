param(
    [Parameter(Mandatory = $true)][string]$Computer,
    [ValidateSet('list', 'stop')][string]$Action = 'list',
    [string]$Name = '',
    [string]$ExpectedIdentity = ''
)
$ErrorActionPreference = 'Stop'

function Get-ServiceIdentity($Service) {
    # Detect a replaced/reconfigured service before issuing control commands.
    $value = [string]$Service.Name + "`n" + [string]$Service.PathName + "`n" + [string]$Service.ServiceType + "`n" + [string]$Service.StartName
    $hash = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value)))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Get-StopReason($Service) {
    if ($Service.Name -in @('RpcSs', 'DcomLaunch', 'RpcEptMapper', 'Winmgmt', 'WinRM', 'LanmanServer', 'EventLog')) {
        return 'Required for Windows or remote administration'
    }
    if ($Service.State -notin @('Running', 'Paused')) { return 'Service is not running or paused' }
    if (-not $Service.AcceptStop) { return 'Windows does not allow this service to be stopped' }
    return ''
}
function Write-StopResult($Outcome, $Service, $Message, $Code = $null) {
    @{ok = $true; computer = $Computer; name = $Name; outcome = $Outcome; state = $(if ($Service) { [string]$Service.State } else { '' }); message = $Message; code = $Code} | ConvertTo-Json -Compress
}
try {
    # Exact name comparison avoids building WQL from service names.
    $services = @(Get-WmiObject -ComputerName $Computer -Class Win32_Service -ErrorAction Stop)
    if ($Action -eq 'list') {
        $items = @($services | Sort-Object DisplayName, Name | ForEach-Object {
            $reason = Get-StopReason $_
            @{name = [string]$_.Name; display_name = [string]$_.DisplayName; state = [string]$_.State; start_mode = [string]$_.StartMode; pid = [long]$_.ProcessId; can_stop = (-not $reason); stop_reason = $reason; identity = (Get-ServiceIdentity $_)}
        })
        @{ok = $true; computer = $Computer; collected_at = [DateTime]::UtcNow.ToString('o'); items = $items} | ConvertTo-Json -Depth 4 -Compress
        return
    }
    if (-not $Name -or $ExpectedIdentity -notmatch '^[a-f0-9]{64}$') { throw 'Refresh services before choosing a service to stop' }
    $service = $services | Where-Object { $_.Name -ieq $Name } | Select-Object -First 1
    if (-not $service) { Write-StopResult 'gone' $null 'Service is no longer installed. Refresh services.'; return }
    $service.Get()
    if ((Get-ServiceIdentity $service) -cne $ExpectedIdentity) { Write-StopResult 'changed' $service 'Service configuration changed. Refresh services before stopping it.'; return }
    # Protection is enforced here as well as in the rendered list.
    if ($service.Name -in @('RpcSs', 'DcomLaunch', 'RpcEptMapper', 'Winmgmt', 'WinRM', 'LanmanServer', 'EventLog')) {
        Write-StopResult 'blocked' $service 'Required for Windows or remote administration'; return
    }
    if ($service.State -eq 'Stopped') { Write-StopResult 'already_stopped' $service 'Service is already stopped.'; return }
    $reason = Get-StopReason $service
    if ($reason) { Write-StopResult 'blocked' $service $reason; return }
    # Service control only: never kill a shared host process or stop dependencies.
    $code = [int]$service.StopService().ReturnValue
    if ($code -notin @(0, 6)) {
        $messages = @{1 = 'Stop is not supported'; 2 = 'Access denied'; 3 = 'Dependent services are running; they were not stopped'; 4 = 'Invalid service control'; 5 = 'Service cannot accept control'; 7 = 'Windows service control timed out'; 8 = 'Unknown Windows service failure'; 9 = 'Service executable was not found'}
        $message = $messages[$code]
        if (-not $message) { $message = "Windows rejected the stop request (code $code)" }
        Write-StopResult 'failed' $service $message $code; return
    }
    for ($i = 0; $i -lt 40; $i++) {
        $service.Get()
        if ((Get-ServiceIdentity $service) -cne $ExpectedIdentity) { Write-StopResult 'changed' $service 'Service configuration changed while waiting. Refresh services; the outcome may be unknown.' $code; return }
        if ($service.State -eq 'Stopped') { Write-StopResult 'stopped' $service 'Service stopped.' $code; return }
        Start-Sleep -Milliseconds 250
    }
    Write-StopResult 'pending' $service 'Stop was accepted, but Stopped was not verified. Refresh services to check the current state.' $code
} catch {
    @{ok = $false; computer = $Computer; error = $_.Exception.Message} | ConvertTo-Json -Compress
}
