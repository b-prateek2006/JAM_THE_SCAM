# Runs Jam the Scam on this laptop and gives it a public HTTPS link (Cloudflare quick tunnel),
# so phones can open it and use the microphone. Free; the link works while this window is open.
#
#   powershell -ExecutionPolicy Bypass -File scripts\demo.ps1          # build (if needed) and start
#   powershell -ExecutionPolicy Bypass -File scripts\demo.ps1 -Stop    # stop the app afterwards
#
# Needs Docker Desktop and cloudflared (winget install --id Cloudflare.cloudflared).
# LLM keys come from backend\.env (see .env.example); without them the app runs on L1 + L2.
param([switch]$Stop)

# Not "Stop": Windows PowerShell treats any stderr from docker (progress, warnings) as a fatal error.
# Failures are caught through $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Stop) {
    docker compose down
    exit 0
}

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $known = @("${env:ProgramFiles}\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
               "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")
    foreach ($p in $known) { if (Test-Path $p) { return $p } }
    throw "cloudflared not found. Install it with: winget install --id Cloudflare.cloudflared"
}

# 1. Docker Desktop
$null = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting Docker Desktop..."
    Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    for ($i = 0; $i -lt 90; $i++) { Start-Sleep 2; $null = docker info 2>&1; if ($LASTEXITCODE -eq 0) { break } }
    if ($LASTEXITCODE -ne 0) { throw "Docker Desktop did not start." }
}

# 2. The app (the first build takes ~10 minutes: it downloads torch and the models)
if (-not (Test-Path "backend\.env")) { Write-Warning "backend\.env not found: L3 (LLM) will be off." }
Write-Host "Starting the app..."
docker compose up -d --build 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { throw "docker compose failed." }

Write-Host -NoNewline "Waiting for the app"
$health = $null
for ($i = 0; $i -lt 90; $i++) {
    try { $health = Invoke-RestMethod http://localhost:8000/api/health -TimeoutSec 3 -ErrorAction Stop; break } catch { Write-Host -NoNewline "."; Start-Sleep 2 }
}
Write-Host ""
if (-not $health) { docker compose logs --tail 40; throw "The app did not become healthy." }
$l3 = if ($health.l3) { "$($health.l3.provider) ($($health.l3.model)), fallback $($health.l3.fallback)" } else { "off" }
Write-Host "App is up: L2 $($health.l2) | L3 $l3 | STT $($health.stt.name)"

# 3. Public HTTPS link. Quick tunnels are temporary: Cloudflare can delete one (after a network drop,
# or hours later), and cloudflared then retries a dead link forever. So watch for that and open a new one.
$cloudflared = Find-Cloudflared
$log = Join-Path $env:TEMP "jam-tunnel.log"

function Start-Tunnel {
    Remove-Item $log -ErrorAction SilentlyContinue
    $proc = Start-Process $cloudflared -ArgumentList "tunnel", "--no-autoupdate", "--url", "http://localhost:8000" `
        -RedirectStandardError $log -NoNewWindow -PassThru
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep 1
        if (Test-Path $log) {
            $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1
            if ($m) { return @{ Proc = $proc; Url = $m.Matches[0].Value } }
        }
    }
    Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue
    Get-Content $log -Tail 20
    throw "The tunnel did not start."
}

$tunnel = $null
try {
    while ($true) {
        $tunnel = Start-Tunnel
        Write-Host ""
        Write-Host "  Open on any phone or laptop:  $($tunnel.Url)" -ForegroundColor Green
        Write-Host "  (new link each run; keep this window open while demoing)"
        Write-Host ""
        Write-Host "Press Ctrl+C to close the tunnel. The app keeps running; stop it with: scripts\demo.ps1 -Stop"
        while (-not $tunnel.Proc.HasExited) {
            Start-Sleep 10
            if (Select-String -Path $log -Pattern "Tunnel not found" -Quiet) { break }
        }
        Stop-Process -Id $tunnel.Proc.Id -ErrorAction SilentlyContinue
        Write-Warning "Cloudflare dropped the link. Opening a new one (the old link no longer works)..."
        Start-Sleep 2
    }
} finally {
    if ($tunnel) { Stop-Process -Id $tunnel.Proc.Id -ErrorAction SilentlyContinue }
}
