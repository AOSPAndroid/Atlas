param(
    [string]$Computer,
    [ValidateSet('cpu', 'gpu', 'memory', 'threads', 'diagnose')][string]$Kind = 'cpu',
    [long]$ProcessId = 0,
    [string]$ExpectedCreated = '',
    [string]$ExpectedName = ''
)
$ErrorActionPreference = 'Stop'
$warnings = [System.Collections.Generic.List[string]]::new()
function Query($Class, $Filter = '', [switch]$Required) {
    try {
        $args = @{ComputerName = $Computer; Class = $Class; ErrorAction = 'Stop'}
        if ($Filter) { $args.Filter = $Filter }
        $data = @(Get-WmiObject @args)
        if (-not $data.Count) { throw 'No counters returned' }
        return $data
    } catch {
        if ($Required) { throw }
        $message = "${Class}: $($_.Exception.Message)"
        if (-not $warnings.Contains($message)) { $warnings.Add($message) }
    }
}
function Index($Records, $Key) {
    $table = @{}
    foreach ($record in $Records) { $table[[string]$record.$Key] = $record }
    return $table
}
function Number($Value) {
    if ($null -ne $Value) { return [double]$Value }
    return $null
}
function Percent($Part, $Total) {
    if ($null -eq $Part -or $null -eq $Total -or $Total -le 0) { return $null }
    return [math]::Round([math]::Max([double]0, [math]::Min([double]100, 100 * [double]$Part / [double]$Total)), 1)
}
# Raw values must be differenced using the provider's timestamps, not wall time.
function Rate($Before, $After, $Field, [switch]$Cpu, [switch]$Inverse) {
    if (-not $Before -or -not $After -or $null -eq $Before.$Field -or $null -eq $After.$Field) { return $null }
    $clock = if ($Cpu) { 'Timestamp_Sys100NS' } else { 'Timestamp_PerfTime' }
    if ($null -eq $Before.$clock -or $null -eq $After.$clock) { return $null }
    $elapsed = [decimal]$After.$clock - [decimal]$Before.$clock
    $delta = [decimal]$After.$Field - [decimal]$Before.$Field
    if ($elapsed -le 0 -or $delta -lt 0) { return $null }
    if ($Cpu) {
        $value = 100 * $delta / $elapsed
        if ($Inverse) { $value = 100 - $value }
        return [double]$value
    }
    if ($After.Frequency_PerfTime -le 0) { return $null }
    return [double]($delta * [decimal]$After.Frequency_PerfTime / $elapsed)
}
function Latency($Before, $After, $Field) {
    $base = $Field + '_Base'
    if (-not $Before -or -not $After -or $null -eq $Before.$Field -or $null -eq $After.$Field -or $null -eq $Before.$base -or $null -eq $After.$base -or $After.Frequency_PerfTime -le 0) { return $null }
    $count = [decimal]$After.$base - [decimal]$Before.$base
    $delta = [decimal]$After.$Field - [decimal]$Before.$Field
    if ($count -lt 0 -or $delta -lt 0) { return $null }
    if ($count -eq 0) { return 0 }
    return [math]::Round([double](1000 * $delta / [decimal]$After.Frequency_PerfTime / $count), 2)
}
function Check-Identity($Record) {
    if (-not $Record -or $Record.CreationDate -cne $ExpectedCreated -or $Record.Name -ine $ExpectedName) {
        throw 'Process exited or changed since the list was loaded. Refresh and select it again.'
    }
}
try {
    $computerInfo = Query Win32_ComputerSystem
    $cores = Number $computerInfo.NumberOfLogicalProcessors
    if ($Kind -eq 'threads') {
        Check-Identity (Query Win32_Process "ProcessId=$ProcessId" -Required)
        $before = Index @(Query Win32_PerfRawData_PerfProc_Thread "IDProcess=$ProcessId" -Required) 'IDThread'
        Start-Sleep -Milliseconds 1000
        $after = @(Query Win32_PerfRawData_PerfProc_Thread "IDProcess=$ProcessId" -Required)
        Check-Identity (Query Win32_Process "ProcessId=$ProcessId" -Required)
        $states = @('Initialized', 'Ready', 'Running', 'Standby', 'Terminated', 'Waiting', 'Transition', 'Unknown')
        $waits = @('Executive', 'Free page', 'Page in', 'Pool allocation', 'Execution delay', 'Suspended', 'User request', 'Executive', 'Free page', 'Page in', 'Pool allocation', 'Execution delay', 'Suspended', 'User request', 'Event pair high', 'Event pair low', 'LPC receive', 'LPC reply', 'Virtual memory', 'Page out')
        $rows = @(foreach ($thread in $after) {
            $old = $before[[string]$thread.IDThread]
            if (-not $old -or $null -eq $old.ElapsedTime -or $old.ElapsedTime -ne $thread.ElapsedTime) { $old = $null }
            $coreCpu = Rate $old $thread PercentProcessorTime -Cpu
            $state = Number $thread.ThreadState
            $wait = Number $thread.ThreadWaitReason
            [pscustomobject]@{
                TID = [long]$thread.IDThread
                CoreCPU = $(if ($null -ne $coreCpu) { Percent $coreCpu 100 } else { $null })
                CPU = $(if ($null -ne $coreCpu -and $cores -gt 0) { [math]::Round($coreCpu / $cores, 2) } else { $null })
                ContextSwitches = Rate $old $thread ContextSwitchesPersec
                State = $(if ($null -ne $state -and $state -lt $states.Count) { $states[$state] } else { 'Unknown' })
                WaitReason = $(if ($state -eq 5 -and $null -ne $wait) { if ($wait -lt $waits.Count) { $waits[$wait] } else { "Other ($wait)" } } else { $null })
                Priority = Number $thread.PriorityCurrent
            }
        })
        [pscustomobject]@{ok = $true; computer = $Computer; pid = $ProcessId; name = $ExpectedName; checked_at = [datetime]::UtcNow.ToString('o'); logical_processors = $cores; total_threads = $after.Count; limit = 200; items = @($rows | Sort-Object CoreCPU -Descending | Select-Object -First 200); warnings = @($warnings)} | ConvertTo-Json -Depth 7 -Compress
        return
    }
    $identities = Index @(Query Win32_Process -Required) 'ProcessId'
    # Diagnose at most three Excel instances. Both thread samples share the normal
    # sampling interval; no trace, injected code or workbook automation is used.
    $excelTargets = @(); $firstThreads = @{}; $lastThreads = @()
    if ($Kind -eq 'diagnose') {
        $excelTargets = @($identities.Values | Where-Object Name -ieq 'EXCEL.EXE' | Sort-Object WorkingSetSize -Descending | Select-Object -First 3)
        if ($excelTargets.Count) {
            $threadFilter = ($excelTargets | ForEach-Object { 'IDProcess=' + $_.ProcessId }) -join ' OR '
            $firstThreads = Index @(Query Win32_PerfRawData_PerfProc_Thread $threadFilter) 'IDThread'
        }
    }
    $first = Index @(Query Win32_PerfRawData_PerfProc_Process) 'IDProcess'
    $firstCpu = Index @(Query Win32_PerfRawData_PerfOS_Processor) 'Name'
    $firstDisk = Index @(Query Win32_PerfRawData_PerfDisk_PhysicalDisk) 'Name'
    Start-Sleep -Milliseconds 1000
    $last = Index @(Query Win32_PerfRawData_PerfProc_Process) 'IDProcess'
    $lastCpu = @(Query Win32_PerfRawData_PerfOS_Processor)
    $lastDisk = @(Query Win32_PerfRawData_PerfDisk_PhysicalDisk)
    if ($excelTargets.Count) { $lastThreads = @(Query Win32_PerfRawData_PerfProc_Thread $threadFilter) }
    $processes = @(Query Win32_Process -Required)
    $os = Query Win32_OperatingSystem
    $memory = Query Win32_PerfFormattedData_PerfOS_Memory
    $system = Query Win32_PerfFormattedData_PerfOS_System
    $engines = @(Query Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
    $gpuProcesses = @{}; $gpuTotals = @{}
    foreach ($engine in $engines) {
        if ($engine.Name -match '^pid_(\d+)_' -and $null -ne $engine.UtilizationPercentage) {
            $key = $Matches[1]; $engineKey = $engine.Name -replace '^pid_\d+_', ''
            $gpuTotals[$engineKey] += [double]$engine.UtilizationPercentage
            if (-not $gpuProcesses.ContainsKey($key) -or $engine.UtilizationPercentage -gt $gpuProcesses[$key].UtilizationPercentage) { $gpuProcesses[$key] = $engine }
        }
    }
    $totalMemory = $(if ($null -ne $os.TotalVisibleMemorySize -and $os.TotalVisibleMemorySize -gt 0) { [double]$os.TotalVisibleMemorySize * 1KB } else { $null })
    $freeMemory = $(if ($null -ne $os.FreePhysicalMemory) { [double]$os.FreePhysicalMemory * 1KB } else { $null })
    $cpuRows = @(foreach ($counter in $lastCpu) {
        $value = Rate $firstCpu[[string]$counter.Name] $counter PercentProcessorTime -Cpu -Inverse
        [pscustomobject]@{name = $counter.Name; percent = $(if ($null -ne $value) { Percent $value 100 } else { $null })}
    })
    $diskRows = @(foreach ($disk in $lastDisk) {
        if ($disk.Name -eq '_Total') { continue }
        $old = $firstDisk[[string]$disk.Name]
        [pscustomobject]@{name = $disk.Name; read_ms = Latency $old $disk AvgDisksecPerRead; write_ms = Latency $old $disk AvgDisksecPerWrite; queue = Number $disk.CurrentDiskQueueLength; read_bytes_sec = Rate $old $disk DiskReadBytesPersec; write_bytes_sec = Rate $old $disk DiskWriteBytesPersec}
    })
    $volumes = @(foreach ($volume in @(Query Win32_LogicalDisk 'DriveType=3')) {
        [pscustomobject]@{name = $volume.DeviceID; total_bytes = Number $volume.Size; free_bytes = Number $volume.FreeSpace; free_percent = Percent (Number $volume.FreeSpace) (Number $volume.Size)}
    })
    $rows = @(foreach ($record in $processes) {
        if ($record.ProcessId -eq 0) { continue }
        $key = [string]$record.ProcessId; $metric = $last[$key]; $old = $first[$key]
        if (-not $identities.ContainsKey($key) -or $record.CreationDate -cne $identities[$key].CreationDate -or $null -eq $old.ElapsedTime -or $old.ElapsedTime -ne $metric.ElapsedTime) { $old = $null; $metric = $null }
        $cpu = Rate $old $metric PercentProcessorTime -Cpu
        $gpu = $gpuProcesses[$key]
        $workingSet = Number $record.WorkingSetSize
        $measuredThreads = @()
        if ($Kind -eq 'diagnose' -and $metric -and $old) {
            $measuredThreads = @(foreach ($thread in $lastThreads) {
                if ($thread.IDProcess -ne $record.ProcessId) { continue }
                $oldThread = $firstThreads[[string]$thread.IDThread]
                if (-not $oldThread -or $oldThread.IDProcess -ne $thread.IDProcess -or $null -eq $oldThread.ElapsedTime -or $oldThread.ElapsedTime -ne $thread.ElapsedTime) { continue }
                $threadCpu = Rate $oldThread $thread PercentProcessorTime -Cpu
                if ($null -ne $threadCpu) { [pscustomobject]@{id = [long]$thread.IDThread; cpu = Percent $threadCpu 100} }
            })
        }
        $busiestThread = $measuredThreads | Sort-Object cpu -Descending | Select-Object -First 1
        [pscustomobject]@{
            PID = [long]$record.ProcessId; Process = [string]$record.Name; CreatedAt = [string]$record.CreationDate
            SessionId = Number $record.SessionId; CommandLine = [string]$record.CommandLine
            CPU = $(if ($null -ne $cpu -and $cores -gt 0) { Percent $cpu ($cores * 100) } else { $null })
            GPU = $(if ($gpu) { Percent (Number $gpu.UtilizationPercentage) 100 } else { $null })
            Engine = $(if ($gpu) { ($gpu.Name -split '_engtype_', 2)[-1] } else { $null })
            MemoryBytes = $workingSet; MemoryPercent = Percent $workingSet $totalMemory
            MemoryMB = $(if ($null -ne $workingSet) { [math]::Round($workingSet / 1MB, 1) } else { $null })
            PrivateBytes = Number $metric.PrivateBytes; Threads = Number $record.ThreadCount; Handles = Number $record.HandleCount
            IOBytesPerSec = Rate $old $metric IODataBytesPersec; PageFaultsPerSec = Rate $old $metric PageFaultsPersec
            BusiestThreadCPU = $(if ($busiestThread) { $busiestThread.cpu } else { $null })
            BusiestThreadId = $(if ($busiestThread) { $busiestThread.id } else { $null })
            MeasuredThreads = $measuredThreads.Count
        }
    })
    $uptime = $null
    try { if ($os.LastBootUpTime -and $os.LocalDateTime) { $uptime = ($os.ConvertToDateTime($os.LocalDateTime) - $os.ConvertToDateTime($os.LastBootUpTime)).TotalSeconds } } catch { $warnings.Add('Uptime unavailable') }
    $busiest = $gpuTotals.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
    $sort = switch ($Kind) { 'gpu' { 'GPU' }; 'memory' { 'MemoryBytes' }; default { 'CPU' } }
    $selected = @($rows | Sort-Object $sort -Descending | Select-Object -First 100)
    if ($Kind -eq 'diagnose') {
        # Preserve memory/GPU/I/O consumers even when they are absent from CPU's top 100.
        $leaders = @{}
        foreach ($field in @('CPU', 'MemoryBytes', 'GPU', 'IOBytesPerSec')) {
            foreach ($row in @($rows | Sort-Object $field -Descending | Select-Object -First 20)) { $leaders[[string]$row.PID] = $row }
        }
        foreach ($row in @($rows | Where-Object Process -ieq 'EXCEL.EXE' | Sort-Object MemoryBytes -Descending | Select-Object -First 20)) { $leaders[[string]$row.PID] = $row }
        $selected = @($leaders.Values | Sort-Object CPU -Descending)
    }
    [pscustomobject]@{
        ok = $true; computer = $Computer; kind = $Kind; checked_at = [datetime]::UtcNow.ToString('o')
        total_processes = $rows.Count; limit = 100; items = $selected; warnings = @($warnings)
        summary = [pscustomobject]@{
            cpu_percent = ($cpuRows | Where-Object name -eq '_Total').percent; logical_processors = $cores
            cores = @($cpuRows | Where-Object name -ne '_Total'); total_memory_bytes = $totalMemory; available_memory_bytes = $freeMemory
            memory_percent = $(if ($null -ne $freeMemory -and $null -ne $totalMemory) { Percent ($totalMemory - $freeMemory) $totalMemory } else { $null })
            commit_percent = Percent (Number $memory.CommittedBytes) (Number $memory.CommitLimit)
            page_reads_sec = Number $memory.PageReadsPersec; processor_queue = Number $system.ProcessorQueueLength
            context_switches_sec = Number $system.ContextSwitchesPersec; thread_count = Number $system.Threads
            process_count = $processes.Count; uptime_seconds = $uptime; os = [string]$os.Caption
            model = [string]$computerInfo.Model; console_user = [string]$computerInfo.UserName
            gpu_percent = $(if ($busiest) { Percent $busiest.Value 100 } else { $null }); gpu_engine = $(if ($busiest) { $busiest.Name } else { $null })
            disks = $diskRows; volumes = $volumes
        }
    } | ConvertTo-Json -Depth 7 -Compress
} catch {
    [pscustomobject]@{ok = $false; error = $_.Exception.Message} | ConvertTo-Json -Compress
}
