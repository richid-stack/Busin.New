import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProgram } from '../process'
import type { ChartSpec } from './ops'

/**
 * Spreadsheet programs on the computer. After the file layer has written a workbook, a real spreadsheet program
 * opens it, recalculates every formula, adds the charts, reports any cell that shows an error, can save a PDF,
 * and saves it again. Two engines: Microsoft Excel (through its own automation, Windows) and LibreOffice.
 *
 * What runs is one of the two FIXED scripts below. Nothing from OpenLobs is ever placed inside a script: the
 * work to do is written to a small JSON file that the script reads as plain data, and every value in it was
 * checked by the shared schemas first (cell and range addresses, a chart type from a short list, a title).
 */

export interface EngineJob { file: string, charts: ChartSpec[], pdf: string | null }
export interface EngineOutcome { formulas: number, errors: string[], charts: number, pdf: boolean }
export interface Engine {
  name: 'excel' | 'libreoffice'
  run: (job: EngineJob, signal: AbortSignal) => Promise<EngineOutcome>
}

const TIMEOUT_MS = 90_000

// ---------------------------------------------------------------- Excel (PowerShell, fixed)
const EXCEL_SCRIPT = String.raw`param([string]$JobFile, [string]$ResultFile)
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -LiteralPath $JobFile | ConvertFrom-Json
$xl = $null
$wb = $null
$pidToKill = 0
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.Visible = $false
  $xl.DisplayAlerts = $false
  $xl.EnableEvents = $false
  $xl.AskToUpdateLinks = $false
  $xl.AutomationSecurity = 3
  try {
    Add-Type -Namespace Olb -Name Win -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int p);'
    $p = 0
    [void][Olb.Win]::GetWindowThreadProcessId([System.IntPtr]$xl.Hwnd, [ref]$p)
    $pidToKill = $p
  } catch { }
  $wb = $xl.Workbooks.Open($job.file, 0, $false)
  $xl.CalculateFull()
  $typeOf = @{ column = 51; bar = 57; line = 4; pie = 5 }
  $n = 0
  foreach ($c in @($job.charts)) {
    if ($null -eq $c) { continue }
    $n = $n + 1
    $ws = $wb.Worksheets.Item([string]$c.sheet)
    $anchor = $ws.Range([string]$c.anchor)
    $shape = $ws.Shapes.AddChart2(-1, [int]$typeOf[[string]$c.type], $anchor.Left, $anchor.Top, 420, 260)
    $chart = $shape.Chart
    while ($chart.SeriesCollection().Count -gt 0) { $chart.SeriesCollection(1).Delete() | Out-Null }
    $s = $chart.SeriesCollection().NewSeries()
    $s.Values = $ws.Range([string]$c.values)
    $s.XValues = $ws.Range([string]$c.categories)
    if ([string]$c.title -ne '') { $chart.HasTitle = $true; $chart.ChartTitle.Text = [string]$c.title } else { $chart.HasTitle = $false }
    if ([string]$c.type -ne 'pie') { $chart.HasLegend = $false }
  }
  $formulas = 0
  $errs = New-Object System.Collections.ArrayList
  foreach ($ws in $wb.Worksheets) {
    $range = $null
    try { $range = $ws.UsedRange.SpecialCells(-4123) } catch { }
    if ($null -ne $range) {
      $formulas = $formulas + [int]$range.Count
      $bad = $null
      try { $bad = $ws.UsedRange.SpecialCells(-4123, 16) } catch { }
      if ($null -ne $bad) {
        foreach ($cell in $bad.Cells) {
          if ($errs.Count -lt 20) { [void]$errs.Add($ws.Name + '!' + $cell.Address($false, $false)) }
        }
      }
    }
  }
  $wb.Save()
  $pdf = $false
  if ($null -ne $job.pdf -and [string]$job.pdf -ne '') {
    $wb.ExportAsFixedFormat(0, [string]$job.pdf)
    $pdf = $true
  }
  $result = @{ formulas = $formulas; errors = @($errs); charts = $n; pdf = $pdf }
  ($result | ConvertTo-Json -Compress) | Set-Content -LiteralPath $ResultFile -Encoding UTF8
} finally {
  if ($null -ne $wb) { try { $wb.Close($false) } catch { } }
  if ($null -ne $xl) { try { $xl.Quit() } catch { } }
  if ($pidToKill -gt 0) { Start-Sleep -Milliseconds 300; try { Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue } catch { } }
}
`

