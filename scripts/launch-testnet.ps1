$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$BaseUrl = if ($env:PROOFTTL_BASE_URL) {
  $env:PROOFTTL_BASE_URL.TrimEnd('/')
} else {
  "https://proofttl.tasx13ok.workers.dev"
}

$PrivateKeyPath = ".proofttl-signing-private.jwk"
$PublicKeyPath = ".proofttl-signing-public.jwk"
$WranglerConfigPath = "wrangler.jsonc"

function Assert-LastExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE."
  }
}

function Run-Npm([string[]]$Arguments, [string]$Step) {
  & npm @Arguments
  Assert-LastExitCode $Step
}

function Run-Npx([string[]]$Arguments, [string]$Step) {
  & npx @Arguments
  Assert-LastExitCode $Step
}

function New-RandomBase64UrlSecret([int]$ByteLength = 32) {
  $bytes = New-Object byte[] $ByteLength
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Write-Host "ProofTTL guarded testnet launch" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl"
Write-Host "This script does not enable mainnet and does not print private signing/auth material.`n"

if (-not (Test-Path "package.json")) {
  throw "Run this script from the ProofTTL backend repository root."
}
if (-not (Test-Path $WranglerConfigPath)) {
  throw "Missing $WranglerConfigPath."
}

Write-Host "[1/9] Checking Wrangler and Cloudflare authentication..." -ForegroundColor Cyan
Run-Npx @("wrangler", "--version") "Wrangler version check"
Run-Npx @("wrangler", "whoami") "Cloudflare authentication check"

Write-Host "[2/9] Running local safety/regression suite..." -ForegroundColor Cyan
Run-Npm @("run", "test:local") "ProofTTL local tests"

Write-Host "[3/9] Ensuring the MONITOR_DB D1 binding exists..." -ForegroundColor Cyan
$configText = Get-Content -Raw $WranglerConfigPath
$hasMonitorBinding = $configText -match '"binding"\s*:\s*"MONITOR_DB"'
if (-not $hasMonitorBinding) {
  Write-Host "MONITOR_DB is not in wrangler.jsonc; creating the free D1 database and updating config."
  Run-Npm @("run", "monitor:d1:create") "D1 database creation"
  $configText = Get-Content -Raw $WranglerConfigPath
  if ($configText -notmatch '"binding"\s*:\s*"MONITOR_DB"') {
    throw "Wrangler did not add the MONITOR_DB binding to wrangler.jsonc."
  }
} else {
  Write-Host "MONITOR_DB binding already exists; not creating another database."
}

Write-Host "[4/9] Applying D1 monitor/auth migrations..." -ForegroundColor Cyan
Run-Npm @("run", "monitor:d1:migrate") "D1 migrations"

Write-Host "[5/9] Ensuring the Better Auth session secret exists..." -ForegroundColor Cyan
$secretListJson = (& npx wrangler secret list --format json | Out-String)
Assert-LastExitCode "Worker secret list"
$secretList = $secretListJson | ConvertFrom-Json
$hasBetterAuthSecret = @($secretList | Where-Object { $_.name -eq "BETTER_AUTH_SECRET" }).Count -gt 0

if (-not $hasBetterAuthSecret) {
  Write-Host "BETTER_AUTH_SECRET is missing; generating and uploading a cryptographically random secret without printing it."
  $betterAuthSecret = New-RandomBase64UrlSecret 32
  $betterAuthSecret | npx wrangler secret put BETTER_AUTH_SECRET
  Assert-LastExitCode "Better Auth secret upload"
  $betterAuthSecret = $null
} else {
  Write-Host "BETTER_AUTH_SECRET already exists; preserving it so existing sessions are not invalidated."
}

Write-Host "[6/9] Ensuring an Ed25519 signing key exists..." -ForegroundColor Cyan
$hasPrivateKey = Test-Path $PrivateKeyPath
$hasPublicKey = Test-Path $PublicKeyPath
if (-not $hasPrivateKey -and -not $hasPublicKey) {
  Run-Npm @("run", "signing:key:generate") "Signing key generation"
  $hasPrivateKey = Test-Path $PrivateKeyPath
} elseif (-not $hasPrivateKey -and $hasPublicKey) {
  throw "A public signing key exists without $PrivateKeyPath. Refusing to generate a mismatched replacement automatically."
}

if (-not $hasPrivateKey) {
  throw "Missing $PrivateKeyPath after signing-key setup."
}

Write-Host "Uploading the private signing key as a Worker secret without printing it..."
Get-Content -Raw $PrivateKeyPath | npx wrangler secret put PROOFTTL_SIGNING_PRIVATE_JWK
Assert-LastExitCode "Signing secret upload"

Write-Host "[7/9] Validating the Worker bundle with a dry run..." -ForegroundColor Cyan
Run-Npx @("wrangler", "deploy", "--dry-run") "Wrangler deployment dry run"

Write-Host "[8/9] Deploying ProofTTL..." -ForegroundColor Cyan
# npm's deploy lifecycle runs local tests before deployment and the live smoke
# test after deployment. That makes this command fail loudly if the new Worker
# is deployed but the public contract is not actually healthy.
Run-Npm @("run", "deploy") "ProofTTL deploy + postdeploy smoke"

Write-Host "[9/9] Verifying live signing, monitoring and auth surfaces..." -ForegroundColor Cyan
$keys = Invoke-RestMethod -Method Get -Uri "$BaseUrl/.well-known/proofttl-keys.json"
if (-not $keys.signing_enabled) {
  throw "The deployed Worker is reachable, but Ed25519 issuance signing is not enabled."
}
if (-not $keys.keys -or $keys.keys.Count -lt 1) {
  throw "Signing is enabled but no public verification key is being advertised."
}

$monitor = Invoke-RestMethod -Method Get -Uri "$BaseUrl/monitor/status"
if (-not $monitor.enabled) {
  throw "Automatic monitoring does not report enabled=true."
}

$auth = Invoke-RestMethod -Method Get -Uri "$BaseUrl/.well-known/proofttl-auth.json"
if (-not $auth.configured) {
  throw "ProofTTL auth discovery is reachable, but the Better Auth runtime does not report configured=true."
}
if (-not $auth.database) {
  throw "ProofTTL auth is missing its D1 database binding."
}

Write-Host "`nSUCCESS: ProofTTL testnet launch checks passed." -ForegroundColor Green
Write-Host "D1 binding: configured locally and migrated remotely"
Write-Host "Fact Lease signing: enabled and publicly discoverable"
Write-Host "Better Auth runtime: database + session secret configured"
Write-Host "Voice assistant/CORS/x402: verified by postdeploy smoke"
Write-Host "Automatic monitor surface: enabled"
Write-Host "Mainnet: unchanged / not enabled"
Write-Host "`nImportant: wrangler d1 create may have modified wrangler.jsonc. Commit that binding so future deploys use the same D1 database."
