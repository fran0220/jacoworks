# ============================================================================
# setup-win-runtimes.ps1 — Populate runtimes/ on Windows build VM
#
# Run this ON the Windows build VM (win-build) to download and set up:
#   1. runtimes/bash/  — MSYS2 bash + coreutils from Git for Windows
#   2. runtimes/python/ — Python embeddable package
#   3. runtimes/node/  — bun.exe (+ node.exe alias)
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File desktop\src-tauri\scripts\setup-win-runtimes.ps1
#
# Idempotent: skips downloads if target directories already populated.
# ============================================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TauriDir = Split-Path -Parent $ScriptDir
$RuntimesDir = Join-Path $TauriDir "resources\runtimes"
$TmpDir = Join-Path $env:TEMP "jacoworks-win-runtimes"

# Versions
$GitVersion = "2.47.1"
$PythonVersion = "3.12.8"
$BunVersion = "1.3.10"

New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# ─── 1. Bash (from Git for Windows portable) ─────────────────────────────────

$BashDir = Join-Path $RuntimesDir "bash"

if (Test-Path (Join-Path $BashDir "bash.exe")) {
    Write-Host "✅ runtimes/bash already populated, skipping"
} else {
    Write-Host "📦 Setting up bash from Git for Windows..."

    # Check if Git Bash is already installed system-wide
    $GitBashPaths = @(
        "C:\Program Files\Git\usr\bin",
        "C:\Program Files (x86)\Git\usr\bin",
        "${env:LOCALAPPDATA}\Programs\Git\usr\bin"
    )

    $SourceBin = $null
    foreach ($p in $GitBashPaths) {
        if (Test-Path (Join-Path $p "bash.exe")) {
            $SourceBin = $p
            break
        }
    }

    if ($SourceBin) {
        Write-Host "   Found system Git at: $SourceBin"
    } else {
        Write-Host "   Downloading Git for Windows portable..."
        $GitArchive = Join-Path $TmpDir "PortableGit-${GitVersion}-64-bit.7z.exe"
        if (-not (Test-Path $GitArchive)) {
            $GitUrl = "https://github.com/git-for-windows/git/releases/download/v${GitVersion}.windows.1/PortableGit-${GitVersion}-64-bit.7z.exe"
            Invoke-WebRequest -Uri $GitUrl -OutFile $GitArchive -UseBasicParsing
        }
        $ExtractDir = Join-Path $TmpDir "git-portable"
        if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir }
        & 7z x "-o$ExtractDir" $GitArchive -y | Out-Null
        $SourceBin = Join-Path $ExtractDir "usr\bin"
    }

    New-Item -ItemType Directory -Force -Path $BashDir | Out-Null

    # Copy bash + sh
    foreach ($exe in @("bash.exe", "sh.exe")) {
        $src = Join-Path $SourceBin $exe
        if (Test-Path $src) { Copy-Item $src $BashDir }
    }

    # MSYS2 DLLs
    $Dlls = @(
        "msys-2.0.dll", "msys-iconv-2.dll", "msys-intl-8.dll",
        "msys-pcre-1.dll", "msys-pcre2-8-0.dll",
        "msys-gcc_s-seh-1.dll", "msys-stdc++-6.dll",
        "msys-readline8.dll", "msys-ncursesw6.dll", "msys-z.dll"
    )
    foreach ($dll in $Dlls) {
        $src = Join-Path $SourceBin $dll
        if (Test-Path $src) { Copy-Item $src $BashDir }
    }

    # Coreutils
    $Utils = @(
        "sed", "grep", "find", "cat", "ls", "mkdir", "rm", "cp", "mv",
        "tar", "gzip", "head", "tail", "wc", "sort", "uniq", "tee", "tr", "cut",
        "dirname", "basename", "env", "printf", "echo", "test", "true", "false",
        "which", "xargs", "awk", "curl"
    )
    $copied = 0
    foreach ($util in $Utils) {
        $src = Join-Path $SourceBin "${util}.exe"
        if (Test-Path $src) {
            Copy-Item $src $BashDir
            $copied++
        }
    }
    Write-Host "   Copied bash + $copied coreutils"

    $size = (Get-ChildItem $BashDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("✅ runtimes/bash ready: {0:N1} MB" -f $size)
}

# ─── 2. Python (embeddable package) ──────────────────────────────────────────

$PythonDir = Join-Path $RuntimesDir "python"

if (Test-Path (Join-Path $PythonDir "python.exe")) {
    Write-Host "✅ runtimes/python already populated, skipping"
} else {
    Write-Host "📦 Setting up Python embeddable package..."
    $PythonZip = Join-Path $TmpDir "python-${PythonVersion}-embed-amd64.zip"
    if (-not (Test-Path $PythonZip)) {
        $PythonUrl = "https://www.python.org/ftp/python/${PythonVersion}/python-${PythonVersion}-embed-amd64.zip"
        Invoke-WebRequest -Uri $PythonUrl -OutFile $PythonZip -UseBasicParsing
    }

    New-Item -ItemType Directory -Force -Path $PythonDir | Out-Null
    Expand-Archive -Path $PythonZip -DestinationPath $PythonDir -Force

    $size = (Get-ChildItem $PythonDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("✅ runtimes/python ready: {0:N1} MB" -f $size)
}

# ─── 3. Node/Bun ─────────────────────────────────────────────────────────────

$NodeDir = Join-Path $RuntimesDir "node"

if (Test-Path (Join-Path $NodeDir "bun.exe")) {
    Write-Host "✅ runtimes/node already populated, skipping"
} else {
    Write-Host "📦 Setting up Bun for Windows..."
    $BunZip = Join-Path $TmpDir "bun-windows-x64.zip"
    if (-not (Test-Path $BunZip)) {
        $BunUrl = "https://github.com/oven-sh/bun/releases/download/bun-v${BunVersion}/bun-windows-x64.zip"
        Invoke-WebRequest -Uri $BunUrl -OutFile $BunZip -UseBasicParsing
    }

    $BunExtract = Join-Path $TmpDir "bun-extract"
    if (Test-Path $BunExtract) { Remove-Item -Recurse -Force $BunExtract }
    Expand-Archive -Path $BunZip -DestinationPath $BunExtract -Force

    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    $BunExe = Get-ChildItem -Path $BunExtract -Filter "bun.exe" -Recurse | Select-Object -First 1
    Copy-Item $BunExe.FullName (Join-Path $NodeDir "bun.exe")
    Copy-Item $BunExe.FullName (Join-Path $NodeDir "node.exe")

    $size = (Get-ChildItem $NodeDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("✅ runtimes/node ready: {0:N1} MB" -f $size)
}

# ─── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "════════════════════════════════════════════════════"
$totalSize = (Get-ChildItem $RuntimesDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("✅ All runtimes ready! Total: {0:N1} MB" -f $totalSize)
Write-Host "   bash:   $BashDir"
Write-Host "   python: $PythonDir"
Write-Host "   node:   $NodeDir"
