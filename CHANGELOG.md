# Changelog

All notable changes to this project will be documented in this file.

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
