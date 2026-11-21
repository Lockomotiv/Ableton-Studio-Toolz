# Lädt AbletonOSC in exakt der Version, gegen die Connect Studio geprüft wurde.
$ErrorActionPreference = "Stop"
$Commit = "0ca68214bd62c9b5cb641ca34006cfd70ba94430"
$Root = Split-Path -Parent $PSScriptRoot
$Dest = Join-Path $Root "tests\integration\abletonosc-harness\vendor\AbletonOSC"
if (Test-Path (Join-Path $Dest ".git")) {
  $head = git -C $Dest rev-parse HEAD
  if ($head -eq $Commit) { Write-Host "AbletonOSC $Commit bereits vorhanden: $Dest"; exit 0 }
}
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force $Dest | Out-Null
git -C $Dest init -q
git -C $Dest remote add origin https://github.com/ideoforms/AbletonOSC.git
git -C $Dest fetch -q --depth 1 origin $Commit
git -C $Dest checkout -q FETCH_HEAD
Write-Host "AbletonOSC $(git -C $Dest rev-parse HEAD) -> $Dest"
