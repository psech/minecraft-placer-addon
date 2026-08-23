$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"

$BehaviorPack = Join-Path $Root "src\behavior_pack"
$ResourcePack = Join-Path $Root "src\resource_pack"

$BehaviorZip = Join-Path $Dist "Placer_BP.zip"
$ResourceZip = Join-Path $Dist "Placer_RP.zip"
$AddonZip = Join-Path $Dist "Placer.zip"

$BehaviorMcpack = Join-Path $Dist "Placer_BP.mcpack"
$ResourceMcpack = Join-Path $Dist "Placer_RP.mcpack"
$Addon = Join-Path $Dist "Placer.mcaddon"

Write-Host "Cleaning dist..."

if (Test-Path $Dist) {
    Remove-Item $Dist -Recurse -Force
}

New-Item -ItemType Directory -Path $Dist | Out-Null

Write-Host "Building Behavior Pack..."

Compress-Archive `
    -Path "$BehaviorPack\*" `
    -DestinationPath $BehaviorZip

Rename-Item $BehaviorZip $BehaviorMcpack

Write-Host "Building Resource Pack..."

Compress-Archive `
    -Path "$ResourcePack\*" `
    -DestinationPath $ResourceZip

Rename-Item $ResourceZip $ResourceMcpack

Write-Host "Building MCAddon..."

Compress-Archive `
    -Path $BehaviorMcpack, $ResourceMcpack `
    -DestinationPath $AddonZip

Rename-Item $AddonZip $Addon

Write-Host ""
Write-Host "Build complete:"
Write-Host "  $Addon"
