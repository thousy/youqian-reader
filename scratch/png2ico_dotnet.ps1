Add-Type -AssemblyName System.Drawing

$pngPath = "D:\reader\resources\icon_256.png"
$icoPath = "D:\reader\resources\icon.ico"

try {
    $bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
    $hIcon = $bmp.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    
    $fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
    
    $icon.Dispose()
    $bmp.Dispose()
    
    Write-Output "Successfully converted $pngPath to standard Windows DIB ICO at $icoPath"
} catch {
    Write-Error "Failed to convert PNG to ICO: $_"
    exit 1
}
