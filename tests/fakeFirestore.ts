/**
 * A tiny in-memory stand-in for the parts of Firestore the stores use: collections and sub-collections,
 * documents with get/set/update/delete, `where(field, '==', value)` queries, transactions and
 * `recursiveDelete`. It is not Firestore, so it proves the store logic (shapes, ownership filters,
 * defaults) and not Firestore's own behaviour.
 */
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

type Doc = Record<string, any>

/**
 * When TEST_FIRESTORE=emulator and the real Firestore emulator is running (FIRESTORE_EMULATOR_HOST), the same call gives
 * a real Firestore instead: every top-level collection name gets a private prefix, so each test still starts empty and
 * tests cannot see each other. The checks stay identical, so any difference is Firestore behaving differently from the
 * stand-in. The few checks that peek inside the stand-in with raw() cannot run there and are skipped by the runner.
 */
let emulatorApp: any
let prefixCounter = 0
const emulatorRun = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
function createEmulatorFirestore() {
  emulatorApp ??= getApps().find((a: any) => a.name === 'store-tests') ?? initializeApp({ projectId: 'demo-openlobs' }, 'store-tests')
  const real = getFirestore(emulatorApp)
  const prefix = `t${emulatorRun}x${++prefixCounter}_`
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'collection') return (name: string) => target.collection(prefix + name)
      if (prop === 'raw') return () => { throw new Error('RAW_NOT_SUPPORTED: this check looks inside the stand-in and cannot run on the real database') }
      const v = Reflect.get(target, prop, target)
      return typeof v === 'function' ? v.bind(target) : v
    }
  })
}

export function createFakeFirestore(): ReturnType<typeof createInMemoryFirestore> {
  if (process.env.TEST_FIRESTORE === 'emulator' && process.env.FIRESTORE_EMULATOR_HOST) return createEmulatorFirestore() as any
  return createInMemoryFirestore()
}

