# Mede CPU (% de um núcleo) e memória (MB) de cada processo do Hydraflow durante N segundos.
# Uso: powershell -File scripts\measure.ps1 [-Seconds 30] [-Exe electron|Hydraflow]  (sem -Exe: os dois)
param([int]$Seconds = 30, [string]$Exe = '')
$names = if ($Exe) { @($Exe) } else { @('Hydraflow', 'electron') }
$rx = '^(' + ($names -join '|') + ')(#\d+)?$'
function Get-Snap { Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $_.Name -match $rx } }
function Get-Cmd {
  $m = @{}
  Get-CimInstance Win32_Process -Filter (($names | ForEach-Object { "Name='$_.exe'" }) -join ' OR ') | ForEach-Object {
    $c = $_.CommandLine
    # processo elevado (auxiliar da RAM): o Windows não mostra a linha de comando para quem não é administrador
    if (-not $c) { $m[[int]$_.ProcessId] = 'auxiliar RAM (elevado)'; return }
    $kind = if ($c -match '--type=renderer') { 'janela/renderer' } elseif ($c -match '--type=gpu-process') { 'gpu' } elseif ($c -match 'Captura') { 'captura' }
      elseif ($c -match 'Engine') { 'motor' } elseif ($c -match '--type=utility') { 'utility' } elseif ($c -match 'smbus-helper') { 'auxiliar RAM' }
      elseif ($c -match 'hydraflow-wallpaper') { 'papel de parede (principal)' } elseif ($c -match '--type=') { ($c -replace '.*--type=(\S+).*', '$1') } else { 'principal' }
    if ($c -match 'hydraflow-wallpaper|papel-de-parede') { $kind = "papel de parede: $kind" }
    $m[[int]$_.ProcessId] = $kind
  }
  $m
}
$a = Get-Snap; $t0 = Get-Date
# GPU: soma da utilização de todos os motores da placa (3D, cópia, vídeo…) por processo, amostrada a cada segundo
$gpuSamples = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples ([Math]::Max(1, $Seconds - 1)) -ErrorAction SilentlyContinue
$b = Get-Snap; $dt = ((Get-Date) - $t0).TotalSeconds
$gpu = @{}
foreach ($set in $gpuSamples) { foreach ($c in $set.CounterSamples) { if ($c.InstanceName -match 'pid_(\d+)_') { $gpu[[int]$matches[1]] = ($gpu[[int]$matches[1]] + $c.CookedValue) } } }
$nGpu = [Math]::Max(1, @($gpuSamples).Count)
$kinds = Get-Cmd
$rows = foreach ($p in $b) {
  $old = $a | Where-Object { $_.IDProcess -eq $p.IDProcess }
  if (-not $old) { continue }
  $cpu = ($p.PercentProcessorTime - $old.PercentProcessorTime) / 1e7 / $dt * 100
  [pscustomobject]@{ PID = $p.IDProcess; Tipo = $kinds[[int]$p.IDProcess]; CPU = [math]::Round($cpu, 2); GPU = [math]::Round(($gpu[[int]$p.IDProcess] + 0) / $nGpu, 2); MemMB = [math]::Round($p.WorkingSetPrivate / 1MB, 1) }
}
$rows | Sort-Object CPU -Descending | Format-Table -AutoSize
"Total: CPU {0:N2}% de um núcleo | GPU {1:N2}% | memória privada {2:N0} MB | {3} processos | {4:N0}s" -f ($rows | Measure-Object CPU -Sum).Sum, ($rows | Measure-Object GPU -Sum).Sum, ($rows | Measure-Object MemMB -Sum).Sum, $rows.Count, $dt