// ---------------------------------------------------------------- LibreOffice (Python-UNO, fixed)
const LIBREOFFICE_SCRIPT = String.raw`import sys, os, json, time, subprocess, uuid, tempfile, shutil
import uno
from com.sun.star.beans import PropertyValue

soffice, job_file, result_file = sys.argv[1], sys.argv[2], sys.argv[3]
job = json.load(open(job_file, encoding='utf-8'))

def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p

def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n

def split_range(rng):
    a, b = rng.split(':')
    import re
    ma = re.match(r'^([A-Z]+)([0-9]+)$', a)
    mb = re.match(r'^([A-Z]+)([0-9]+)$', b)
    return (col_index(ma.group(1)), int(ma.group(2)), col_index(mb.group(1)), int(mb.group(2)))

profile = tempfile.mkdtemp(prefix='olb-lo-')
pipe = 'olb_' + uuid.uuid4().hex[:12]
proc = subprocess.Popen([soffice, '--headless', '--invisible', '--norestore', '--nologo', '--nodefault', '--nolockcheck',
    '-env:UserInstallation=' + uno.systemPathToFileUrl(profile), '--accept=pipe,name=' + pipe + ';urp;'],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    ctx = None
    for _ in range(120):
        try:
            ctx = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
            break
        except Exception:
            time.sleep(0.5)
    if ctx is None:
        raise Exception('LibreOffice did not start.')
    smgr = ctx.ServiceManager
    desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
    doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(job['file']), '_blank', 0,
        (prop('Hidden', True), prop('ReadOnly', False), prop('MacroExecutionMode', 0), prop('UpdateDocMode', 0)))
    if doc is None:
        raise Exception('LibreOffice could not open the file.')
    doc.calculateAll()
    sheets = doc.Sheets
    made = 0
    for c in job['charts']:
        sheet = sheets.getByName(c['sheet'])
        c1, r1, c2, r2 = split_range(c['categories'])
        v1, s1, v2, s2 = split_range(c['values'])
        if r1 != s1 or r2 != s2 or v1 != v2 or c1 != c2 or v1 != c1 + 1:
            raise Exception('LibreOffice needs the labels in the column directly left of the values, over the same rows.')
        address = sheet.getCellRangeByPosition(c1 - 1, r1 - 1, v2 - 1, r2 - 1).RangeAddress
        anchor = sheet.getCellRangeByName(c['anchor'])
        rect = uno.createUnoStruct('com.sun.star.awt.Rectangle')
        rect.X = anchor.Position.X
        rect.Y = anchor.Position.Y
        rect.Width = 12000
        rect.Height = 8000
        made += 1
        name = 'OpenLobsChart' + str(made) + '_' + uuid.uuid4().hex[:6]
        sheet.Charts.addNewByName(name, rect, (address,), False, True)
        emb = sheet.Charts.getByName(name).EmbeddedObject
        kind = {'column': 'com.sun.star.chart.BarDiagram', 'bar': 'com.sun.star.chart.BarDiagram',
                'line': 'com.sun.star.chart.LineDiagram', 'pie': 'com.sun.star.chart.PieDiagram'}[c['type']]
        diagram = emb.createInstance(kind)
        emb.setDiagram(diagram)
        if c['type'] == 'bar':
            diagram.Vertical = True
        if c['title']:
            emb.HasMainTitle = True
            emb.Title.String = c['title']
        else:
            emb.HasMainTitle = False
        emb.HasLegend = (c['type'] == 'pie')
    formulas = 0
    errors = []
    for i in range(sheets.Count):
        sheet = sheets.getByIndex(i)
        cells = sheet.queryContentCells(16)
        en = cells.Cells.createEnumeration()
        while en.hasMoreElements() and formulas < 1000000:
            en.nextElement()
            formulas += 1
        bad = sheet.queryFormulaCells(4)
        text = bad.RangeAddressesAsString
        if text:
            for part in text.split(' ')[:20]:
                errors.append(sheet.Name + '!' + part.replace('$', ''))
    doc.storeToURL(uno.systemPathToFileUrl(job['file']), (prop('FilterName', 'Calc MS Excel 2007 XML'), prop('Overwrite', True)))
    pdf = False
    if job.get('pdf'):
        doc.storeToURL(uno.systemPathToFileUrl(job['pdf']), (prop('FilterName', 'calc_pdf_Export'), prop('Overwrite', True)))
        pdf = True
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass
    json.dump({'formulas': formulas, 'errors': errors[:20], 'charts': made, 'pdf': pdf}, open(result_file, 'w', encoding='utf-8'))
finally:
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    shutil.rmtree(profile, ignore_errors=True)
`

