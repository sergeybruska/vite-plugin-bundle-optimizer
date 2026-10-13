import type { OutputBundle, OutputChunk } from 'rollup';
import type { BundleReport, BundleRecommendation, ChunkInfo } from '../types/index.js';
import { gzipSize } from '../compression/gzip.js';
import { brotliSize } from '../compression/brotli.js';

/** Whether a chunk name looks like a vendor chunk. */
export function isVendorChunk(name: string): boolean {
  return name.startsWith('vendor-') || name === 'vendor' || name.startsWith('shared-vendor');
}

/**
 * Determine which output chunks are "initial" (loaded on first page load).
 * Uses initial module IDs from the plan if available; otherwise traverses
 * the import graph from entry chunks, excluding dynamic imports.
 */
export function findInitialChunks(
  bundle: OutputBundle,
  initialModules?: Set<string>,
): Set<string> {
  const chunkMap = new Map<string, OutputChunk>();
  for (const asset of Object.values(bundle)) {
    if (asset.type === 'chunk') {
      chunkMap.set(asset.fileName, asset);
    }
  }

  // If we have initial module IDs from the plan, use them
  if (initialModules && initialModules.size > 0) {
    const initial = new Set<string>();

    for (const chunk of chunkMap.values()) {
      if (chunk.isEntry) {
        initial.add(chunk.fileName);
        continue;
      }

      const moduleIds = Object.keys(chunk.modules ?? {});
      if (moduleIds.length === 0) continue; // empty chunk (e.g., dynamic import facade)

      const allInitial = moduleIds.every((id) => initialModules.has(id));
      if (allInitial) {
        initial.add(chunk.fileName);
      }
    }

    return initial;
  }

  // Fallback: traverse import graph from entries, excluding dynamic imports
  const initial = new Set<string>();
  const queue: string[] = [];

  for (const chunk of chunkMap.values()) {
    if (chunk.isEntry) {
      initial.add(chunk.fileName);
      queue.push(chunk.fileName);
    }
  }

  while (queue.length > 0) {
    const fileName = queue.shift();
    if (fileName === undefined) break;
    const chunk = chunkMap.get(fileName);
    if (!chunk) continue;

    const dynamicImports = new Set(chunk.dynamicImports);

    for (const imp of chunk.imports) {
      if (dynamicImports.has(imp)) continue;
      if (!initial.has(imp) && chunkMap.has(imp)) {
        initial.add(imp);
        queue.push(imp);
      }
    }
  }

  return initial;
}

