param([string]$Installer, [string]$Server, [string]$Code, [string]$Out, [string]$Ffmpeg)
# Films the real OpenLobs Bridge installer on GitHub's Windows machine the way a person would use it: the cursor moves to each button
# and clicks it, the address and pairing code are typed into their boxes, then the tray icon, the Start menu folder and the status
# window are shown. The screen is recorded with ffmpeg (gdigrab, cursor included). Runs only on GitHub's Windows machine.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$ALL = [System.Windows.Automation.Condition]::TrueCondition
function Pause-For($s) { Start-Sleep -Milliseconds ([int]($s * 1000)) }
function Shot($name) {
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "still: $name"
}
function Ease($t) { if ($t -lt 0.5) { return 4 * $t * $t * $t } else { return 1 - [Math]::Pow(-2 * $t + 2, 3) / 2 } }
function Glide($x, $y, $ms = 700) {
  $p = [System.Windows.Forms.Cursor]::Position
  $n = [Math]::Max(8, [int]($ms / 16))
  for ($i = 1; $i -le $n; $i++) {
    $e = Ease ($i / $n)
    [Win32]::SetCursorPos([int]($p.X + ($x - $p.X) * $e), [int]($p.Y + ($y - $p.Y) * $e)) | Out-Null
    Start-Sleep -Milliseconds ([int]($ms / $n))
  }
}
function Center($el) { $r = $el.Current.BoundingRectangle; return @([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2)) }
function Click-At($x, $y, $right = $false) {
  Glide $x $y 700; Start-Sleep -Milliseconds 200
  if ($right) { [Win32]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [Win32]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero) }
  else { [Win32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [Win32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 250
}
function Click-El($el, $right = $false) { $c = Center $el; Click-At $c[0] $c[1] $right }
function Type-Slow($text) {
  foreach ($ch in $text.ToCharArray()) {
    $s = [string]$ch
    if ('+^%~(){}[]'.Contains($s)) { $s = '{' + $s + '}' }
    [System.Windows.Forms.SendKeys]::SendWait($s)
    Start-Sleep -Milliseconds (55 + (Get-Random -Maximum 40))
  }
}
function Find-ByName($pattern, $root = $AE::RootElement) {
  foreach ($e in $root.FindAll($TS::Descendants, $ALL)) { try { if ($e.Current.Name -match $pattern) { return $e } } catch {} }
  return $null
}
function Find-Setup {
  foreach ($k in $AE::RootElement.FindAll($TS::Children, $ALL)) { try { if ($k.Current.Name -match '^Setup - OpenLobs Bridge') { return $k } } catch {} }
  return $null
}
function Kids($win, $type) { return $win.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type))) }

function Dismiss-Popups {
  # Windows itself sometimes shows a "System Properties: created a temporary paging file" notice on a fresh machine. It is not part
  # of the installer, so it is closed before and during the recording.
  foreach ($k in $AE::RootElement.FindAll($TS::Children, $ALL)) {
    try {
      if ($k.Current.Name -eq 'System Properties') {
        foreach ($b in $k.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))) {
          if ($b.Current.Name -match '^OK$') { ($b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); Write-Host 'closed a Windows notice'; Start-Sleep -Milliseconds 500; break }
        }
      }
    } catch {}
  }
}
function Win-Rect($win) { return $win.Current.BoundingRectangle }
function Click-In($win, $dx, $dy) { $r = Win-Rect $win; Click-At ([int]($r.X + $dx)) ([int]($r.Y + $dy)) }
function Hover-In($win, $dx, $dy) { $r = Win-Rect $win; Glide ([int]($r.X + $dx)) ([int]($r.Y + $dy)) 700 }

# ---- start the screen recording ----
Dismiss-Popups; Start-Sleep -Seconds 1; Dismiss-Popups
$video = Join-Path $Out 'bridge-install-raw.mp4'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Ffmpeg
$psi.Arguments = "-y -f gdigrab -framerate 15 -draw_mouse 1 -i desktop -vf `"scale=trunc(iw/2)*2:trunc(ih/2)*2`" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p `"$video`""
$psi.RedirectStandardInput = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$ff = [System.Diagnostics.Process]::Start($psi)
Write-Host "recording started (ffmpeg pid $($ff.Id))"

