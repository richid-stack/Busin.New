param([string]$Installer, [string]$Server, [string]$Code, [string]$Out)
# Clicks through the real OpenLobs Bridge installer like a person would and photographs every screen, then the
# tray icon and its menu, the Start menu folder and the status window. Throwaway: runs only on GitHub's Windows machine.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
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
function Shot($name) {
  Start-Sleep -Milliseconds 900
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Out "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "shot: $name"
}
function Find-ByName($pattern, $root = $AE::RootElement) {
  $all = $root.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $all) { try { if ($e.Current.Name -match $pattern) { return $e } } catch {} }
  return $null
}
function Find-Setup {
  $kids = $AE::RootElement.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($k in $kids) { try { if ($k.Current.Name -match 'OpenLobs Bridge' -and $k.Current.ClassName -match 'TWizardForm|TSetupForm|#32770') { return $k } } catch {} }
  return $null
}
function Click-Right($el) {
  $r = $el.Current.BoundingRectangle
  $x = [int]($r.X + $r.Width / 2); $y = [int]($r.Y + $r.Height / 2)
  [Win32]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 300
  [Win32]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero); [Win32]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)
}

Shot 'desktop-before'
Start-Process -FilePath $Installer -ArgumentList "/SERVER=$Server", "/CODE=$Code"
Start-Sleep -Seconds 4
$page = 0
for ($i = 0; $i -lt 40; $i++) {
  $win = Find-Setup
  if (-not $win) { if ($page -gt 0) { break } else { Start-Sleep -Seconds 1; continue } }
  $btns = $win.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  $next = $null
  foreach ($b in $btns) { if ($b.Current.IsEnabled -and $b.Current.Name -match '^&?(Next|Install|Finish)') { $next = $b; break } }
  if ($next) {
    # On the permissions page, tick the one box so the picture shows a real choice.
    $boxes = $win.FindAll($TS::Descendants, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox)))
    foreach ($c in $boxes) { try { $p = $c.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); if ($p.Current.ToggleState -eq 'Off') { $p.Toggle() } } catch {} }
    $page++
    Shot ("installer-{0:d2}" -f $page)
    $name = $next.Current.Name
    try { $next.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { Write-Host "invoke failed on $name" }
    Start-Sleep -Seconds 2
  } else {
    Start-Sleep -Seconds 2
  }
}
Write-Host "wizard pages photographed: $page"

# Wait for the installed Bridge to start (it writes a state file) and settle.
$state = Join-Path $env:APPDATA 'OpenLobsBridge\state.json'
for ($i = 0; $i -lt 60 -and -not (Test-Path $state); $i++) { Start-Sleep -Seconds 1 }
Start-Sleep -Seconds 4
Shot 'desktop-after-install'

# The tray icon: new icons start in the hidden-icons flyout, so open it, photograph it, then open the icon's menu.
$chev = Find-ByName 'Show Hidden Icons|Notification Chevron'
if ($chev) { try { $chev.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() } catch { Click-Right $chev } ; Start-Sleep -Seconds 2 }
Shot 'tray-flyout'
$icon = Find-ByName '^OpenLobs Bridge'
if ($icon) { Click-Right $icon; Start-Sleep -Seconds 2; Shot 'tray-menu'; [System.Windows.Forms.SendKeys]::SendWait('{ESC}') } else { Write-Host 'tray icon not found by name' }

# Start menu folder.
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\OpenLobs Bridge'
Start-Process explorer.exe -ArgumentList "`"$menu`""
Start-Sleep -Seconds 5
Shot 'start-menu-folder'
Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'OpenLobs' } | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }

# The status window (what "Bridge status" in the Start menu opens).
$app = Join-Path $env:LOCALAPPDATA 'Programs\OpenLobs Bridge'
$p = Start-Process cmd.exe -ArgumentList '/k', "`"`"$app\bridge.cmd`" status`"" -PassThru
Start-Sleep -Seconds 5
Shot 'bridge-status'
try { Stop-Process -Id $p.Id -Force } catch {}
Write-Host 'done'
