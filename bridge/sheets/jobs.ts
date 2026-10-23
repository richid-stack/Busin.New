import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { SHEET_LIMITS, workbookApplyInput, workbookInspectInput, workbookListInput } from '../../shared/sheetOps'
import type { WorkbookApplyResult } from '../../shared/sheetOps'
import { listSpreadsheets, newFilePath, openWorkspace, resolveExisting } from '../workspace'
import { findEngine } from './engine'
import type { Engine } from './engine'
import { inspectWorkbook, readWorkbook, scanFeatures, summarizeSheet } from './inspect'
import { applyOps } from './ops'

/** The three spreadsheet jobs. Each works only inside the one folder the person chose. */

export interface SheetDeps {
  /** Replaceable in tests. Returns the spreadsheet program to use, or null. */
  engine?: () => Promise<Engine | null>
}

const parse = <T>(schema: { safeParse: (x: unknown) => any }, input: unknown): T => {
  const r = schema.safeParse(input)
  if (!r.success) throw new Error(r.error.issues[0]?.message || 'That is not a valid request.')
  return r.data as T
}

export async function workbookList(workspace: string | null, input: unknown) {
  const root = openWorkspace(workspace)
  const { folder } = parse<{ folder?: string }>(workbookListInput, input)
  const { files, truncated } = listSpreadsheets(root, folder)
  return { folder: path.basename(root).slice(0, 200), files, truncated }
}

export async function workbookInspect(workspace: string | null, input: unknown) {
  const root = openWorkspace(workspace)
  const { file } = parse<{ file: string }>(workbookInspectInput, input)
  const full = resolveExisting(root, file)
  return await inspectWorkbook(full, path.relative(root, full).split(path.sep).join('/'))
}

const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

export async function workbookApply(workspace: string | null, input: unknown, signal: AbortSignal, deps: SheetDeps = {}): Promise<WorkbookApplyResult> {
  const root = openWorkspace(workspace)
  const req = parse<ReturnType<typeof workbookApplyInput.parse>>(workbookApplyInput, input)
  const src = resolveExisting(root, req.file)
  const checks: WorkbookApplyResult['checks'] = []
  const warnings: string[] = []
  const before = sha(src)

  const features = await scanFeatures(src)
  const lost = [features.charts && `${features.charts} chart${features.charts === 1 ? '' : 's'}`, features.pivots && `${features.pivots} pivot table${features.pivots === 1 ? '' : 's'}`, features.pictures && `${features.pictures} picture${features.pictures === 1 ? '' : 's'}`, features.macros && 'macros'].filter(Boolean)
  if (lost.length && !req.acceptLosses) {
    throw new Error(`The new copy would lose ${lost.join(', ')} that this file has. Nothing was changed. If that is acceptable, ask again and say so.`)
  }
  if (lost.length) warnings.push(`The new copy does not have the original's ${lost.join(', ')}.`)

  const wb = await readWorkbook(src)
  const outcome = applyOps(wb, req.ops)
  warnings.push(...outcome.warnings)

  const wantsEngine = outcome.charts.length > 0 || req.pdf
  const engine = await (deps.engine ?? findEngine)()
  if (wantsEngine && !engine) throw new Error('Charts and PDFs need Microsoft Excel or LibreOffice on this computer, and neither was found. Nothing was changed.')
  if (signal.aborted) throw new Error('Stopped.')

  const srcDir = path.dirname(path.relative(root, src))
  const wanted = req.output ?? `${path.basename(src, path.extname(src))} (OpenLobs).xlsx`
  const target = newFilePath(root, req.output ? wanted : path.join(srcDir === '.' ? '' : srcDir, wanted).split(path.sep).join('/'))
  const created: string[] = []
  try {
    // Formulas written by the file layer have no stored answers; Excel is told to work them out when it opens the file.
    wb.calcProperties.fullCalcOnLoad = true
    await wb.xlsx.writeFile(target.full)
    created.push(target.full)

    let pdfRel: string | null = null
    let pdfFull: string | null = null
    if (req.pdf) {
      const p = newFilePath(root, target.rel.replace(/\.xlsx$/i, '.pdf'))
      pdfFull = p.full; pdfRel = p.rel
    }
    let formulas = 0
    let errorCells: string[] = []
    let engineName: WorkbookApplyResult['engine'] = null
    if (engine) {
      try {
        const done = await engine.run({ file: target.full, charts: outcome.charts, pdf: pdfFull }, signal)
        engineName = engine.name
        formulas = done.formulas
        errorCells = done.errors
        if (pdfFull && fs.existsSync(pdfFull)) created.push(pdfFull)
        checks.push({ name: `Recalculated in ${engine.name === 'excel' ? 'Excel' : 'LibreOffice'}`, ok: true, detail: `${formulas} formula${formulas === 1 ? '' : 's'} calculated.` })
        checks.push({ name: 'No cell shows an error', ok: errorCells.length === 0, detail: errorCells.length ? `Errors in ${errorCells.slice(0, 8).join(', ')}.` : 'Every formula gave an answer.' })
        if (outcome.charts.length) {
          const saved = (await scanFeatures(target.full)).charts
          checks.push({ name: 'Charts are in the saved file', ok: saved >= outcome.charts.length, detail: `${saved} chart${saved === 1 ? '' : 's'} found in the file.` })
        }
      } catch (err: any) {
        if (wantsEngine) throw err
        warnings.push(`The spreadsheet program could not check the new file (${String(err?.message ?? err).slice(0, 120)}). The formulas will be calculated when you open it.`)
      }
    } else {
      warnings.push('No Excel or LibreOffice was found, so the formulas have not been calculated yet. They are worked out when you open the file in Excel.')
    }

    // Reopen what was saved, as a stranger would.
    const check = await readWorkbook(target.full)
    checks.push({ name: 'The new file opens', ok: check.worksheets.length > 0, detail: `${check.worksheets.length} sheet${check.worksheets.length === 1 ? '' : 's'}.` })
    if (!engine) formulas = check.worksheets.reduce((n, w) => n + summarizeSheet(w).formulas, 0)
    checks.push({ name: 'The original is untouched', ok: sha(src) === before, detail: 'The original file was not changed.' })
    const size = fs.statSync(target.full).size
    if (size > SHEET_LIMITS.maxFileBytes) throw new Error('The new file came out larger than OpenLobs will handle.')

    return {
      output: target.rel,
      engine: engineName,
      sheets: check.worksheets.map(w => w.name).slice(0, 30),
      steps: outcome.steps,
      checks,
      formulas,
      errors: errorCells.map(e => `Error shown in ${e}`).slice(0, 20),
      charts: outcome.charts.length,
      pdf: pdfRel && pdfFull && fs.existsSync(pdfFull) ? pdfRel : null,
      sizeKb: Math.ceil(size / 1024),
      warnings: warnings.slice(0, 10)
    }
  } catch (err) {
    // A job that did not finish leaves nothing behind.
    for (const f of created) fs.rmSync(f, { force: true })
    fs.rmSync(target.full, { force: true })
    throw err
  }
}
