import type { StateStore } from "./contracts.ts"

export function createStateStore(storage: any): StateStore {
  return {
    async get<T>(key: string) {
      return (await storage.get(key)) as T | undefined
    },
    async set<T>(key: string, value: T) {
      await storage.set(key, value)
    },
    async remove(key: string) {
      await storage.remove(key)
    },
    async scan<T>(prefix: string) {
      const all: Array<{ key: string; value: T }> = []
      let after: string | undefined
      do {
        const page = await storage.scan({ prefix, limit: 100, ...(after ? { after } : {}) })
        for (const entry of page.entries ?? []) all.push(entry as { key: string; value: T })
        after = page.next
      } while (after)
      return all
    },
  }
}
