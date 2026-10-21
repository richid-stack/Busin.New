/**
 * A tiny in-memory stand-in for the parts of Firestore the stores use: collections, documents with
 * get/set/update/delete, and `where(field, '==', value)` queries. It is not Firestore, so it proves the
 * store logic (shapes, ownership filters, defaults) and not Firestore's own behaviour.
 */
type Doc = Record<string, any>

export function createFakeFirestore() {
  const data = new Map<string, Map<string, Doc>>()
  const col = (name: string) => { if (!data.has(name)) data.set(name, new Map()); return data.get(name)! }
  let counter = 0

  const snap = (id: string, d: Doc | undefined) => ({ id, exists: d !== undefined, data: () => (d === undefined ? undefined : structuredClone(d)) })
  const docRef = (name: string, id: string) => ({
    id,
    get: async () => snap(id, col(name).get(id)),
    set: async (d: Doc) => { col(name).set(id, structuredClone(d)) },
    update: async (patch: Doc) => {
      const cur = col(name).get(id)
      if (!cur) throw new Error('NOT_FOUND: no document to update')
      col(name).set(id, { ...cur, ...structuredClone(patch) })
    },
    delete: async () => { col(name).delete(id) }
  })
  const query = (name: string, filters: Array<[string, any]>) => ({
    where(field: string, op: string, value: any) {
      if (op !== '==') throw new Error(`fake firestore: operator ${op} not supported`)
      return query(name, [...filters, [field, value]])
    },
    get: async () => ({
      docs: [...col(name)].filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => snap(id, d))
    })
  })

  return {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id ?? `doc${++counter}`),
      where: (field: string, op: string, value: any) => query(name, []).where(field, op, value)
    }),
    /** For assertions. */
    raw: (name: string) => col(name)
  }
}
