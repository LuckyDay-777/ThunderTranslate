Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$baseDir = "c:\Antigravity\thunderbird_translator"
$zipPath = Join-Path $baseDir "ThunderTranslate.xpi"

if (Test-Path $zipPath) { Remove-Item $zipPath }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)

$files = @(
    "manifest.json",
    "background.js",
    "crypto.js",
    "i18n.js",
    "PRIVACY_POLICY.txt",
    "_locales/ja/messages.json",
    "_locales/en/messages.json",
    "content/content.js",
    "content/content.css",
    "options/options.html",
    "options/options.js",
    "options/options.css",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-64.png",
    "icons/icon-128.png",
    "icons/icon-256.png",
    "icons/icon-512.png"
)

foreach ($f in $files) {
    $fullPath = Join-Path $baseDir $f
    $entry = $zip.CreateEntry($f, [System.IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($fullPath)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
}

$zip.Dispose()

Write-Host "Created XPI successfully: $zipPath"
$check = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$check.Entries | Select-Object FullName, Length | Format-Table -AutoSize
$check.Dispose()
