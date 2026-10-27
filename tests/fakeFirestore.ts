/**
 * A tiny in-memory stand-in for the parts of Firestore the stores use: collections and sub-collections,
 * documents with get/set/update/delete, `where(field, '==', value)` queries, transactions and
 * `recursiveDelete`. It is not Firestore, so it proves the store logic (shapes, ownership filters,
 * defaults) and not Firestore's own behaviour.
 */
type Doc = Record<string, any>

export function createFakeFirestore() {
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
  const docRef = (path: string, id: string): any => ({
    id,
    path: `${path}/${id}`,
    get: async () => snap(path, id, col(path).get(id)),
    set: async (d: Doc) => { col(path).set(id, structuredClone(d)) },
    update: async (patch: Doc) => {
      const cur = col(path).get(id)
      if (!cur) throw new Error('NOT_FOUND: no document to update')
      col(path).set(id, { ...cur, ...structuredClone(patch) })
    },
    delete: async () => { col(path).delete(id) },
    collection: (sub: string) => collectionRef(`${path}/${id}/${sub}`)
  })
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
