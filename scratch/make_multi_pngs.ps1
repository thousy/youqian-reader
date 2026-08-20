Add-Type -AssemblyName System.Drawing

$srcPath = "D:\reader\resources\exmaple.png"
$sizes = @(256, 128, 64, 48, 32, 16)

try {
    $src = [System.Drawing.Image]::FromFile($srcPath)
    
    foreach ($size in $sizes) {
        $destPath = "D:\reader\scratch\icon_$size.png"
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($src, 0, 0, $size, $size)
        
        $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
        
        $g.Dispose()
        $bmp.Dispose()
        Write-Output "Generated: $destPath"
    }
    
    $src.Dispose()
    Write-Output "Successfully generated all multi-resolution PNG sources."
} catch {
    Write-Error "Failed to generate resized PNGs: $_"
    exit 1
}
