# 本地静态服务器（无 Node/Python 环境用）：powershell -File serve.ps1 [-Port 8765]
param([int]$Port = 8765)
$root = Join-Path (Split-Path $PSScriptRoot) 'site'
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css'; '.jpg'='image/jpeg'; '.png'='image/png'; '.json'='application/json'; '.svg'='image/svg+xml' }
$l = [Net.HttpListener]::new(); $l.Prefixes.Add("http://localhost:$Port/"); $l.Start()
Write-Host "serving $root on http://localhost:$Port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/')); if (-not $p) { $p = 'index.html' }
    if ($c.Request.HttpMethod -eq 'POST' -and $p -eq 'snap') {   # 自检截图：body 是 dataURL
      $name = $c.Request.QueryString['name']; if (-not $name) { $name = 'snap' }
      $body = (New-Object IO.StreamReader($c.Request.InputStream)).ReadToEnd()
      $dir = Join-Path (Split-Path $PSScriptRoot) 'shots'; New-Item -ItemType Directory -Force $dir | Out-Null
      [IO.File]::WriteAllBytes((Join-Path $dir "$name.jpg"), [Convert]::FromBase64String(($body -split ',', 2)[1]))
      $c.Response.StatusCode = 204; continue
    }
    $f = Join-Path $root $p
    if (Test-Path $f -PathType Leaf) {
      $b = [IO.File]::ReadAllBytes($f)
      if ($p -eq 'index.html') {   # 模拟发布时的外壳
        $b = [Text.Encoding]::UTF8.GetBytes("<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1,viewport-fit=cover'></head><body>" + [Text.Encoding]::UTF8.GetString($b) + "</body></html>")
      }
      $ext = [IO.Path]::GetExtension($f).ToLower()
      $c.Response.ContentType = $(if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' })
      $c.Response.Headers.Add('Cache-Control', 'no-store')
      $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch {} finally { $c.Response.Close() }
}
