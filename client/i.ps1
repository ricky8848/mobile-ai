# mobile ai — 移动AI · one-click installer (Windows PowerShell)
# MIT License — Copyright (c) 2026 ricky8848
#
# Usage:   irm https://mai.newapi.email/i.ps1 | iex
# Local:   $env:MOBILEAI_BASE='http://127.0.0.1:6420'; irm .\i.ps1 | iex
#
# What it does — and nothing else:
#   1. checks Node.js >= 18 (prints install hint if missing)
#   2. downloads the three client files into %USERPROFILE%\.mobileai\ (temp file +
#      rename, so a failed download never clobbers a working install)
#   3. runs the local console (opens your browser; re-running is idempotent)
# cloudflared itself is downloaded + SHA-256 verified by mobileai.mjs on first start.
$ErrorActionPreference = 'Stop'

$Base = if ($env:MOBILEAI_BASE) { $env:MOBILEAI_BASE } else { 'https://mai.newapi.email' }
$Maid = Join-Path $env:USERPROFILE '.mobileai'

Write-Host "[mobile ai] 移动AI · installer (base: $Base)"

# ---- 1) Node >= 18 -------------------------------------------------------------
try { $nodeVer = (& node -v).Trim() } catch {
  Write-Host "[mobile ai] Node.js not found. Install it first, then re-run this command:"
  Write-Host "    winget install OpenJS.NodeJS.LTS"
  exit 1
}
$major = [int]($nodeVer -replace '^v', '').Split('.')[0]
if ($major -lt 18) { Write-Host "[mobile ai] Node.js >= 18 required (found $nodeVer)."; exit 1 }

# ---- 2) download client files ----------------------------------------------------
New-Item -ItemType Directory -Force $Maid | Out-Null
foreach ($f in @('mobileai.mjs', 'app.js', 'guide.md')) {
  Write-Host "[mobile ai] downloading $f ..."
  $tmp = Join-Path $Maid ".new-$f"
  Invoke-WebRequest -UseBasicParsing "$Base/$f" -OutFile $tmp
  Move-Item -Force $tmp (Join-Path $Maid $f)
}

# ---- 3) launch ---------------------------------------------------------------------
Write-Host "[mobile ai] starting local console (a browser window will open) ..."
& node (Join-Path $Maid 'mobileai.mjs')
