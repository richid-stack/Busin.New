import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten'
// Single-file variant: the WebAssembly binary is embedded in the JS, so it survives bundling.
import variant from '@jitl/quickjs-singlefile-mjs-release-sync'

let quickJSPromise: Promise<QuickJSWASMModule> | null = null
const getQuickJS = () => (quickJSPromise ??= newQuickJSWASMModuleFromVariant(variant))

export interface SandboxOptions {
  timeoutMs?: number
  memoryLimitBytes?: number
}

/**
 * Runs user-authored workflow code in an isolated QuickJS (WebAssembly) VM.
 *
 * Unlike `node:vm`, the guest has no access to the host realm: no `process`, `require`,
 * `fetch`, filesystem or network. Only JSON-serialisable `inputs` go in and a
 * JSON-serialisable value comes out. Execution is time- and memory-limited.
 *
 * The code is the body of an async function, e.g. `return inputs.trigger.email.subject.length > 5`.
 */
export async function runSandboxedCode(
  code: string,
  inputs: unknown,
  options: SandboxOptions = {}
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 1000
  const QuickJS = await getQuickJS()
  const vm = QuickJS.newContext()

  try {
    vm.runtime.setMemoryLimit(options.memoryLimitBytes ?? 32 * 1024 * 1024)
    vm.runtime.setMaxStackSize(512 * 1024)
    const deadline = Date.now() + timeoutMs
    vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline))

    const serialisedInputs = JSON.stringify(inputs ?? null)
    const source = `const inputs = JSON.parse(${JSON.stringify(serialisedInputs)});\n`
      + `(async () => {\n${code}\n})().then(v => JSON.stringify(v === undefined ? null : v))`

    const evaluated = vm.evalCode(source)
    if (evaluated.error) {
      const err = vm.dump(evaluated.error)
      evaluated.error.dispose()
      throw new Error(typeof err === 'object' && err?.message ? String(err.message) : String(err))
    }

    const promise = vm.resolvePromise(evaluated.value)
    evaluated.value.dispose()
    vm.runtime.executePendingJobs()

    const settled = await Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Code execution timed out')), timeoutMs + 250))
    ])

    if (settled.error) {
      const err = vm.dump(settled.error)
      settled.error.dispose()
      throw new Error(typeof err === 'object' && err?.message ? String(err.message) : String(err))
    }

    const json = vm.dump(settled.value)
    settled.value.dispose()
    return typeof json === 'string' ? JSON.parse(json) : json
  } finally {
    vm.dispose()
  }
}
