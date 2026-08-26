---
title: Usage
description: Reading a document into the typed model, writing it back out, asking queries about a schedule, and supplying dates at runtime.
sidebar:
  order: 4
---

The package does three things: it **reads** a Yrnk document into a typed
model, **writes** that model back out as a document, and **answers
queries** about the occurrences a schedule denotes.

Reading and writing are exact inverses — building what you parsed gives
back what you started with — so a document can travel between storage,
an editing UI, and the engine without any step being the one that loses
information.

## Reading a document

`parse` turns a document into a `YrnkDocument`: the whole document as a
typed, deeply frozen model, validated down to the resolvability of every
name it refers to.

```ts
import { parse } from '@yarunoka/core';

const document = parse(json);    // a JSON string, or an already-decoded value

document.timezone;               // string — every schedule is interpreted in this zone
document.calendar;               // YrnkCalendar — the definitions
document.schedules;              // readonly YrnkSchedule[] — the schedules, in document order
const payday = document.schedules[0];
```

`parse` accepts either a JSON string or a decoded value, so a document
that arrived as a request body, a config file, or a database column
needs no preparation beyond whatever decoded it.

The model is plain readonly data: nodes are objects with a `kind`
discriminant rather than class instances, and the whole tree is frozen.
The `YrnkDocument` type is branded — it marks a value that actually went
through `parse`, telling it apart from raw JSON of the same shape at the
type level. A document therefore never starts life as a hand-built
model: compose the raw document and parse it.

## Writing a document

`build` is the inverse of `parse`: the typed model back to the
document's array-and-object representation. `JSON.stringify` the result
for the wire form.

```ts
import { build } from '@yarunoka/core';

const raw = build(document);     // a plain object — the decoded document
JSON.stringify(raw);             // the document text
```

**Round-tripping is the identity.** Parsing a document and building it
again produces the same representation you started from — not an
equivalent spelling, the same one. The language has no scalar sugar and
no optional punctuation precisely so that this holds, which is what
makes it safe to let a UI parse, edit, and write back. That includes
the declared version: reading a 1.0 document and writing it back
yields a 1.0 document, its authored empty `calendar` or `date_sets` (a
spelling only 1.0 accepts — 1.1 writes "no definitions" by omitting
the key) included.

## Asking queries

Queries are functions taking the document and one schedule; you build
nothing and hold no service object.

```ts
import { matches, hasMatchIn, occurrencesIn } from '@yarunoka/core';

matches(document, payday, now);                    // is this instant an occurrence?
hasMatchIn(document, payday, lastRunAt, now);      // is there a point after the last run, through now?
occurrencesIn(document, payday, from, through);    // which occurrences lie from `from` through `through`?
```

The three queries differ in what they take and what they mean at the
boundaries:

- **`matches`** asks whether the given instant is an occurrence. For a
  timed occurrence the answer is instant equality (sub-second precision
  is truncated — no scheduled point is finer than a second); the
  comparison is between instants, never wall-clock values. An all-day
  occurrence matches on the day alone
- **`hasMatchIn`** asks **after a, through b** — a point exactly at the
  start does not count, a point exactly at the end does. Each question's
  "now" becomes the next one's start, so every point is seen exactly
  once across a series of questions
- **`occurrencesIn`** asks **from a through b** — the caller names two
  instants and both are part of what it names. Timed occurrences come
  back as `Temporal.ZonedDateTime` on the document timezone's clock,
  all-day occurrences as `Temporal.PlainDate`; which kind you got is
  read from the type. The order is ascending, an all-day occurrence
  taking the start of its day as its place

An instant argument takes a `Temporal.Instant`, a
`Temporal.ZonedDateTime`, a `Date`, or an ISO 8601 string with a UTC
offset. A zone-name-only string names no moment and is rejected.

Both endpoint-naming queries require **start ≤ end**, compared between
the instants as given. A reversed pair throws a `YrnkError` with code
`malformed-query` rather than answering `false` or an empty list: a
reversed period arises only from broken caller state or a clock that
moved backwards, and a quiet answer would hide exactly that. Equal
endpoints are legal.

Evaluation works over the spec's **date domain** — days 0001-01-01
through 9999-12-31, read on the document timezone's clock. A query is
answered on its overlap with the domain, and one lying entirely
outside it answers empty.

An **all-day occurrence is held for as long as its day lasts**: any
question whose range touches the day answers for it, including one asked
late in the evening. That is not the same as a timed occurrence at
00:00, and the two never collapse into one.

Scheduled points on DST transition days resolve per RFC 5545 §3.3.5 — a
point at a nonexistent time is pushed forward, and a point at a time
that occurs twice counts only as its first occurrence.

### One schedule at a time

Every query takes a single schedule. A document's `schedules` list is an
OR, so a question about the whole document is composed by the caller:
`some` across the branches for a decision, a merge of the lists for an
enumeration. Nothing is lost by doing it that way — it just makes the
composition yours to control.

