# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-10-13

### Added
- **Analyze-only mode** (`analyzeOnly: true`) — new public option that analyzes the production build and generates optimization recommendations without modifying chunk topology, file names, file contents, or creating `.gz`/`.br` compression files
- **Structured recommendations system** — `BundleRecommendation` interface with `id`, `severity`, `title`, `description`, `reason`, `evidence`, `suggestion`, and optional `estimatedImpact` fields
- 6 recommendation types: `large-initial-bundle`, `large-chunk`, `small-chunk`, `too-many-chunks`, `lazy-loading-candidate`, `shared-dependencies`, `vendor-grouping`
- **Console report** — dedicated "Analyze Only" format with current build metrics, structured recommendations, and "no optimization applied" notice
- **JSON report** — includes `mode: "analyzeOnly"` and `bundleRecommendations` array
- **HTML report** — analyze-only layout with summary cards, severity-colored recommendation cards, evidence tables, and "no optimization applied" banner
- **Dark/light theme support** in HTML report via CSS custom properties and `@media (prefers-color-scheme: dark)` — automatically adapts to the user's system theme preference
- 19 unit tests for recommendations (all recommendation types, severity levels, evidence validation, empty bundles, unknown metadata, no fabricated impact estimates)
- 3 unit tests for `analyzeOnly` config resolution
- 8 integration tests for analyze-only mode (no `.gz`/`.br` files, identical chunk set vs. no-plugin build, identical JS content, JSON/HTML/console report generation, dark/light theme support, unchanged chunk names/count)

### Changed
- `BundleReport` type extended with optional `bundleRecommendations?: BundleRecommendation[]` and `mode?: 'analyzeOnly' | 'optimize'` fields — existing consumers are unaffected
- `BundleOptimizerOptions` and `ResolvedConfig` extended with `analyzeOnly: boolean` (default: `false`) — existing configurations continue to work without changes
- HTML report CSS refactored to use CSS custom properties (variables) for all colors, enabling theme switching

## [1.1.0] - 2026-10-12

### Fixed
- Vite 8 / Rolldown compatibility: eliminated "This plugin assigns to bundle variable" error in the `generateBundle` hook
- Rewrote `compressBundle()` to use the public `context.emitFile()` API instead of direct `bundle[fileName] = ...` assignment
- Removed manual `OutputAsset` object construction via `as unknown as OutputAsset`
- Added `isCompressedFile()` check to skip already-compressed files (`.gz`, `.br`)

### Changed
- `compressBundle()` signature updated: first argument is now `context: PluginContext`; call site in `generateBundle` updated to `compressBundle(this, bundle, config)`
- Source assets are snapshotted before `emitFile` calls so that newly created `.gz`/`.br` files are not re-processed

### Added
- 18 unit tests for `compressBundle()`: gzip on/off, brotli on/off, both algorithms, JS/CSS handling, skipping other file types, original assets immutability, skipping already-compressed files, string and binary sources, decompression verification, custom compression levels
- 7 integration tests with a real Vite build: `.css.gz`/`.css.br` files written to disk, decompression verification, no files when compression disabled, separate gzip/brotli enabling, no "assigns to bundle variable" warnings

### Compatibility
- Supports Vite 5.x, 6.x, 7.x, and 8.x (Rolldown) in a single package version
- `peerDependencies` unchanged: `vite >= 5`
- Single implementation without version branching

## [1.0.0] - 2026-10-08

### Added
- Initial public release
