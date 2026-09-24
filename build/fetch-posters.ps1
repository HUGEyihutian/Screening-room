# 按 info.tsv 里的 IMDb 编号下载海报到 ..\site\posters\<id>.jpg（已存在的跳过）
param([string[]]$Only)
$root = Split-Path $PSScriptRoot
$out = Join-Path $root 'site\posters'
New-Item -ItemType Directory -Force $out | Out-Null
$ids = Import-Csv (Join-Path $PSScriptRoot 'info.tsv') -Delimiter "`t" | ForEach-Object imdb
if ($Only) { $ids = $Only }
foreach ($id in $ids) {
  $f = Join-Path $out "$id.jpg"
  if (Test-Path $f) { continue }
  try {
    $d = (Invoke-RestMethod "https://v3.sg.media-imdb.com/suggestion/x/$id.json" -TimeoutSec 20).d | Where-Object id -eq $id | Select-Object -First 1
    $img = $d.i.imageUrl
    if (-not $img) { Write-Host "NOIMG $id"; continue }
    $url = $img -replace '\._V1_.*\.jpg$', '._V1_QL82_UX500_.jpg'
    Invoke-WebRequest $url -OutFile $f -UseBasicParsing -TimeoutSec 30
    Write-Host "ok $id $((Get-Item $f).Length)"
  } catch { Write-Host "ERR $id $($_.Exception.Message)" }
}
