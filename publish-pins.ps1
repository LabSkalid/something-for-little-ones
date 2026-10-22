Add-Type -AssemblyName System.Drawing
$src = "D:\KIDS\site\public\pins"
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
$n = 0
Get-ChildItem -Path $src -Filter *.png -File | ForEach-Object {
  $out = [System.IO.Path]::ChangeExtension($_.FullName, ".jpg")
  if ((Test-Path $out) -and ((Get-Item $out).LastWriteTime -ge $_.LastWriteTime)) { return }
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $img.Width, $img.Height)
  $bmp.Save($out, $codec, $params)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
  $n++
}
"Compressed new pins: $n"
