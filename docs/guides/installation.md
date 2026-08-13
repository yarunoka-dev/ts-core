---
title: Installation
description: Installing the package with npm, and adding the Temporal polyfill where one is needed.
sidebar:
  order: 3
---

## npm

```console
npm install @yarunoka/core
```

That is the whole installation. The package registers nothing, runs no
install scripts, and has no bootstrapping step — every entry point is a
named export you import yourself.

:::caution
The 0.x releases exist to exercise the release pipeline and to track the
specification on its way to 1.0.0. They are **not intended for use**.
:::

## The Temporal polyfill

For runtimes without the Temporal API, install a polyfill once, in
your application:

```console
npm install temporal-polyfill
```

```js
import 'temporal-polyfill/global';
```

The polyfill belongs to the application rather than to this package —
an environment that has Temporal natively should not carry one, and only
the application knows which environments it runs in.

## Verifying the installation

```js
import { parse } from '@yarunoka/core';

const document = parse({
  version: '1.0',
  timezone: 'Asia/Tokyo',
  schedules: [{ days: [25], times: ['10:00'] }],
});

document.timezone;          // "Asia/Tokyo"
document.schedules.length;  // 1
```