/** Compute the bundle report. "Before" = no splitting (all initial); "After" = actual output. */
export function computeBundleReport(
  bundle: OutputBundle,
  initialModules?: Set<string>,
): BundleReport {
  const initialChunks = findInitialChunks(bundle, initialModules);

  const chunks: ChunkInfo[] = [];
  let afterInitialRaw = 0;
  let afterInitialGzip = 0;
  let afterInitialBrotli = 0;
  let afterTotalRaw = 0;
  let afterTotalGzip = 0;
  let afterTotalBrotli = 0;
  let initialChunkCount = 0;
  let lazyChunkCount = 0;

  for (const asset of Object.values(bundle)) {
    if (asset.type !== 'chunk') continue;

    const code = asset.code;
    const raw = code.length;
    const gz = gzipSize(code);
    const br = brotliSize(code);
    const isInitial = initialChunks.has(asset.fileName);
    const vendor = isVendorChunk(asset.fileName) || isVendorChunk(asset.name ?? '');

    const chunkInfo: ChunkInfo = {
      name: asset.name ?? asset.fileName,
      modules: Object.keys(asset.modules ?? {}),
      isInitial,
      isVendor: vendor,
      isShared: asset.fileName.includes('shared') || (asset.name ?? '').includes('shared'),
      size: raw,
      gzipSize: gz,
      brotliSize: br,
    };
    chunks.push(chunkInfo);

    afterTotalRaw += raw;
    afterTotalGzip += gz;
    afterTotalBrotli += br;

    if (isInitial) {
      afterInitialRaw += raw;
      afterInitialGzip += gz;
      afterInitialBrotli += br;
      initialChunkCount++;
    } else {
      lazyChunkCount++;
    }
  }

  // "Before" = all JS in initial bundle (no code splitting)
  const beforeInitialRaw = afterTotalRaw;
  const beforeInitialGzip = afterTotalGzip;
  const beforeInitialBrotli = afterTotalBrotli;

  // Total is the same before/after (same code, different chunk boundaries)
  const beforeTotalRaw = afterTotalRaw;
  const beforeTotalGzip = afterTotalGzip;
  const beforeTotalBrotli = afterTotalBrotli;

  chunks.sort((a, b) => b.size - a.size);

  const recommendations = generateRecommendations(chunks, lazyChunkCount);

  return {
    before: {
      initial: { raw: beforeInitialRaw, gzip: beforeInitialGzip, brotli: beforeInitialBrotli },
      total: { raw: beforeTotalRaw, gzip: beforeTotalGzip, brotli: beforeTotalBrotli },
      chunks: 1, // before optimization: single chunk
    },
    after: {
      initial: { raw: afterInitialRaw, gzip: afterInitialGzip, brotli: afterInitialBrotli },
      total: { raw: afterTotalRaw, gzip: afterTotalGzip, brotli: afterTotalBrotli },
      chunks: initialChunkCount,
    },
    chunks,
    recommendations,
  };
}

/** Generate optimization recommendations based on the bundle report. */
function generateRecommendations(chunks: ChunkInfo[], lazyChunkCount: number): string[] {
  const recommendations: string[] = [];

  if (lazyChunkCount === 0) {
    const largeInitialChunks = chunks.filter((c) => c.isInitial && c.size > 200_000);
    if (largeInitialChunks.length > 0) {
      recommendations.push(
        '💡 No lazy chunks detected. Consider using dynamic import() for routes ' +
          'or large dependencies to reduce initial bundle size.',
      );
    }
  }

  // Suggest lazy loading for large initial vendor chunks
  const largeInitialVendors = chunks
    .filter((c) => c.isInitial && c.isVendor && c.size > 100_000)
    .sort((a, b) => b.size - a.size);

  for (const chunk of largeInitialVendors) {
    const sizeKB = (chunk.size / 1024).toFixed(0);
    const gzipKB = (chunk.gzipSize / 1024).toFixed(0);
    recommendations.push(
      `⚠ ${chunk.name} is ${sizeKB} KB (gzip: ${gzipKB} KB) and loaded initially. ` +
        `If only used on specific routes, wrap the route in dynamic import().`,
    );
  }

  // Suggest code-splitting for large initial app chunks
  const largeInitialApp = chunks
    .filter((c) => c.isInitial && !c.isVendor && c.size > 500_000)
    .sort((a, b) => b.size - a.size);

  for (const chunk of largeInitialApp) {
    const sizeKB = (chunk.size / 1024).toFixed(0);
    const gzipKB = (chunk.gzipSize / 1024).toFixed(0);
    recommendations.push(
      `⚠ ${chunk.name} is ${sizeKB} KB (gzip: ${gzipKB} KB) and loaded initially. ` +
        `Consider code-splitting routes with React.lazy() or dynamic import().`,
    );
  }

  return recommendations;
}

/**
 * Compute a bundle report for analyze-only mode.
 * In this mode, "before" and "after" are identical (no optimization applied).
 * Structured recommendations are attached if provided.
 */
export function computeAnalyzeOnlyReport(
  bundle: OutputBundle,
  initialModules?: Set<string>,
  bundleRecommendations?: BundleRecommendation[],
): BundleReport {
  const report = computeBundleReport(bundle, initialModules);
  report.mode = 'analyzeOnly';
  report.bundleRecommendations = bundleRecommendations ?? [];
  return report;
}
