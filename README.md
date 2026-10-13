# Vite Bundle Optimizer

A Vite plugin for automatic production bundle optimization via intelligent chunk splitting, vendor grouping, shared dependency extraction, and compression.

<div align="left">
<a href="https://www.npmjs.com/package/vite-plugin-bundle-optimizer"><img alt="npm" src="https://img.shields.io/npm/v/vite-plugin-bundle-optimizer?label=release"></a>
<img alt="Vite compatibility" src="https://registry.vite.dev/api/badges?package=vite-plugin-bundle-optimizer&tool=vite">
<a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green?style=flat"></a>
<a href="https://github.com/sergeybruska/vite-plugin-bundle-optimizer/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/sergeybruska/vite-plugin-bundle-optimizer/actions/workflows/ci.yml/badge.svg"></a>
</div>

## Features

- **Intelligent vendor splitting** — automatically groups node_modules into cacheable vendor chunks by ecosystem (react, UI, charts, editor, etc.)
- **Shared dependency detection** — extracts dependencies used by multiple lazy chunks into shared chunks
- **Initial vs lazy awareness** — keeps lazy-only vendors out of the initial bundle
- **Chunk size limits** — merges undersized chunks, enforces max chunk count
- **Gzip & Brotli compression** — generates `.gz` and `.br` files for JS and CSS assets
- **Bundle reports** — console, JSON, and HTML reports with before/after comparison
- **Analyze-only mode** — analyze the build and generate recommendations without modifying chunk topology or output files
- **Three strategies** — conservative, balanced (default), and aggressive
- **Framework-agnostic** — works with React, Vue, Svelte, Solid, and vanilla

## Installation

```bash
npm install -D vite-plugin-bundle-optimizer
yarn add -D vite-plugin-bundle-optimizer
pnpm add -D vite-plugin-bundle-optimizer
```

## Quick Start

```ts
import { defineConfig } from 'vite';
import bundleOptimizer from 'vite-plugin-bundle-optimizer';

export default defineConfig({
  plugins: [bundleOptimizer()],
});
```

That's it. The plugin automatically optimizes your production build.

## Analyze-Only Mode

Not sure if the plugin will help? Enable `analyzeOnly` to get a report with recommendations without modifying your build output:

```ts
import { defineConfig } from 'vite';
import bundleOptimizer from 'vite-plugin-bundle-optimizer';

export default defineConfig({
  plugins: [
    bundleOptimizer({
      analyzeOnly: true,
      report: {
        format: ['console', 'json', 'html'],
        output: './bundle-report.json',
        detailed: true,
      },
    }),
  ],
});
```

In this mode the plugin:

- **Analyzes** the production build — modules, chunks, dependency graph, sizes
- **Generates recommendations** — shared dependencies, vendor grouping, lazy loading candidates, chunk size issues, initial bundle size
- **Does not modify** chunk topology, file names, or file contents
- **Does not create** `.gz` or `.br` compression files
- **Produces reports** in console, JSON, and HTML formats

Each recommendation includes:

| Field | Description |
|---|---|
| `id` | Stable recommendation type identifier |
| `severity` | `info`, `warning`, or `high` |
| `title` | Short title |
| `description` | What was detected |
| `reason` | Why it may be inefficient |
| `evidence` | Measurable data backing the recommendation |
| `suggestion` | Proposed change |
| `estimatedImpact` | Potential effect (only if reliably calculable) |

The HTML report supports automatic light/dark theme switching based on the user's system preference.

## Configuration