try {
  (New-Object -ComObject Shell.Application).MinimizeAll()
  Pause-For 2.5
  [Win32]::SetCursorPos(700, 500) | Out-Null
  Shot 'film-desktop'
  Pause-For 1.5
  # The person double-clicks the installer they downloaded.
  Start-Process -FilePath $Installer
  Pause-For 4
  $page = 0; $seen = @{}; $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt 240) {
    Dismiss-Popups
    $win = Find-Setup
    if (-not $win) { if ($page -gt 0) { break } else { Start-Sleep -Seconds 1; continue } }
    $next = $null
    foreach ($b in (Kids $win ([System.Windows.Automation.ControlType]::Button))) { if ($b.Current.IsEnabled -and $b.Current.Name -match '^&?(Next|Install|Finish)') { $next = $b; break } }
    # While files are being copied there is no enabled button: just wait and let the progress bar run.
    if (-not $next) { Start-Sleep -Milliseconds 700; continue }
    $label = $next.Current.Name -replace '&', ''
    $isConnect = $null -ne (Find-ByName 'Pairing code' $win)
    $isPerm = $null -ne (Find-ByName 'may do on this computer' $win)
    $key = if ($isConnect) { 'connect' } elseif ($isPerm) { 'perm' } else { $label }
    if ($seen[$key]) { Start-Sleep -Milliseconds 700; continue }   # already handled; the window is changing page
    $seen[$key] = $true
    $page++
    Shot ("film-page-{0:d2}" -f $page)
    Pause-For 2.0
    if ($isConnect) {
      # The Inno edit boxes are not exposed to UI Automation, so they are clicked at their place on the page (the window is a fixed size).
      Click-In $win 298 187; [System.Windows.Forms.SendKeys]::SendWait('^a'); Type-Slow $Server
      Pause-For 0.7
      Click-In $win 298 241; [System.Windows.Forms.SendKeys]::SendWait('^a'); Type-Slow $Code
      Pause-For 1.8
      Shot 'film-connect-typed'
    }
    if ($isPerm) {
      # Left at the default (nothing extra allowed); the cursor rests on the choice so it can be read.
      Hover-In $win 120 153; Pause-For 3
    }
    Click-El $next
    if ($label -match 'Install') { Pause-For 1.5 }
    Pause-For 2.0
  }
  Write-Host "wizard pages filmed: $page"

  # Wait for the installed Bridge to start (it writes a state file), then show it.
  $state = Join-Path $env:APPDATA 'OpenLobsBridge\state.json'
  for ($i = 0; $i -lt 25 -and -not (Test-Path $state); $i++) { Start-Sleep -Seconds 1; Dismiss-Popups }
  Pause-For 3
  Shot 'film-after-install'

  # The tray icon: new icons start in the hidden-icons flyout.
  $chev = Find-ByName 'Show Hidden Icons|Notification Chevron'
  if ($chev) { Click-El $chev; Pause-For 2 }
  Shot 'film-tray'
  $icon = Find-ByName '^OpenLobs Bridge'
  if ($icon) { Click-El $icon $true; Pause-For 2.5; Shot 'film-tray-menu'; [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Pause-For 1 } else { Write-Host 'tray icon not found by name' }
  [System.Windows.Forms.SendKeys]::SendWait('{ESC}')

  # The Start menu folder the installer made.
  $menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\OpenLobs Bridge'
  (New-Object -ComObject Shell.Application).MinimizeAll()
  Pause-For 1
  Start-Process explorer.exe -ArgumentList "`"$menu`""
  Pause-For 6
  Shot 'film-start-menu-folder'
  Pause-For 1.5
  Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'OpenLobs' } | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
  Pause-For 1

  # What "Bridge status" in the Start menu opens: it says it is paired and what is allowed.
  $app = Join-Path $env:LOCALAPPDATA 'Programs\OpenLobs Bridge'
  $p = Start-Process cmd.exe -ArgumentList '/k', "`"`"$app\bridge.cmd`" status`"" -PassThru
  Pause-For 6
  Shot 'film-bridge-status'
  Pause-For 2
  try { Stop-Process -Id $p.Id -Force } catch {}
  Pause-For 1
} finally {
  try { $ff.StandardInput.WriteLine('q') } catch {}
  if (-not $ff.WaitForExit(30000)) { try { $ff.Kill() } catch {} }
  Write-Host "recording stopped"
}
Write-Host 'done'