/** Real Firestore refuses a field whose value is undefined, so the stand-in does too (it used to let them through). */
function refuseUndefined(value: unknown, where = ''): void {
  if (value === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${where}"). If you want to ignore undefined values, enable \`ignoreUndefinedProperties\`.`)
  if (Array.isArray(value)) value.forEach((v, i) => refuseUndefined(v, `${where}[${i}]`))
  else if (value && typeof value === 'object' && !(value instanceof Date)) for (const [k, v] of Object.entries(value)) refuseUndefined(v, where ? `${where}.${k}` : k)
}

function createInMemoryFirestore() {
  // Every collection, top level or nested, is stored under its path, e.g. "chats/c1/messages".
  const data = new Map<string, Map<string, Doc>>()
  const col = (path: string) => { if (!data.has(path)) data.set(path, new Map()); return data.get(path)! }
  let counter = 0

  const snap = (path: string, id: string, d: Doc | undefined) => ({
    id,
    exists: d !== undefined,
    data: () => (d === undefined ? undefined : structuredClone(d)),
    ref: docRef(path, id)
  })
  const docRef = (path: string, id: string): any => {
    if (id.includes('/')) throw new Error(`Value for argument "documentPath" must point to a document, but was "${id}". Your path does not contain an even number of components.`)
    return {
    id,
    path: `${path}/${id}`,
    get: async () => snap(path, id, col(path).get(id)),
    set: async (d: Doc) => { refuseUndefined(d); col(path).set(id, structuredClone(d)) },
    create: async (d: Doc) => {
      refuseUndefined(d)
      if (col(path).has(id)) throw new Error('ALREADY_EXISTS: the document exists')
      col(path).set(id, structuredClone(d))
    },
    update: async (patch: Doc) => {
      refuseUndefined(patch)
      const cur = col(path).get(id)
      if (!cur) throw new Error('NOT_FOUND: no document to update')
      col(path).set(id, { ...cur, ...structuredClone(patch) })
    },
    delete: async () => { col(path).delete(id) },
    collection: (sub: string) => collectionRef(`${path}/${id}/${sub}`)
    }
  }
  const OPS: Record<string, (a: any, b: any) => boolean> = {
    '==': (a, b) => a === b,
    '<=': (a, b) => a !== undefined && a !== null && a <= b,
    '>=': (a, b) => a !== undefined && a !== null && a >= b,
    '<': (a, b) => a !== undefined && a !== null && a < b,
    '>': (a, b) => a !== undefined && a !== null && a > b,
    in: (a, b) => Array.isArray(b) && b.includes(a),
    'array-contains': (a, b) => Array.isArray(a) && a.includes(b)
  }
  const query = (path: string, filters: Array<[string, string, any]>, order: Array<[string, 'asc' | 'desc']> = [], max = Infinity): any => ({
    where(field: string, op: string, value: any) {
      if (!OPS[op]) throw new Error(`fake firestore: operator ${op} not supported`)
      return query(path, [...filters, [field, op, value]], order, max)
    },
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => query(path, filters, [...order, [field, dir]], max),
    limit: (n: number) => query(path, filters, order, n),
    get: async () => {
      let rows = [...col(path)].filter(([, d]) => filters.every(([f, op, v]) => OPS[op]!(d[f], v)))
      // Like Firestore, a document missing the ordered field is not returned.
      if (order.length) rows = rows.filter(([, d]) => order.every(([f]) => d[f] !== undefined))
      rows.sort(([, a], [, b]) => {
        for (const [f, dir] of order) {
          if (a[f] === b[f]) continue
          return (a[f] < b[f] ? -1 : 1) * (dir === 'desc' ? -1 : 1)
        }
        return 0
      })
      const docs = rows.slice(0, max).map(([id, d]) => snap(path, id, d))
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: (d: any) => void) => docs.forEach(fn) }
    }
  })
  const collectionRef = (path: string): any => ({
    doc: (id?: string) => docRef(path, id ?? `doc${++counter}`),
    where: (field: string, op: string, value: any) => query(path, []).where(field, op, value),
    orderBy: (field: string, dir?: 'asc' | 'desc') => query(path, []).orderBy(field, dir),
    limit: (n: number) => query(path, []).limit(n),
    get: () => query(path, []).get()
  })

  // Transactions run one at a time, which is what Firestore's retry-on-conflict amounts to for a
  // read-then-write. Writes are applied only if the callback finishes without throwing.
  let queue: Promise<unknown> = Promise.resolve()
  const runTransaction = <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const run = async () => {
      const pending: Array<() => Promise<void>> = []
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, d: Doc) => { pending.push(() => ref.set(d)) },
        update: (ref: any, patch: Doc) => { pending.push(() => ref.update(patch)) },
        delete: (ref: any) => { pending.push(() => ref.delete()) }
      }
      const result = await fn(tx)
      for (const w of pending) await w()
      return result
    }
    const next = queue.then(run, run)
    queue = next.catch(() => {})
    return next
  }

  return {
    runTransaction,
    collection: collectionRef,
    /** Writes collected and applied together on commit, like Firestore's WriteBatch. */
    batch: () => {
      const pending: Array<() => Promise<unknown>> = []
      const b = {
        set: (ref: any, d: Doc) => { pending.push(() => ref.set(d)); return b },
        delete: (ref: any) => { pending.push(() => ref.delete()); return b },
        commit: async () => { for (const w of pending) await w() }
      }
      return b
    },
    /** Deletes a document and everything nested under it, like Firestore's own recursiveDelete. */
    recursiveDelete: async (ref: { path: string }) => {
      const [path, id] = [ref.path.slice(0, ref.path.lastIndexOf('/')), ref.path.slice(ref.path.lastIndexOf('/') + 1)]
      col(path).delete(id)
      for (const key of [...data.keys()]) if (key.startsWith(`${ref.path}/`)) data.delete(key)
    },
    /** For assertions. */
    raw: (name: string) => col(name)
  }
}
