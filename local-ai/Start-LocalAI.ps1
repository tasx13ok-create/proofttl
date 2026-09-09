param([switch]$StatusOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeExe = Join-Path $PSScriptRoot 'data\runtime\llama-server.exe'
$manifestPath = Join-Path $env:USERPROFILE '.ollama\models\manifests\registry.ollama.ai\library\qwen3\1.7b'
if (!(Test-Path -LiteralPath $runtimeExe)) { throw 'Portable runtime missing. Run .\Setup-LocalAI.ps1 first.' }
if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Local model missing. Run ollama pull qwen3:1.7b once while online.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$modelLayer = $manifest.layers | Where-Object mediaType -eq 'application/vnd.ollama.image.model' | Select-Object -First 1
$modelPath = Join-Path $env:USERPROFILE ('.ollama\models\blobs\' + $modelLayer.digest.Replace(':','-'))
if (!(Test-Path -LiteralPath $modelPath)) { throw 'Model blob missing; run ollama pull qwen3:1.7b.' }
$running = $false
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 2; $running = $health.status -eq 'ok' } catch {}
New-Item -ItemType Directory -Path 'data\logs' -Force | Out-Null
if (!$running) {
  $runtimeArgs = @('-m', ('"' + $modelPath + '"'), '--alias', 'proofttl-local', '--host', '127.0.0.1', '--port', '11435', '-c', '4096', '-ngl', '0', '--reasoning', 'off')
  $runtimeProcess = Start-Process -FilePath $runtimeExe -ArgumentList $runtimeArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput 'data\logs\runtime-out.log' -RedirectStandardError 'data\logs\runtime-error.log'
  $runtimeProcess.Id | Set-Content 'data\runtime.pid'
  $deadline = (Get-Date).AddSeconds(90)
  do { Start-Sleep -Seconds 2; try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 2; $running = $health.status -eq 'ok' } catch {} } while (!$running -and (Get-Date) -lt $deadline -and !$runtimeProcess.HasExited)
  if (!$running) { throw 'Local model failed to start. Read data\logs\runtime-error.log.' }
}
if (!(Test-Path -LiteralPath 'config.local.json')) {
  @{provider='openai-compatible';baseUrl='http://127.0.0.1:11435';model='proofttl-local';allowRemote=$false} | ConvertTo-Json | Set-Content -Encoding utf8 'config.local.json'
}
if ($StatusOnly) { node agent.mjs /status } else { node agent.mjs }
