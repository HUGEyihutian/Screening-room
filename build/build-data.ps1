# 把 order.tsv（片单快照+顺序）和 info.tsv（IMDb 详情）合成 ..\site\data.js
$root = Split-Path $PSScriptRoot
$order = Import-Csv (Join-Path $PSScriptRoot 'order.tsv') -Delimiter "`t" -Encoding UTF8
$info  = Import-Csv (Join-Path $PSScriptRoot 'info.tsv')  -Delimiter "`t" -Encoding UTF8
$posters = Get-ChildItem (Join-Path $root 'site\posters') -Filter *.jpg | ForEach-Object BaseName

$snap = foreach ($r in $order) {
  [ordered]@{ id=$r.page; imdb=$r.imdb; title=$r.title; orig=$r.orig; en=$r.en; year=[int]$r.year;
              group=$r.group; cast=$r.cast; douban=$r.douban }
}
$inf = [ordered]@{}
foreach ($r in $info) {
  $inf[$r.imdb] = [ordered]@{ dir=$r.dir; min=[int]$r.min; genres=$r.genres; imdbRating=[double]$r.rating;
                              country=$r.country; kind=$r.kind; synopsis=$r.synopsis }
}
$js = "// 由 build\build-data.ps1 生成，勿手改`n" +
      "window.FILM_SNAPSHOT = " + ($snap | ConvertTo-Json -Depth 4 -Compress) + ";`n" +
      "window.FILM_INFO = " + ($inf | ConvertTo-Json -Depth 4 -Compress) + ";`n" +
      "window.FILM_POSTERS = " + (@($posters) | ConvertTo-Json -Compress) + ";`n"
[IO.File]::WriteAllText((Join-Path $root 'site\data.js'), $js, (New-Object Text.UTF8Encoding $false))
"films: $($snap.Count)  info: $($inf.Count)  posters: $(@($posters).Count)"
