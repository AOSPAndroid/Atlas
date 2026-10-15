# Reads text from the Atlas operator's own session: the window in front, the whole screen or the
# clipboard. Windows OCR (Windows.Media.Ocr) is built in; nothing is installed. The screenshot is a
# temporary file deleted before this script ends; only text and the window title are returned.
# Expects $Mode ('window', 'screen' or 'clipboard') and $Delay (seconds) to be set by the caller.
$ErrorActionPreference = 'Stop'
function Done($data) { [Console]::Out.Write(($data | ConvertTo-Json -Compress -Depth 4)); exit 0 }

Add-Type -Namespace AtlasScreen -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
[void][AtlasScreen.Native]::SetProcessDPIAware()
if ($Delay -gt 0) { Start-Sleep -Seconds $Delay }

$handle = [AtlasScreen.Native]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 512
[void][AtlasScreen.Native]::GetWindowText($handle, $title, 512)
$processId = [uint32]0
[void][AtlasScreen.Native]::GetWindowThreadProcessId($handle, [ref]$processId)
$processName = try { (Get-Process -Id $processId).ProcessName } catch { '' }
$window = @{ title = $title.ToString(); process = $processName }

if ($Mode -eq 'clipboard') {
  Add-Type -AssemblyName System.Windows.Forms
  $text = [System.Windows.Forms.Clipboard]::GetText()
  Done @{ source = 'clipboard'; title = $window.title; process = $window.process; text = [string]$text; lines = 0 }
}

Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($Mode -eq 'window') {
  $rect = New-Object AtlasScreen.Native+RECT
  if ([AtlasScreen.Native]::IsIconic($handle) -or -not [AtlasScreen.Native]::GetWindowRect($handle, [ref]$rect)) {
    throw 'The window in front could not be measured. Bring the ticket or chat to the front and retry.'
  }
  $area = [System.Drawing.Rectangle]::FromLTRB($rect.Left, $rect.Top, $rect.Right, $rect.Bottom)
  $bounds = [System.Drawing.Rectangle]::Intersect($area, $screen)
} else {
  $bounds = $screen
}
if ($bounds.Width -lt 20 -or $bounds.Height -lt 20) { throw 'The window in front is too small to read.' }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($operation, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  [void]$task.Wait(-1)
  $task.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows text recognition has no language installed for this account.' }

# Small text reads better enlarged; stay within the engine's size limit.
$limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$scale = [Math]::Min(2.0, [Math]::Min($limit / $bounds.Width, $limit / $bounds.Height))
$path = Join-Path ([IO.Path]::GetTempPath()) ('atlas-screen-' + [guid]::NewGuid().ToString('N') + '.png')
try {
  $shot = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($shot)
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
  $graphics.Dispose()
  $width = [int]($bounds.Width * $scale); $height = [int]($bounds.Height * $scale)
  $scaled = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($scaled)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($shot, 0, 0, $width, $height)
  $graphics.Dispose(); $shot.Dispose()
  $scaled.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $scaled.Dispose()

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose(); $bitmap.Dispose()
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  Done @{ source = $Mode; title = $window.title; process = $window.process; text = ($lines -join "`n");
          lines = $lines.Count; language = $engine.RecognizerLanguage.LanguageTag }
} finally {
  Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
}
