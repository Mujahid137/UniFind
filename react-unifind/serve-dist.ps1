$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot "dist"
$port = if ($env:PORT) { [int]$env:PORT } else { 5173 }
$prefix = "http://127.0.0.1:$port/"

if (-not (Test-Path $root)) {
  throw "Build output not found: $root"
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
$listener.Start()
Write-Host "UniFind static site running on $prefix"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg" = "image/svg+xml"
  ".ico" = "image/x-icon"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) {
      $client.Close()
      continue
    }

    while ($reader.ReadLine()) {}

    $requestPath = ($requestLine -split " ")[1]
    $requestPath = [System.Uri]::UnescapeDataString($requestPath.Split("?")[0].TrimStart("/"))
    $candidate = Join-Path $root $requestPath

    if ([string]::IsNullOrWhiteSpace($requestPath) -or -not (Test-Path $candidate -PathType Leaf)) {
      $candidate = Join-Path $root "index.html"
    }

    $extension = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
    $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
    $bytes = [System.IO.File]::ReadAllBytes($candidate)
    $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $client.Close()
  }
}
finally {
  $listener.Stop()
}
