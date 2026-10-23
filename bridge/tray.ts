import fs from 'node:fs'
import path from 'node:path'
import { startBackground } from './process'
import type { ChildProcess } from './process'

/**
 * The tray icon (Windows): a small icon by the clock that shows whether the Bridge is connected, busy or paused,
 * with a menu to pause everything at once, see recent activity, open the Computers page, or quit. It is one
 * fixed PowerShell script. It only reads the Bridge's state file and writes the pause/quit switch files
 * (see control.ts); it opens no port, talks to no server, and nothing from OpenLobs is placed inside it.
 * If the Bridge stops, the icon notices (the state file goes stale) and removes itself.
 */
export const TRAY_SCRIPT = String.raw`param([string]$Dir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$stateFile = Join-Path $Dir 'state.json'
$pauseFile = Join-Path $Dir 'paused.flag'
$quitFile = Join-Path $Dir 'quit.flag'
$logFile = Join-Path $Dir 'bridge.log'

function New-Dot($r, $g, $b) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.SmoothingMode = 'AntiAlias'
  $gfx.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $g, $b))
  $gfx.FillEllipse($brush, 3, 3, 26, 26)
  $gfx.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$script:iconOk = New-Dot 22 163 74
$script:iconBusy = New-Dot 234 138 0
$script:iconOff = New-Dot 140 140 140
$script:iconPaused = New-Dot 220 38 38

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $script:iconOff
$tray.Text = 'OpenLobs Bridge'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('OpenLobs Bridge')
$statusItem.Enabled = $false
[void]$menu.Items.Add('-')
$pauseItem = $menu.Items.Add('Pause everything now')
$activityItem = $menu.Items.Add('Show recent activity')
$openItem = $menu.Items.Add('Open OpenLobs Computers page')
[void]$menu.Items.Add('-')
$quitItem = $menu.Items.Add('Quit the Bridge')
$tray.ContextMenuStrip = $menu
$script:server = ''

$pauseItem.add_Click({
  if (Test-Path -LiteralPath $pauseFile) { Remove-Item -LiteralPath $pauseFile -Force } else { Set-Content -LiteralPath $pauseFile -Value 'paused' }
})
$activityItem.add_Click({
  if (Test-Path -LiteralPath $logFile) { Start-Process -FilePath 'notepad.exe' -ArgumentList ('"' + $logFile + '"') }
})
$openItem.add_Click({
  $s = [string]$script:server
  if ($s.StartsWith('https://') -or $s.StartsWith('http://localhost') -or $s.StartsWith('http://127.0.0.1')) { Start-Process -FilePath ($s.TrimEnd('/') + '/computers') }
})
$quitItem.add_Click({
  Set-Content -LiteralPath $quitFile -Value 'quit'
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
  try {
    if (-not (Test-Path -LiteralPath $stateFile)) { return }
    $age = (Get-Date) - (Get-Item -LiteralPath $stateFile).LastWriteTime
    if ($age.TotalSeconds -gt 20) { $tray.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
    $st = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
    $script:server = [string]$st.server
    if ($st.paused) {
      $tray.Icon = $script:iconPaused; $statusItem.Text = 'Paused: nothing will run'; $pauseItem.Text = 'Resume'
    } elseif (-not $st.connected) {
      $tray.Icon = $script:iconOff; $statusItem.Text = 'Not connected to OpenLobs'; $pauseItem.Text = 'Pause everything now'
    } elseif ($st.busy) {
      $tray.Icon = $script:iconBusy; $statusItem.Text = 'Working: ' + [string]$st.busy; $pauseItem.Text = 'Pause everything now'
    } else {
      $tray.Icon = $script:iconOk; $statusItem.Text = 'Connected, waiting'; $pauseItem.Text = 'Pause everything now'
    }
    $text = 'OpenLobs Bridge: ' + $statusItem.Text
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $tray.Text = $text
  } catch { }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Dispose()
`

/** Writes the script to the Bridge's folder and starts it. Returns the running icon, or null where there is no tray (not Windows). */
export function startTray(dir: string): ChildProcess | null {
  if (process.platform !== 'win32') return null
  fs.mkdirSync(dir, { recursive: true })
  const script = path.join(dir, 'tray.ps1')
  fs.writeFileSync(script, `﻿${TRAY_SCRIPT}`, 'utf8')
  return startBackground('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-Dir', dir])
}
