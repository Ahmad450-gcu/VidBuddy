<#
  Builds the VidBuddy Windows app.

    powershell -ExecutionPolicy Bypass -File backend\desktop\build.ps1

  Output:
    backend\desktop\build\dist\VidBuddy\VidBuddy.exe          the app (portable folder)
    backend\desktop\build\VidBuddy-Setup-<version>.exe        installer, when Inno Setup 6 is installed

  Needs: Python 3.12 venv at backend\.venv with requirements-desktop.txt, Node 20+.
#>
param(
  [switch]$SkipWeb,       # reuse frontend\dist from a previous build
  [string]$Python = "",
  [string]$Version = ""   # defaults to frontend\package.json (CI passes the git tag)
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Here = $PSScriptRoot
$Backend = Split-Path $Here -Parent
$Root = Split-Path $Backend -Parent
$Build = Join-Path $Here "build"
New-Item -ItemType Directory -Force $Build | Out-Null
if (-not $Python) { $Python = Join-Path $Backend ".venv\Scripts\python.exe" }

if (-not $Version) { $Version = (Get-Content (Join-Path $Root "frontend\package.json") -Raw | ConvertFrom-Json).version }
Write-Host "Building VidBuddy $Version" -ForegroundColor Cyan

# 1. Frontend
if (-not $SkipWeb) {
  Push-Location (Join-Path $Root "frontend")
  try {
    if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw "npm ci failed" } }
    npm run build; if ($LASTEXITCODE) { throw "frontend build failed" }
  } finally { Pop-Location }
}

# 2. Deno: the JavaScript runtime yt-dlp needs for full YouTube support
$DenoVersion = "v2.9.8"
$DenoDir = Join-Path $Build "deno"
$DenoExe = Join-Path $DenoDir "deno.exe"
$DenoStamp = Join-Path $DenoDir "version.txt"
if (-not (Test-Path $DenoExe) -or (Get-Content $DenoStamp -ErrorAction SilentlyContinue) -ne $DenoVersion) {
  Write-Host "Fetching Deno $DenoVersion"
  $base = "https://github.com/denoland/deno/releases/download/$DenoVersion/deno-x86_64-pc-windows-msvc.zip"
  $zip = Join-Path $Build "deno.zip"
  $sumFile = "$zip.sha256sum"
  Invoke-WebRequest $base -OutFile $zip -UseBasicParsing
  Invoke-WebRequest "$base.sha256sum" -OutFile $sumFile -UseBasicParsing
  $m = [regex]::Match((Get-Content $sumFile -Raw), "\b[0-9A-Fa-f]{64}\b")
  if (-not $m.Success) { throw "No checksum found in Deno's .sha256sum file" }
  $expected = $m.Value.ToLower()
  Remove-Item $sumFile
  $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "Deno checksum mismatch ($actual vs $expected)" }
  if (Test-Path $DenoDir) { Remove-Item $DenoDir -Recurse -Force }
  Expand-Archive $zip $DenoDir
  Remove-Item $zip
  Set-Content $DenoStamp $DenoVersion
}

# 3. Icon and version resource
& $Python -c @"
from PIL import Image
img = Image.open(r'$Root\frontend\public\icons\icon-512.png').convert('RGBA')
img.save(r'$Build\vidbuddy.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
"@
if ($LASTEXITCODE) { throw "icon generation failed" }

$parts = ($Version.Split(".") + @("0","0","0","0"))[0..3] -join ", "
@"
VSVersionInfo(
  ffi=FixedFileInfo(filevers=($parts), prodvers=($parts)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'VidBuddy'),
      StringStruct('FileDescription', 'VidBuddy'),
      StringStruct('FileVersion', '$Version'),
      StringStruct('ProductName', 'VidBuddy'),
      StringStruct('ProductVersion', '$Version'),
      StringStruct('OriginalFilename', 'VidBuddy.exe')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@ | Set-Content (Join-Path $Build "version_info.txt") -Encoding utf8

# 4. Freeze the app
& $Python -m PyInstaller --noconfirm --clean `
  --distpath (Join-Path $Build "dist") --workpath (Join-Path $Build "work") `
  (Join-Path $Here "vidbuddy.spec")
if ($LASTEXITCODE) { throw "PyInstaller failed" }
Write-Host "App folder: $Build\dist\VidBuddy" -ForegroundColor Green

# 5. Installer (optional)
$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
  & $iscc /Qp "/DAppVersion=$Version" "/O$Build" (Join-Path $Here "installer.iss")
  if ($LASTEXITCODE) { throw "Inno Setup failed" }
  Write-Host "Installer: $Build\VidBuddy-Setup-$Version.exe" -ForegroundColor Green
} else {
  Write-Host "Inno Setup 6 not found: skipped the installer (the app folder above still works)." -ForegroundColor Yellow
}
