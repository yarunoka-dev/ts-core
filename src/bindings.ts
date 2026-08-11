import type { YrnkDocument, YrnkResolver } from './model.ts';

/**
 * The resolver bindings of each parsed document. Registered off the
 * document rather than on it so the document stays a plain JSON-shaped
 * value — bindings are functions, and serializing or cloning a document
 * never drags them along or leaks them.
 */
const registry = new WeakMap<YrnkDocument, ReadonlyMap<string, YrnkResolver>>();

const NONE: ReadonlyMap<string, YrnkResolver> = new Map();

export function attachBindings(document: YrnkDocument, bindings: ReadonlyMap<string, YrnkResolver>): void {
  registry.set(document, bindings);
}

/**
 * The bindings the document was parsed with. A document that never went
 * through parse (or crossed a clone) reads as having none, which is
 * exactly what its declarations then fail against.
 */
export function bindingsOf(document: YrnkDocument): ReadonlyMap<string, YrnkResolver> {
  return registry.get(document) ?? NONE;
}
