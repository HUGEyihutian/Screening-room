# 给每张海报算"镜头焦点"和"画面感"分数 → ..\site\focal.js
# 焦点：人脸肤色 + 有色彩的局部反差；大块黑白文字（低饱和、高反差）扣分。画面感：整体肤色/色彩占比。
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$dir = Join-Path $root 'site\posters'
$gw = 20; $gh = 30
$out = [ordered]@{}
foreach ($f in Get-ChildItem $dir -Filter *.jpg) {
  $src = [Drawing.Image]::FromFile($f.FullName)
  $bmp = New-Object Drawing.Bitmap $gw, $gh
  $g = [Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($src, 0, 0, $gw, $gh); $g.Dispose(); $src.Dispose()
  $L = New-Object double[] ($gw*$gh); $K = New-Object double[] ($gw*$gh); $C = New-Object double[] ($gw*$gh)
  for ($y=0; $y -lt $gh; $y++) { for ($x=0; $x -lt $gw; $x++) {
    $p = $bmp.GetPixel($x,$y); $r=$p.R; $gg=$p.G; $b=$p.B; $i=$y*$gw+$x
    $L[$i] = .3*$r + .59*$gg + .11*$b
    $mx=[Math]::Max($r,[Math]::Max($gg,$b)); $mn=[Math]::Min($r,[Math]::Min($gg,$b))
    $C[$i] = if ($mx -gt 0) { ($mx-$mn)/$mx } else { 0 }
    $K[$i] = if ($r -gt 95 -and $gg -gt 40 -and $b -gt 20 -and $r -gt $gg -and $r -gt $b -and ($r-$mn) -gt 15 -and [Math]::Abs($r-$gg) -gt 15) { 1 } else { 0 }
  } }
  $bmp.Dispose()
  $best=-99; $bx=10; $by=11
  for ($j=3; $j -lt $gh-8; $j++) { for ($i=2; $i -lt $gw-2; $i++) {
    $s=0; $s2=0; $k=0; $c=0
    for ($v=-2; $v -le 2; $v++) { for ($u=-2; $u -le 2; $u++) { $q=($j+$v)*$gw+$i+$u; $s+=$L[$q]; $s2+=$L[$q]*$L[$q]; $k+=$K[$q]; $c+=$C[$q] } }
    $sd=[Math]::Sqrt([Math]::Max(0, $s2/25 - [Math]::Pow($s/25,2)))
    $col=$c/25
    $score = $sd/55*(0.35+0.65*[Math]::Min(1,$col*2.5)) + $k/25*1.6 - [Math]::Abs($i-$gw/2)/$gw*.4
    if ($score -gt $best) { $best=$score; $bx=$i; $by=$j }
  } }
  $skin = ($K | Measure-Object -Sum).Sum / $K.Length
  $colr = ($C | Measure-Object -Average).Average
  $photo = [Math]::Round($skin*2 + $colr + $best*.3, 3)
  $out[$f.BaseName] = @([Math]::Round(($bx+.5)/$gw,3), [Math]::Round(($by+.5)/$gh,3), $photo)
}
$js = "// 由 build\focal.ps1 生成：[焦点x, 焦点y, 画面感]`nwindow.FILM_FOCAL = " + ($out | ConvertTo-Json -Compress) + ";`n"
[IO.File]::WriteAllText((Join-Path $root 'site\focal.js'), $js, (New-Object Text.UTF8Encoding $false))
$out.GetEnumerator() | Sort-Object { $_.Value[2] } -Descending | Select-Object -First 8 | ForEach-Object { "$($_.Key) $($_.Value -join ' ')" }
"..."
$out.GetEnumerator() | Sort-Object { $_.Value[2] } | Select-Object -First 6 | ForEach-Object { "$($_.Key) $($_.Value -join ' ')" }
