# Simulated Win32_Service objects. No real provider or service control is used.
$ErrorActionPreference = 'Stop'
$global:AtlasServiceStops = [System.Collections.Generic.List[string]]::new()
$global:AtlasServiceChange = ''
function New-TestService($Name, $State = 'Running', $AcceptStop = $true, $Code = 0, $Pending = $false) {
    $s = [pscustomobject]@{Name = $Name; DisplayName = "Display $Name"; State = $State; StartMode = 'Auto'; ProcessId = 1234; AcceptStop = $AcceptStop; PathName = 'C:\Test\service.exe'; ServiceType = 'Own Process'; StartName = 'LocalSystem'; Code = $Code; Pending = $Pending; Requested = $false; Reads = 0}
    $s | Add-Member ScriptMethod Get {
        $this.Reads++
        if ($global:AtlasServiceChange -eq $this.Name) { $this.PathName = 'C:\Test\replacement.exe' }
        if ($this.Requested -and -not $this.Pending -and $this.Reads -ge 3) { $this.State = 'Stopped' }
    }
    $s | Add-Member ScriptMethod StopService {
        $global:AtlasServiceStops.Add($this.Name)
        if ($this.Code -eq 0) { $this.Requested = $true; $this.State = 'Stop Pending' }
        return [pscustomobject]@{ReturnValue = $this.Code}
    }
    return $s
}
function Get-WmiObject {
    param($ComputerName, $Class, $ErrorAction)
    if ($ComputerName -ne 'TESTPC' -or $Class -ne 'Win32_Service') { throw 'Unexpected service provider query' }
    return $global:AtlasServices
}
function Start-Sleep { param($Milliseconds) } # Polling is instantaneous in this fixture.
$scriptPath = Join-Path $PSScriptRoot '../scripts/remote_services.ps1'
$global:AtlasServices = @(
    foreach ($n in 1..155) { New-TestService "Unrelated$n" }
    New-TestService TestService
    New-TestService RpcSs
    New-TestService Winmgmt
    New-TestService CannotStop 'Running' $false
    New-TestService AlreadyStopped 'Stopped'
    New-TestService ChangedService
    New-TestService HasDependents 'Running' $true 3
    New-TestService AccessDenied 'Running' $true 2
    New-TestService PendingService 'Running' $true 0 $true
    New-TestService 'a180-service'
)
$list = (& $scriptPath -Computer TESTPC -Action list) | ConvertFrom-Json
if (-not $list.ok -or $list.items.Count -ne $global:AtlasServices.Count) { throw 'Service list omitted records' }
foreach ($name in @('RpcSs', 'Winmgmt', 'CannotStop', 'AlreadyStopped')) {
    if (($list.items | Where-Object name -eq $name).can_stop) { throw "$name should not have a Stop button" }
}
function Stop-Test($Name) {
    $item = $list.items | Where-Object name -eq $Name
    return (& $scriptPath -Computer TESTPC -Action stop -Name $Name -ExpectedIdentity $item.identity) | ConvertFrom-Json
}
$success = Stop-Test TestService
if ($success.outcome -ne 'stopped' -or $success.state -ne 'Stopped' -or ($global:AtlasServiceStops -join ',') -ne 'TestService') { throw 'Stop success did not verify Stopped' }
if ((Stop-Test TestService).outcome -ne 'already_stopped' -or $global:AtlasServiceStops.Count -ne 1) { throw 'Already stopped service was controlled again' }
foreach ($name in @('RpcSs', 'Winmgmt', 'CannotStop')) {
    if ((Stop-Test $name).outcome -ne 'blocked') { throw 'Server protection can be bypassed' }
}
$global:AtlasServiceChange = 'ChangedService'
if ((Stop-Test ChangedService).outcome -ne 'changed' -or $global:AtlasServiceStops.Count -ne 1) { throw 'Changed service identity was controlled' }
$global:AtlasServiceChange = ''
$dependents = Stop-Test HasDependents
if ($dependents.outcome -ne 'failed' -or $dependents.message -notlike '*Dependent services*') { throw 'Dependency failure was hidden' }
if (($global:AtlasServiceStops -join ',') -ne 'TestService,HasDependents') { throw 'Unrelated/dependent services were controlled' }
if ((Stop-Test AccessDenied).outcome -ne 'failed') { throw 'Access denial was reported as success' }
$pending = Stop-Test PendingService
if ($pending.outcome -ne 'pending' -or $pending.state -ne 'Stop Pending') { throw 'Accepted stop was reported as verified success' }
$global:AtlasServices = @($global:AtlasServices | Where-Object Name -ne 'a180-service')
if ((Stop-Test 'a180-service').outcome -ne 'gone') { throw 'Missing service was reported as stopped' }
$wrong = (& $scriptPath -Computer TESTPC -Action stop -Name CannotStop -ExpectedIdentity ('a' * 64)) | ConvertFrom-Json
if ($wrong.outcome -ne 'changed') { throw 'Wrong identity was accepted' }
$global:AtlasServices = @()
$empty = (& $scriptPath -Computer TESTPC -Action list) | ConvertFrom-Json
if (-not $empty.ok -or $empty.items.Count -ne 0) { throw 'Empty service list was not an array' }
Write-Output 'PASS: full inventory, exact service control, verified state, identity recheck, core service protection, dependencies, access denial, pending and missing services'