// ---------------------------------------------------------------- Finding and running
async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlobs-sheet-'))
  try { return await fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

function readOutcome(file: string, stderr: string, code: number, timedOut: boolean, who: string): EngineOutcome {
  if (timedOut) throw new Error(`${who} took too long and was stopped.`)
  let raw: any
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch { /* handled below */ }
  if (!raw || code !== 0) throw new Error(`${who} could not finish: ${stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]?.slice(0, 200) || 'no details'}`)
  return {
    formulas: Number(raw.formulas) || 0,
    errors: (Array.isArray(raw.errors) ? raw.errors : (raw.errors ? [raw.errors] : [])).map((e: unknown) => String(e).slice(0, 60)).slice(0, 20),
    charts: Number(raw.charts) || 0,
    pdf: raw.pdf === true
  }
}

export function excelEngine(): Engine {
  return {
    name: 'excel',
    async run(job, signal) {
      return inTempDir(async (dir) => {
        const script = path.join(dir, 'excel.ps1'); const jobFile = path.join(dir, 'job.json'); const result = path.join(dir, 'result.json')
        fs.writeFileSync(script, `﻿${EXCEL_SCRIPT}`, 'utf8')
        fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8')
        const r = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-JobFile', jobFile, '-ResultFile', result], { timeoutMs: TIMEOUT_MS, signal })
        return readOutcome(result, r.stderr, r.code, r.timedOut, 'Excel')
      })
    }
  }
}

export function libreOfficeEngine(soffice: string, python: string): Engine {
  return {
    name: 'libreoffice',
    async run(job, signal) {
      return inTempDir(async (dir) => {
        const script = path.join(dir, 'lo.py'); const jobFile = path.join(dir, 'job.json'); const result = path.join(dir, 'result.json')
        fs.writeFileSync(script, LIBREOFFICE_SCRIPT, 'utf8')
        fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8')
        const r = await runProgram(python, ['-I', script, soffice, jobFile, result], { timeoutMs: TIMEOUT_MS, signal })
        return readOutcome(result, r.stderr, r.code, r.timedOut, 'LibreOffice')
      })
    }
  }
}

const exists = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }

async function excelInstalled(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const r = await runProgram('reg.exe', ['query', 'HKEY_CLASSES_ROOT\\Excel.Application\\CLSID'], { timeoutMs: 8000 })
  return r.code === 0
}

async function findLibreOffice(): Promise<{ soffice: string, python: string } | null> {
  const candidates: string[] = []
  if (process.env.OPENLOBS_SOFFICE) candidates.push(process.env.OPENLOBS_SOFFICE)
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (base) candidates.push(path.join(base, 'LibreOffice', 'program', 'soffice.exe'))
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/LibreOffice.app/Contents/MacOS/soffice')
  } else {
    candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice')
  }
  const soffice = candidates.find(exists)
  if (!soffice) return null
  const bundled = path.join(path.dirname(soffice), process.platform === 'win32' ? 'python.exe' : 'python')
  if (exists(bundled)) return { soffice, python: bundled }
  // A system Python that can load LibreOffice's "uno" module.
  const py = process.platform === 'win32' ? 'python.exe' : 'python3'
  const probe = await runProgram(py, ['-I', '-c', 'import uno'], { timeoutMs: 15_000 })
  return probe.code === 0 ? { soffice, python: py } : null
}

/**
 * The spreadsheet program to use: Excel when it is installed, otherwise LibreOffice, otherwise none. The
 * environment variable OPENLOBS_SHEET_ENGINE can force "libreoffice" (the tests do) or "none".
 */
export async function findEngine(): Promise<Engine | null> {
  const forced = process.env.OPENLOBS_SHEET_ENGINE
  if (forced === 'none') return null
  if (forced !== 'libreoffice' && await excelInstalled()) return excelEngine()
  if (forced === 'excel') return null
  const lo = await findLibreOffice()
  return lo ? libreOfficeEngine(lo.soffice, lo.python) : null
}
