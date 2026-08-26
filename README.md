# @yarunoka/core

[![CI](https://github.com/yarunoka-dev/ts-core/actions/workflows/ci.yml/badge.svg)](https://github.com/yarunoka-dev/ts-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yarunoka%2Fcore)](https://www.npmjs.com/package/@yarunoka/core)
[![License](https://img.shields.io/npm/l/%40yarunoka%2Fcore)](LICENSE)

Calendar-aware schedule DSL and pure occurrence query engine.

## What is Yarunoka?

Real-world schedules are calendar rules, not clock rules. "Payday is the
25th — moved up to the previous business day when that falls on a weekend
or a holiday." "Collection day is the second Tuesday of every month."
"The poller runs every 90 minutes, but only within business hours." Cron
expressions and plain timestamps cannot carry these rules, so they end up
as scattered application code — hard to store, hard to display, and
impossible for users to edit safely.

Yarunoka is a small JSON DSL — **Yrnk** — that states such rules as data,
plus an engine that answers questions about them:

- **A document** carries a timezone, a **calendar**, and a list of
  **schedules**. The calendar is the definitions that give meaning to the
  calendar vocabulary: holidays, business holidays, extra business days,
  the workweek, business hours, and named date sets of the document's own.
  Wherever a date list is expected, a **name** may be written instead —
  either one the calendar defines, or one the document declares under
  `resolvers` and the application binds at runtime.
- **A schedule** combines a day expression (days of the month, weekdays,
  ordinal weekdays, calendar words such as `holiday`, day cycles), an
  optional **shift** rule ("the previous business day"), and the times of
  day (fixed points, grids such as every 90 minutes, or all-day).
- **The engine is pure.** It executes no jobs and persists no state; it
  answers "does this date-time match?" and "was there an occurrence in
  this interval?". Firing, catch-up, and throttling remain design
  decisions of the caller.

The name is the Japanese question **やるのか？** (*yaru no ka?*) —
roughly "so, do we do it?". That is the question this engine exists to
answer.

The DSL is language-independent and specified in the
[spec repository](https://github.com/yarunoka-dev/spec/tree/1.1). This
package is its TypeScript implementation.

## Installation

```console
npm install @yarunoka/core
```

No runtime dependencies. Distributed as ESM only.

### Runtime requirements

The engine does all date-time work through the
[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
(ES2026) and references the global `Temporal` object — it ships no
polyfill of its own.

- **Node.js 26 or newer** has it built in.
- Any runtime without it needs a polyfill, installed in your
  application once:

  ```console
  npm install temporal-polyfill
  ```

  ```js
  import 'temporal-polyfill/global';
  ```

When `Temporal` is missing, the first call into the library throws an
error that points here instead of failing somewhere deep inside.

### TypeScript

Temporal is not yet part of a versioned TypeScript `lib` entry; enable it
explicitly in your `tsconfig.json` until it lands in `es2026`:

```jsonc
{
  "compilerOptions": {
    "lib": ["es2025", "esnext.temporal"]
  }
}
```

## Status

Pre-release. The public API may change until 1.0.0.

## License

[MIT](LICENSE)
