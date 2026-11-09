import { runProgram } from './process'

/** On Windows, shows the usual "choose a folder" window so nobody has to type a path. The script is fixed and takes no input. */
const SCRIPT = 'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = "Choose the one folder OpenLobs may use for spreadsheets"; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }'

export async function pickFolder(): Promise<string | null> {
  if (process.platform !== 'win32') return null
  const r = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', SCRIPT], { timeoutMs: 5 * 60_000 })
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null
}
