import { descriptionProblem, labelProblem } from '../annotations.ts';
import { attachBindings } from '../bindings.ts';
import { YrnkError } from '../error.ts';
import type { YrnkDocument, YrnkResolver, YrnkSchedule } from '../model.ts';
import { nameProblem } from '../names.ts';
import { ensureReferencesResolvable, namesUsedIn } from '../references.ts';
import { ensureTemporal, timezoneProblem } from '../temporal.ts';
import { parseCalendar } from './calendar.ts';
import { parseSchedule } from './schedule.ts';
import { canonicalized, ensureKnownKeys, invalid, isPlainObject, typeOf } from './shared.ts';

/** The spec version this implementation reads. */
export const SUPPORTED_VERSION = '1.0';

const KNOWN_KEYS = [
  'version',
  'timezone',
  'resolvers',
  'calendar',
  'schedules',
  'label',
  'description',
];

export type YrnkParseOptions = {
  /** What the host binds the document's declared resolver names to */
  readonly resolvers?: Readonly<Record<string, YrnkResolver>>;
};

/**
 * Parses a Yrnk document (a JSON string or a decoded value) into the
 * typed model. Each schedule is delegated to the schedule parser; what
 * can only be validated with the whole document and its definitions
 * together — resolvability of every name, the data behind the built-in
 * vocabulary, and the declarations the document makes — happens here.
 * The returned document is deeply frozen: the model is data, and the
 * queries trust it not to change underneath them.
 */
export function parse(input: string | unknown, options?: YrnkParseOptions): YrnkDocument {
  ensureTemporal();

  const raw = decode(input);

  ensureKnownKeys(raw, KNOWN_KEYS, 'document');

  const bindings = collectBindings(options?.resolvers);
  const version = parseVersion(raw);
  const timezone = parseTimezone(raw);
  const calendar = parseCalendar(raw.calendar);
  const schedules = parseSchedules(raw, timezone);
  const resolvers = parseResolverDeclarations(raw);
  const label = parseAnnotation(raw, 'label', labelProblem);
  const description = parseAnnotation(raw, 'description', descriptionProblem);

  const document = deepFreeze({
    version,
    timezone,
    resolvers,
    calendar,
    schedules,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
  }) as YrnkDocument;

  // Before the references are checked, so that a name the document never
  // declared is reported as that rather than as one nothing resolves.
  ensureDeclarationsHold(document, bindings);

  ensureReferencesResolvable(document.schedules, document.calendar, bindings);

  attachBindings(document, bindings);

  return document;
}

function decode(input: string | unknown): Record<string, unknown> {
  let value = input;

  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      invalid('A Yrnk document must be valid JSON');
    }
  }

  if (!isPlainObject(value)) {
    invalid('A Yrnk document must be a JSON object');
  }

  return value;
}

/**
 * The bindings, validated as names the moment they are handed over — a
 * name that can be bound is a name that can be written.
 */
function collectBindings(
  resolvers: Readonly<Record<string, YrnkResolver>> | undefined,
): ReadonlyMap<string, YrnkResolver> {
  const bindings = new Map<string, YrnkResolver>();

  for (const [name, resolver] of Object.entries(resolvers ?? {})) {
    const problem = nameProblem(name);

    if (problem !== null) {
      throw new YrnkError('invalid-value', problem);
    }

    bindings.set(name, resolver);
  }

  return bindings;
}

function parseVersion(raw: Record<string, unknown>): string {
  if (!Object.hasOwn(raw, 'version')) {
    invalid('version is required');
  }

  const version = raw.version;

  if (typeof version !== 'string') {
    invalid('version must be an "x.y" string (e.g. "1.0")');
  }

  // The spec requires rejecting a declared version this implementation
  // does not know rather than interpreting it.
  if (version !== SUPPORTED_VERSION) {
    throw new YrnkError(
      'unsupported-version',
      `This implementation supports version ${SUPPORTED_VERSION} only: ${version}`,
    );
  }

  return version;
}