### Definitions are resolved per query

No results are held between queries. Every answer rests on what the
resolvers say at the moment it is asked, which is what lets a long-lived
service pick up a holiday list that changed underneath it. If you would
rather not look the same data up repeatedly, hold it inside your own
resolver — see below.

## Names the host resolves

Wherever a date list is expected, a **name** may be written instead. A
name denotes a date set, and it resolves one of two ways: **inside** the
document, as an entry of `date_sets`, or **outside** it, by a binding
the host supplies — a **resolver**. Which of the two makes no difference
to where the name may be written.

A document declares the names it leaves outside itself:

```json
{
  "version": "1.1",
  "timezone": "Asia/Tokyo",
  "resolvers": ["company-holidays"],
  "calendar": {
    "holidays": "company-holidays",
    "date_sets": {"founding-day": ["2026-10-01"]}
  },
  "schedules": [
    {"days": ["holiday"], "times": ["09:00"]},
    {"days": ["founding-day"], "allday": true}
  ]
}
```

**The declaration is complete**: every name that is used and not defined
has to be listed, so what the document says is exactly what you have to
bind. That is what lets a host prepare bindings from the document alone,
before parsing it — which otherwise could not be done, since parsing is
what needs them.

A declared name that goes unused is fine. A name cannot be both a
`date_sets` entry and a declared one.

Not every string can be a name. One that collides with a reserved word
of the language (the calendar vocabulary, the day and unit words, the
structural keys — `holidays`, `every`, `from`, …) or that reads as a
literal (digits only, `HH:MM`, `YYYY-MM-DD`) is rejected wherever a
name is accepted, `date_sets` keys included.

## Supplying dates at runtime

Bind each declared name to a resolver function, and hand the bindings to
`parse`:

```ts
import { parse } from '@yarunoka/core';

const document = parse(json, {
  resolvers: {
    'company-holidays': ({ from, through }) =>
      holidayRepository.between(from.toString(), through.toString()),
  },
});
```

**The bindings are handed over once.** They ride with the parsed
document, so whoever holds the document can query it and there is no
second place to pass them and forget. Parsing a document whose declared
names are not all bound throws, naming **all** of the missing ones, not
the first.

A resolver is handed **the range it has to cover** as
`Temporal.PlainDate` values, both ends included, and returns
`YYYY-MM-DD` strings. Dates outside the range are ignored, and dates
missing inside it read as "not in this set". It is asked again whenever
a range it has not covered is reached, so it only ever needs to compute
what it was asked for.

The contract is synchronous on purpose: an `async` resolver would make
every query `async` with it. A source that is asynchronous — an API, a
database driver without a sync interface — is pre-fetched by the caller
and wrapped as a resolver returning a static list. Holding results
across calls is the resolver's own decision — the engine resolves per
query and keeps nothing between them.

## Handling failures

Everything this package rejects is thrown as a `YrnkError`, one class
with a `code` naming the kind of rejection:

```ts
import { parse, YrnkError } from '@yarunoka/core';

try {
  const document = parse(json);
} catch (error) {
  if (error instanceof YrnkError && error.code === 'invalid-document') {
    // The document itself is wrong — show the author what to fix
  } else {
    throw error;
  }
}
```

`instanceof YrnkError` answers "did Yarunoka reject this", and `code`
answers what kind of rejection it was — a document problem
(`invalid-document`, `unsupported-version`, `reserved-name`,
`undefined-name`), a wiring problem (`unregistered-resolver`), a
question that does not stand (`malformed-query` — a reversed period or
enumeration; the document is fine), or a value handed to the API or
returned by a resolver that violates its contract (`invalid-value`,
`invalid-calendar-data`, `missing-calendar-data`). The reference lists
every code with what raises it.

Environment problems are the one exception: a missing `Temporal` is
thrown as a plain `Error`, because it is breakage of the runtime the
library stands on rather than an answer about the input.

## Deciding when to fire

The engine answers queries; it does not run anything. Catch-up, grace,
and throttling are decided by how the caller cuts the period it asks
about.

```ts
if (hasMatchIn(document, schedule, lastRunAt, now)) {
  run();
  lastRunAt = now;
}
```

- **Catch-up** — noticing a scheduled time after it has passed still
  fires, late, because the point lies after the last run and through
  now. Several missed points answer as one `true`, so they collapse into
  a single firing rather than a burst
- **A grace cap** — move up the start of the period: anything older than
  the cap is not caught up
- **No catch-up where no point existed** — asking at 20:30 about "hourly
  from 8:00 until 20:00" finds nothing, because a 20:00 point never
  existed. The window is half-open, and the schedule is the authority on
  what exists
- **"At least N seconds apart"** — throttling, not scheduling. AND the
  distance from the last run on your side; the language deliberately has
  no way to say it
- **All-day tasks** — a day is due for as long as it lasts, so every
  question touching that day answers yes. A caller that means to run
  once keeps that count itself; the schedule says which days, not how
  often to act
