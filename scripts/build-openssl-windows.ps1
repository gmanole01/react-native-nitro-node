# Builds a static OpenSSL for every Windows platform NitroNode supports (x64,
# ARM64, Win32), against the DLL C runtime (/MD), as NitroNode.dll is built.
#
# No symbol renaming, unlike the Apple build: OpenSSL is linked into
# NitroNode.dll, which exports only its WinRT entry points (NitroNode.def), so
# another OpenSSL in the app can't take its place.
#
# Outputs build/openssl-windows/NitroNodeOpenSSL-windows-<version>.zip, with
# <Platform>/include and <Platform>/lib/{libcrypto,libssl}.lib, which
# windows/NitroNode/NitroNode.vcxproj downloads from this repo's
# `openssl-windows-<version>-<n>` GitHub release (a new <n> for each new build
# of the same version). -Install also extracts it into windows/openssl, for
# building before a release exists.
#
# Needs Visual Studio with the C++ tools for x64 and ARM64, Perl (Strawberry
# Perl) and NASM on the PATH.
#
# Usage: scripts/build-openssl-windows.ps1 [-Version 3.6.2] [-Install]

param(
  [string]$Version = "3.6.2",
  [switch]$Install
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Work = Join-Path $Root "build/openssl-windows"
$Src = Join-Path $Work "openssl-$Version"
$Dist = Join-Path $Work "dist"
$LibName = "NitroNodeOpenSSL-windows"

# MSBuild platform | vcvarsall argument | OpenSSL target | extra Configure options
# ARM64 without assembly: OpenSSL's ARM64 perlasm needs clang's assembler.
$Slices = @(
  @{ Platform = "x64"; VcVars = "x64"; Target = "VC-WIN64A"; Extra = @() },
  @{ Platform = "ARM64"; VcVars = "x64_arm64"; Target = "VC-WIN64-ARM"; Extra = @("no-asm") },
  @{ Platform = "Win32"; VcVars = "x64_x86"; Target = "VC-WIN32"; Extra = @() }
)

function Get-Source {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
  if (Test-Path $Src) { return }
  $tarball = Join-Path $Work "openssl-$Version.tar.gz"
  $base = "https://github.com/openssl/openssl/releases/download/openssl-$Version"
  Write-Host "==> Downloading OpenSSL $Version"
  Invoke-WebRequest -Uri "$base/openssl-$Version.tar.gz" -OutFile $tarball
  Invoke-WebRequest -Uri "$base/openssl-$Version.tar.gz.sha256" -OutFile "$tarball.sha256"
  $expected = ((Get-Content "$tarball.sha256" -Raw).Trim() -split "\s+")[0]
  $actual = (Get-FileHash -Algorithm SHA256 $tarball).Hash
  if ($actual -ne $expected.ToUpper()) { throw "OpenSSL checksum mismatch: expected $expected, got $actual" }
  tar -xzf $tarball -C $Work
}

function Get-VcVarsAll {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio/Installer/vswhere.exe"
  $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $vs) { throw "Visual Studio with the C++ tools not found" }
  return Join-Path $vs "VC/Auxiliary/Build/vcvarsall.bat"
}

Get-Source
$vcvarsall = Get-VcVarsAll
Remove-Item -Recurse -Force $Dist -ErrorAction SilentlyContinue

foreach ($slice in $Slices) {
  $build = Join-Path $Work "build-$($slice.Platform)"
  $prefix = Join-Path $Dist $slice.Platform
  Remove-Item -Recurse -Force $build -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $build | Out-Null
  Write-Host "==> Building $($slice.Platform)"

  # /MD last: OpenSSL builds its static libraries with /MT, and the last flag
  # wins. NitroNode.dll uses the DLL runtime, and mixing the two in one DLL
  # breaks at link time or with two heaps.
  $configure = @(
    "perl", "`"$Src/Configure`"", $slice.Target,
    "no-shared", "no-tests", "no-apps", "no-docs"
  ) + $slice.Extra + @(
    "--prefix=`"$prefix`"", "--openssldir=`"$prefix/ssl`"", "/MD"
  )
  $commands = "`"$vcvarsall`" $($slice.VcVars) && cd /d `"$build`" && $($configure -join ' ') && nmake && nmake install_sw"
  cmd /c $commands
  if ($LASTEXITCODE -ne 0) { throw "OpenSSL build failed for $($slice.Platform)" }

  # Only what NitroNode.vcxproj uses
  Remove-Item -Recurse -Force (Join-Path $prefix "bin"), (Join-Path $prefix "ssl"), (Join-Path $prefix "lib/pkgconfig"), (Join-Path $prefix "lib/cmake"), (Join-Path $prefix "lib/engines-3"), (Join-Path $prefix "lib/ossl-modules") -ErrorAction SilentlyContinue
}

$zip = Join-Path $Work "$LibName-$Version.zip"
Remove-Item -Force $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $Dist "*") -DestinationPath $zip
$sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
Write-Host "==> $zip"
Write-Host "    sha256: $sha (NitroNodeOpenSSLSha256 in windows/NitroNode/NitroNode.vcxproj)"

if ($Install) {
  $openssl = Join-Path $Root "windows/openssl"
  Remove-Item -Recurse -Force $openssl -ErrorAction SilentlyContinue
  Expand-Archive -Path $zip -DestinationPath $openssl
  Write-Host "==> Extracted into $openssl"
}