```ts
bundleOptimizer({
  enabled: true,

  // Analyze-only mode: analyze and recommend without modifying the build
  analyzeOnly: false,

  // Optimization strategy: 'conservative' | 'balanced' | 'aggressive'
  strategy: 'balanced',

  // Chunk size limits
  minChunkSize: 30_000,   // 30 KB — chunks smaller than this are merged
  maxChunkSize: 500_000,  // 500 KB — target maximum chunk size
  maxChunks: 30,          // Maximum number of chunks

  // Compression
  compression: {
    gzip: true,
    brotli: true,
    gzipLevel: 9,       // 1-9, higher = smaller output
    brotliQuality: 11,  // 0-11, higher = smaller output
  },

  // Reporting
  report: true,           // or { format: 'json', output: './bundle-report.json' }

  // Network assumptions for chunk count tuning
  network: {
    protocol: 'auto',     // 'http1' | 'http2' | 'http3' | 'auto'
  },
});
```

## Explicit Groups

Define custom vendor groups:

```ts
bundleOptimizer({
  groups: {
    editor: ['monaco-editor', '@monaco-editor/*'],
    charts: ['chart.js', 'recharts'],
  },
});
```

This creates `editor.[hash].js` and `charts.[hash].js` chunks.

## Exclude

Exclude packages from optimization (left to Rollup's default behavior):

```ts
bundleOptimizer({
  exclude: ['react', 'react-dom'],
});
// or with regex
exclude: [/@internal/],
```

## Preserve

Prevent specific packages from being redistributed:

```ts
bundleOptimizer({
  preserve: ['monaco-editor'],
});
```

## Reports

### Console Report (default)

```text
Vite Bundle Optimizer

Before
────────────────────────────────────────────────────────
  Initial JS       2.13 MB
  Initial gzip     616 KB
  Initial chunks   1

After
────────────────────────────────────────────────────────
  Initial JS       540 KB
  Initial gzip     168 KB
  Initial chunks   8

Saved
────────────────────────────────────────────────────────
  Initial JS       -75%
  Initial gzip     -73%
```

### JSON Report

```ts
bundleOptimizer({
  report: {
    format: 'json',
    output: './bundle-report.json',
  },
});
```

### HTML Report

```ts
bundleOptimizer({
  report: {
    format: 'html',
    output: './bundle-report.html',
  },
});
```

### Multiple Formats

```ts
bundleOptimizer({
  report: {
    format: ['console', 'json', 'html'],
    output: './bundle-report.json',
    detailed: true,
  },
});
```

## Performance Budgets

```ts
bundleOptimizer({
  failOnError: true,
  budget: {
    initialGzip: 200_000,  // 200 KB max initial gzip
    totalGzip: 1_000_000, // 1 MB max total gzip
  },
});
```

## Strategies

| Strategy | minChunkSize | maxChunkSize | maxChunks | Use case |
|---|---|---|---|---|
| conservative | 50 KB | 1 MB | 15 | Legacy apps, minimal changes |
| balanced (default) | 30 KB | 500 KB | 30 | Most applications |
| aggressive | 20 KB | 300 KB | 50 | Maximum initial size reduction |

## How It Works

The optimization pipeline runs in the following stages:

1. **Build handoff** — Vite delegates bundling to Rollup, which produces a dependency graph of all modules in the project.
2. **Module analysis** — The plugin inspects that graph to understand which modules are shared across entry points and which come from third‑party packages.
3. **Chunk optimization** — Based on the analysis, modules are split into two kinds of dedicated chunks:
   - **Shared chunks** — code used by multiple entry points, extracted so it isn't duplicated.
   - **Vendor chunks** — third‑party dependencies, grouped according to the configured vendor groups.
4. **Final JS chunks** — Shared and vendor chunks are combined with the remaining entry chunks into the final set of JS chunks emitted to `dist/assets`.
5. **Compression** — JS and CSS assets are compressed with **gzip** and **brotli**, producing `.gz` and `.br` files alongside the originals.
6. **Compression reporting** — Each final chunk is measured with both **gzip** and **brotli** to report the actual transfer sizes.

The plugin works at the chunk topology level only — it does not modify, remove, or rewrite application code. Tree shaking remains Rollup's responsibility.

## Requirements

- Vite 5+ (supports Vite 5.x, 6.x, 7.x, and 8.x with Rolldown)
- Node.js 20+

## License

MIT