function parseTimezone(raw: Record<string, unknown>): string {
  const timezone = raw.timezone;

  if (typeof timezone !== 'string') {
    invalid('timezone is required (e.g. "Asia/Tokyo")');
  }

  const problem = timezoneProblem(timezone);

  if (problem !== null) {
    invalid(problem);
  }

  return timezone;
}

function parseSchedules(raw: Record<string, unknown>, timezone: string): readonly YrnkSchedule[] {
  if (!Object.hasOwn(raw, 'schedules')) {
    invalid('schedules is required');
  }

  const value = raw.schedules;

  if (!Array.isArray(value)) {
    invalid('schedules must be a list of schedules (a bare object cannot be written)');
  }

  if (value.length === 0) {
    invalid('schedules cannot be empty');
  }

  // Compare the whole structure of the spelling, as JSON Schema's
  // uniqueItems does; members are canonicalized so order does not
  // separate structurally equal schedules.
  const seen = new Set<string>();

  for (const schedule of value) {
    const key = JSON.stringify(canonicalized(schedule));

    if (seen.has(key)) {
      invalid('Duplicate schedule in schedules');
    }

    seen.add(key);
  }

  return value.map((schedule) => parseSchedule(schedule, timezone));
}

function parseResolverDeclarations(raw: Record<string, unknown>): readonly string[] {
  if (!Object.hasOwn(raw, 'resolvers')) {
    return [];
  }

  const value = raw.resolvers;

  if (!Array.isArray(value)) {
    invalid('resolvers must be a list of names');
  }

  if (value.length === 0) {
    // "Requires nothing" has one spelling, and it is the absence of the
    // key.
    invalid('resolvers cannot be empty (a document that leaves nothing to its host omits the key)');
  }

  const seen = new Set<string>();

  for (const name of value) {
    if (typeof name !== 'string') {
      invalid('resolvers must be a list of names');
    }

    const problem = nameProblem(name);

    if (problem !== null) {
      throw new YrnkError('reserved-name', problem);
    }

    if (seen.has(name)) {
      invalid(`Duplicate declared name: ${name}`);
    }

    seen.add(name);
  }

  return value as readonly string[];
}

function parseAnnotation(
  raw: Record<string, unknown>,
  key: 'label' | 'description',
  problemWith: (value: string) => string | null,
): string | undefined {
  if (!Object.hasOwn(raw, key)) {
    return undefined;
  }

  const value = raw[key];

  if (typeof value !== 'string') {
    invalid(`${key} must be a string: ${typeOf(value)}`);
  }

  const problem = problemWith(value);

  if (problem !== null) {
    invalid(problem);
  }

  return value;
}

/**
 * The three things a declaration has to satisfy. Completeness is what
 * makes the list worth reading: a host prepares exactly what it says, so
 * a name used and left undefined has to be in it, and a name cannot be
 * declared and defined at once. The bindings are checked whole, so a
 * host missing several learns all of them at once.
 */
function ensureDeclarationsHold(
  document: YrnkDocument,
  bindings: ReadonlyMap<string, YrnkResolver>,
): void {
  const declared = new Set(document.resolvers);

  for (const name of Object.keys(document.calendar.dateSets)) {
    if (declared.has(name)) {
      invalid(`A name is either defined or left to the host, never both: ${name}`);
    }
  }

  for (const [context, name] of namesUsedIn(document.schedules, document.calendar)) {
    if (!Object.hasOwn(document.calendar.dateSets, name) && !declared.has(name)) {
      throw new YrnkError(
        'undefined-name',
        `Undefined name (${context}): ${name} (define it under date_sets, or declare it under resolvers)`,
      );
    }
  }

  const unbound = document.resolvers.filter((name) => !bindings.has(name));

  if (unbound.length > 0) {
    throw new YrnkError(
      'unregistered-resolver',
      `No resolver is bound to these declared names: ${unbound.join(', ')}`,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value;
}
