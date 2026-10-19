Add-Type -AssemblyName System.Drawing

$output = Join-Path (Get-Location) "public"
New-Item -ItemType Directory -Path $output -Force | Out-Null

foreach ($size in @(16, 32, 48, 128)) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $radius = [Math]::Max(3, [int]($size * 0.23))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255, 0, 145, 205))
  $graphics.FillPath($brush, $path)
  $fontSize = [Math]::Max(7, [single]($size * 0.56))
  $font = New-Object System.Drawing.Font -ArgumentList "Microsoft YaHei", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF -ArgumentList 0, 0, $size, $size
  $graphics.DrawString("S", $font, [System.Drawing.Brushes]::White, $rect, $format)
  $fileName = "icon" + $size + ".png"
  $targetPath = Join-Path $output $fileName
  $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $font.Dispose()
  $brush.Dispose()
  $path.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
