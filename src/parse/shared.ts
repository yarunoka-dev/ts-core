import { YrnkError } from '../error.ts';

/** A document validation failure — the code every syntax error carries. */
export function invalid(message: string): never {
  throw new YrnkError('invalid-document', message);
}

/** A JSON object (not an array, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function ensureKnownKeys(raw: Record<string, unknown>, known: readonly string[], where: string): void {
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));

  if (unknown.length > 0) {
    invalid(`Unknown keys in the ${where}: ${unknown.join(', ')}`);
  }
}

/** What a JSON value reads as in an error message. */
export function typeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

/**
 * The spelling with every object's members in one fixed order, so that
 * structurally equal spellings serialize identically (JSON object
 * equality has no member order; list order stays part of the value).
 */
export function canonicalized(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalized);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalized(value[key])]),
    );
  }

  return value;
}
