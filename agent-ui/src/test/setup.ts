// Fix: jsdom in vitest doesn't provide localStorage by default (opaque origin).
// Node 26 + jsdom 27 requires a non-opaque URL for localStorage to work.
// This polyfill ensures all tests that use localStorage pass.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => {
      const keys = Array.from(store.keys())
      return keys[index] ?? null
    },
  }
}
