// The conformance kit adapter's entry point, started once per case by
// the yarunoka-test runner: one request read from stdin, one answer
// written to stdout (the kit's docs/protocol.md). Thin wiring by
// principle: the document and the bindings go to the implementation
// unvalidated and unmodified, so that a case carrying broken input
// reaches what it is aimed at. What the implementation throws at is
// answered invalid; what this adapter itself cannot do — a query type or
// an envelope shape the runner never sends — is breakage: reason to
// stderr, exit non-zero.
//
// The queries are per schedule, so the top-level OR is composed here:
// any for the judgments, a merge for the enumeration.
import process from 'node:process';
import type { YrnkDocument, YrnkOccurrence, YrnkResolver } from '../../src/index.ts';
import { build, hasMatchIn, matches, occurrencesIn, parse, YrnkError } from '../../src/index.ts';

function breakage(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const chunks: Buffer[] = [];

for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
}

let request: unknown;

try {
  request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  breakage('The request must be a JSON object');
}

if (typeof request !== 'object' || request === null || Array.isArray(request)) {
  breakage('The request must be a JSON object');
}

const envelope = request as Record<string, unknown>;

if (!('document' in envelope)) {
  breakage('The request carries no document');
}

const response = handle(envelope);

process.stdout.write(`${JSON.stringify(response)}\n`);

function handle(env: Record<string, unknown>): Record<string, unknown> {
  let document: YrnkDocument;

  try {
    document = parse(env.document, { resolvers: bindingsOf(env) });
  } catch (error) {
    if (error instanceof YrnkError) {
      return { invalid: true };
    }

    throw error;
  }

  if (env.action === 'emit') {
    return { document: build(document) };
  }

  const query = env.query;

  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    breakage('An eval request carries a query');
  }

  const q = query as Record<string, unknown>;

  try {
    switch (q.type) {
      case 'point': {
        const at = instantOf(q, 'at');

        return { result: document.schedules.some((schedule) => matches(document, schedule, at)) };
      }
      case 'period': {
        const after = instantOf(q, 'after');
        const through = instantOf(q, 'through');

        return {
          result: document.schedules.some((schedule) =>
            hasMatchIn(document, schedule, after, through),
          ),
        };
      }
      case 'enumeration': {
        const from = instantOf(q, 'from');
        const through = instantOf(q, 'through');

        return { result: enumerate(document, from, through) };
      }
      default:
        breakage('Unknown query type');
    }
  } catch (error) {
    if (error instanceof YrnkError) {
      return { invalid: true };
    }

    throw error;
  }
}

function enumerate(
  document: YrnkDocument,
  from: Temporal.Instant,
  through: Temporal.Instant,
): string[] {
  // The union answers each occurrence once, deduplicated within a kind:
  // an all-day occurrence by its day, a timed one by its instant. The
  // kinds never merge.
  const occurrences = new Map<string, YrnkOccurrence>();

  for (const schedule of document.schedules) {
    for (const occurrence of occurrencesIn(document, schedule, from, through)) {
      const key =
        occurrence instanceof Temporal.PlainDate
          ? `d:${occurrence.toString()}`
          : `t:${occurrence.epochMilliseconds}`;

      occurrences.set(key, occurrence);
    }
  }

  // Ascending; an all-day occurrence takes the start of its day as its
  // place in the order and precedes a timed point at the same instant.
  const ordered = [...occurrences.values()]
    .map((occurrence) => ({
      occurrence,
      instant:
        occurrence instanceof Temporal.PlainDate
          ? occurrence.toZonedDateTime(document.timezone).epochMilliseconds
          : occurrence.epochMilliseconds,
      timed: occurrence instanceof Temporal.PlainDate ? 0 : 1,
    }))
    .sort((a, b) => a.instant - b.instant || a.timed - b.timed);

  return ordered.map(({ occurrence }) =>
    occurrence instanceof Temporal.PlainDate
      ? occurrence.toString()
      : occurrence.toString({ timeZoneName: 'never' }),
  );
}

/**
 * The bindings, held to the envelope shape of the protocol — a map of
 * resolver name to a list of date literals. The shape is the runner's
 * promise, so a request outside it is breakage rather than an invalid
 * answer; the literals themselves stay unvalidated on their way in.
 */
function bindingsOf(env: Record<string, unknown>): Record<string, YrnkResolver> {
  const raw = env.bindings ?? {};

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    breakage('bindings must map resolver names to date lists');
  }

  const bindings: Record<string, YrnkResolver> = {};

  for (const [name, dates] of Object.entries(raw)) {
    if (!Array.isArray(dates) || dates.some((date) => typeof date !== 'string')) {
      breakage('bindings must map resolver names to date lists');
    }

    // The pass-through resolver a kit binding becomes: it answers the
    // bound list as-is, whatever range is asked.
    bindings[name] = () => dates as string[];
  }

  return bindings;
}

function instantOf(query: Record<string, unknown>, key: string): Temporal.Instant {
  const value = query[key];

  if (typeof value !== 'string') {
    breakage(`The query carries no ${key}`);
  }

  try {
    return Temporal.Instant.from(value);
  } catch {
    breakage(`The query's ${key} is not an instant: ${value}`);
  }
}
