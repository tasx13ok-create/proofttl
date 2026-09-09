$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
New-Item -ItemType Directory -Path 'data\downloads','data\runtime' -Force | Out-Null
$runtimeZip = Join-Path $PSScriptRoot 'data\downloads\llama-b10809-cpu.zip'
Invoke-WebRequest -Uri 'https://github.com/ggml-org/llama.cpp/releases/download/b10809/llama-b10809-bin-win-cpu-x64.zip' -OutFile $runtimeZip
$expectedHash = '9df3158ed228a641a4b127942d7f459f24c9e13f04682659d05c00c80099b6b5'
if ((Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash.ToLower() -ne $expectedHash) { throw 'Official release checksum mismatch. Stop.' }
Expand-Archive -LiteralPath $runtimeZip -DestinationPath 'data\runtime' -Force
ollama pull qwen3:1.7b
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Install Ollama from https://ollama.com/download/windows first.' }
Write-Output 'Ready. Run .\Start-LocalAI.ps1. No remote AI provider is enabled.'
