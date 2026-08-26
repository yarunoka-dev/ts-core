/**
 * What went wrong, as a closed set of kinds. One error class with a code
 * rather than a class per kind: `instanceof` is brittle across realms and
 * duplicated installs, so the discriminant is data and the class is only
 * the catch-all handle.
 */
export type YrnkErrorCode =
  /** The structure or a value of a Yrnk document violates the language */
  | 'invalid-document'
  /** The document declares a spec version this implementation does not know */
  | 'unsupported-version'
  /** A name collides with a reserved word or looks like a literal */
  | 'reserved-name'
  /** A name is neither a date_sets entry nor declared under resolvers */
  | 'undefined-name'
  /** A declared name has no resolver bound to it */
  | 'unregistered-resolver'
  /** A value handed to the API violates its contract */
  | 'invalid-value'
  /**
   * A query whose endpoints are reversed. The document is fine; the
   * question is the side that does not stand — a kind of error distinct
   * from document invalidity.
   */
  | 'malformed-query'
  /** What a resolver returned violates its contract */
  | 'invalid-calendar-data'
  /** A calendar definition required by the vocabulary in use is missing */
  | 'missing-calendar-data';

/**
 * Every failure this library reports. `instanceof YrnkError` answers
 * "did Yarunoka reject this", and `code` answers what kind of rejection
 * it was. Environment problems (a missing Temporal) are thrown as plain
 * Errors instead: they are breakage of the runtime the library stands
 * on, not an answer about the input.
 */
export class YrnkError extends Error {
  override readonly name = 'YrnkError';

  readonly code: YrnkErrorCode;

  constructor(code: YrnkErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
