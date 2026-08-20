Add-Type -AssemblyName System.Drawing

$exePath = "D:\reader\release\win-unpacked\YouQian Reader.exe"
$outPng = "D:\reader\scratch\extracted_icon.png"

try {
    if (-not (Test-Path $exePath)) {
        Write-Error "EXE file not found at $exePath"
        exit 1
    }
    
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath)
    $bmp = $icon.ToBitmap()
    $bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $icon.Dispose()
    
    Write-Output "Successfully extracted EXE icon to $outPng"
} catch {
    Write-Error "Failed to extract icon: $_"
    exit 1
}
