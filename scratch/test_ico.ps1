Add-Type -AssemblyName System.Drawing

$icoPath = "D:\reader\resources\icon.ico"
$outPng = "D:\reader\scratch\ico_test.png"

try {
    $icon = New-Object System.Drawing.Icon($icoPath)
    $bmp = $icon.ToBitmap()
    $bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $icon.Dispose()
    Write-Output "Successfully tested ICO and saved to $outPng"
} catch {
    Write-Error "ICO file is invalid: $_"
    exit 1
}
