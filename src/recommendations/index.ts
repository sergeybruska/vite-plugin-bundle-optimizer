import type { OutputBundle, OutputChunk } from 'rollup';
import type {
  BundleRecommendation,
  BundleReport,
  ModuleInfoExtended,
  ResolvedConfig,
} from '../types/index.js';
import { extractPackageName, isNodeModule } from '../analyzer/package-analyzer.js';
import { findVendorGroup } from '../optimizer/vendor-groups.js';

export type { BundleRecommendation } from '../types/index.js';

/**
 * Generate structured optimization recommendations based on the actual
 * production bundle, config thresholds, and (optionally) the module graph.
 *
 * Only measurable evidence is included. No fabricated impact estimates:
 * if an impact cannot be reliably calculated, `estimatedImpact` is omitted.
 */
export function generateRecommendations(
  bundle: OutputBundle,
  report: BundleReport,
  config: ResolvedConfig,
  moduleGraph?: Map<string, ModuleInfoExtended>,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];

  recommendations.push(...detectLargeInitialBundle(report, config));
  recommendations.push(...detectChunkSizeIssues(report, config));
  recommendations.push(...detectTooManyChunks(report, config));
  recommendations.push(...detectLazyLoadingCandidates(report, config));
  recommendations.push(...detectSharedDependencies(bundle, report, config, moduleGraph));
  recommendations.push(...detectVendorGrouping(bundle, report, config));

  return recommendations;
}

/** 5.3 — Large initial bundle: initial JS exceeds configured target. */
function detectLargeInitialBundle(
  report: BundleReport,
  config: ResolvedConfig,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];
  const initialJs = report.after.initial.raw;

  if (initialJs > config.maxChunkSize) {
    recommendations.push({
      id: 'large-initial-bundle',
      severity: 'high',
      title: 'Large initial bundle',
      description: 'The initial JavaScript bundle exceeds the configured target.',
      reason:
        'A large initial payload increases time-to-interactive and may slow down first page load.',
      evidence: {
        initialJs,
        initialGzip: report.after.initial.gzip,
        initialBrotli: report.after.initial.brotli,
        target: config.maxChunkSize,
        initialChunks: report.after.chunks,
      },
      suggestion:
        'Review large dependencies in the initial bundle and consider lazy loading routes or heavy libraries.',
      estimatedImpact: {
        confidence: 'low',
      },
    });
  }

  return recommendations;
}

/** 5.4 — Chunk size issues: chunks exceeding maxChunkSize or below minChunkSize. */
function detectChunkSizeIssues(
  report: BundleReport,
  config: ResolvedConfig,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];

  const largeChunks = report.chunks.filter((c) => c.size > config.maxChunkSize);
  for (const chunk of largeChunks) {
    recommendations.push({
      id: 'large-chunk',
      severity: 'warning',
      title: `Large chunk: ${chunk.name}`,
      description: `Chunk "${chunk.name}" exceeds the configured maxChunkSize.`,
      reason:
        'Oversized chunks can slow down parsing and execution, and may benefit from splitting.',
      evidence: {
        chunk: chunk.name,
        size: chunk.size,
        gzipSize: chunk.gzipSize,
        brotliSize: chunk.brotliSize,
        maxChunkSize: config.maxChunkSize,
        isInitial: chunk.isInitial,
      },
      suggestion:
        chunk.isInitial
          ? 'Consider code-splitting this chunk with dynamic import() or React.lazy().'
          : 'Consider splitting this lazy chunk into smaller pieces.',
      estimatedImpact: {
        confidence: 'low',
      },
    });
  }

  const smallChunks = report.chunks.filter((c) => c.size < config.minChunkSize && c.size > 0);
  for (const chunk of smallChunks) {
    recommendations.push({
      id: 'small-chunk',
      severity: 'info',
      title: `Small chunk: ${chunk.name}`,
      description: `Chunk "${chunk.name}" is below the configured minChunkSize.`,
      reason:
        'Very small chunks add extra HTTP requests with diminishing returns; merging may improve loading.',
      evidence: {
        chunk: chunk.name,
        size: chunk.size,
        minChunkSize: config.minChunkSize,
        isInitial: chunk.isInitial,
      },
      suggestion: 'Consider merging this chunk with a related chunk to reduce request overhead.',
    });
  }

  return recommendations;
}

/** 5.4 — Too many chunks relative to maxChunks. */
function detectTooManyChunks(
  report: BundleReport,
  config: ResolvedConfig,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];
  const totalChunks = report.chunks.length;

  if (totalChunks > config.maxChunks) {
    recommendations.push({
      id: 'too-many-chunks',
      severity: 'warning',
      title: 'Excessive chunk count',
      description: 'The number of chunks exceeds the configured maxChunks.',
      reason:
        'Too many chunks increase HTTP request overhead, especially on HTTP/1.1 connections.',
      evidence: {
        totalChunks,
        maxChunks: config.maxChunks,
        initialChunks: report.after.chunks,
        lazyChunks: totalChunks - report.after.chunks,
      },
      suggestion: 'Consider merging related small chunks to reduce the total number of requests.',
    });
  }

  return recommendations;
}

/** 5.5 — Lazy loading: large initial vendor chunks that could be lazy-loaded. */
function detectLazyLoadingCandidates(
  report: BundleReport,
  config: ResolvedConfig,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];

  const largeInitialVendors = report.chunks
    .filter((c) => c.isInitial && c.isVendor && c.size > config.minChunkSize)
    .sort((a, b) => b.size - a.size);

  for (const chunk of largeInitialVendors) {
    recommendations.push({
      id: 'lazy-loading-candidate',
      severity: chunk.size > config.maxChunkSize ? 'warning' : 'info',
      title: `Lazy loading candidate: ${chunk.name}`,
      description: `Vendor chunk "${chunk.name}" is loaded initially but may only be needed on specific routes.`,
      reason:
        'If this vendor package is only used on certain pages, loading it eagerly wastes bandwidth on initial page load.',
      evidence: {
        chunk: chunk.name,
        size: chunk.size,
        gzipSize: chunk.gzipSize,
        brotliSize: chunk.brotliSize,
        isInitial: true,
        isVendor: true,
      },
      suggestion:
        'If only used on specific routes, wrap the route component in dynamic import() to lazy-load this dependency.',
      estimatedImpact: {
        initialSizeReduction: chunk.size,
        initialGzipReduction: chunk.gzipSize,
        confidence: 'medium',
      },
    });
  }

  return recommendations;
}

/** 5.1 — Shared dependencies: modules imported by multiple chunks. */
function detectSharedDependencies(
  bundle: OutputBundle,
  report: BundleReport,
  config: ResolvedConfig,
  moduleGraph?: Map<string, ModuleInfoExtended>,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];
  if (!moduleGraph || moduleGraph.size === 0) return recommendations;

  // Build a map of module ID → set of chunk fileNames that contain importers
  const moduleImporters = new Map<string, Set<string>>();

  const chunkMap = new Map<string, OutputChunk>();
  for (const asset of Object.values(bundle)) {
    if (asset.type === 'chunk') {
      chunkMap.set(asset.fileName, asset);
    }
  }

  // Map module IDs to their containing chunk
  const moduleToChunk = new Map<string, string>();
  for (const chunk of chunkMap.values()) {
    for (const moduleId of Object.keys(chunk.modules ?? {})) {
      moduleToChunk.set(moduleId, chunk.fileName);
    }
  }

  // For each node module, find which distinct chunks import it (directly or transitively)
  for (const node of moduleGraph.values()) {
    if (!node.isNodeModule) continue;
    if (!node.packageName) continue;

    const importingChunks = new Set<string>();
    for (const importer of node.importedBy) {
      const chunkName = moduleToChunk.get(importer);
      if (chunkName) {
        importingChunks.add(chunkName);
      }
    }

    if (importingChunks.size >= config.minSharedUsage) {
      // Group by package name to aggregate
      let entry = moduleImporters.get(node.packageName);
      if (!entry) {
        entry = new Set();
        moduleImporters.set(node.packageName, entry);
      }
      for (const c of importingChunks) entry.add(c);
    }
  }

  // Generate recommendations for shared dependencies
  const sharedPackages = [...moduleImporters.entries()]
    .filter(([, chunks]) => chunks.size >= config.minSharedUsage)
    .sort((a, b) => b[1].size - a[1].size);

  if (sharedPackages.length === 0) return recommendations;

  // Calculate duplicated size if possible
  const affectedChunks = new Set<string>();
  let totalDuplicatedSize = 0;

  for (const [packageName, chunks] of sharedPackages) {
    for (const chunk of chunks) affectedChunks.add(chunk);

    // Estimate duplicated size from module graph
    let packageSize = 0;
    if (moduleGraph) {
      for (const node of moduleGraph.values()) {
        if (node.packageName === packageName) {
          packageSize += node.size;
        }
      }
    }
    totalDuplicatedSize += packageSize;
  }

  recommendations.push({
    id: 'shared-dependencies',
    severity: affectedChunks.size >= 3 ? 'warning' : 'info',
    title: 'Shared dependencies',
    description: `${sharedPackages.length} package(s) are imported by multiple chunks and may benefit from extraction into a shared chunk.`,
    reason:
      'When the same dependency is imported by multiple chunks, extracting it into a shared chunk improves caching and avoids duplicate downloads.',
    evidence: {
      packages: sharedPackages.map(([pkg, chunks]) => ({
        package: pkg,
        importedByChunks: [...chunks],
        chunkCount: chunks.size,
      })),
      affectedChunks: [...affectedChunks],
      affectedChunkCount: affectedChunks.size,
      estimatedDuplicatedSize: totalDuplicatedSize > 0 ? totalDuplicatedSize : undefined,
    },
    suggestion:
      'Consider extracting these shared dependencies into a dedicated shared chunk using manualChunks or the plugin\'s groups option.',
    estimatedImpact:
      totalDuplicatedSize > 0
        ? {
            initialSizeReduction: undefined, // Cannot reliably estimate without re-bundling
            confidence: 'low',
          }
        : undefined,
  });

  return recommendations;
}

/** 5.2 — Vendor grouping: related vendor packages that could be grouped. */
function detectVendorGrouping(
  bundle: OutputBundle,
  report: BundleReport,
  config: ResolvedConfig,
): BundleRecommendation[] {
  const recommendations: BundleRecommendation[] = [];

  // Collect vendor packages per chunk
  const chunkVendorPackages = new Map<string, Map<string, number>>();

  for (const asset of Object.values(bundle)) {
    if (asset.type !== 'chunk') continue;
    const chunk = asset as OutputChunk;
    const vendorPackages = new Map<string, number>();

    for (const moduleId of Object.keys(chunk.modules ?? {})) {
      if (!isNodeModule(moduleId)) continue;
      const packageName = extractPackageName(moduleId);
      if (!packageName) continue;
      if (config.preserve.includes(packageName)) continue;
      if (matchesExclude(packageName, config.exclude)) continue;

      const moduleInfo = chunk.modules?.[moduleId];
      const renderedLength = moduleInfo?.renderedLength ?? 0;
      vendorPackages.set(packageName, (vendorPackages.get(packageName) ?? 0) + renderedLength);
    }

    if (vendorPackages.size > 0) {
      chunkVendorPackages.set(chunk.fileName, vendorPackages);
    }
  }

  // Group vendor packages by their ecosystem group
  const groupPackages = new Map<string, { packages: string[]; totalSize: number; chunks: Set<string> }>();

  for (const [chunkFileName, vendorPackages] of chunkVendorPackages) {
    for (const [packageName, size] of vendorPackages) {
      const vendorGroup = findVendorGroup(packageName);
      if (!vendorGroup) continue;

      let entry = groupPackages.get(vendorGroup);
      if (!entry) {
        entry = { packages: [], totalSize: 0, chunks: new Set() };
        groupPackages.set(vendorGroup, entry);
      }
      if (!entry.packages.includes(packageName)) {
        entry.packages.push(packageName);
      }
      entry.totalSize += size;
      entry.chunks.add(chunkFileName);
    }
  }

  // Recommend grouping when related vendor packages are scattered across multiple chunks
  for (const [groupName, info] of groupPackages) {
    if (info.chunks.size < 2) continue;
    if (info.packages.length < 2) continue;

    recommendations.push({
      id: 'vendor-grouping',
      severity: 'info',
      title: `Vendor grouping: ${groupName}`,
      description: `${info.packages.length} related "${groupName}" packages are spread across ${info.chunks.size} chunks.`,
      reason:
        'Grouping related vendor packages into a single chunk improves caching and reduces duplicate dependency resolution.',
      evidence: {
        group: groupName,
        packages: info.packages,
        chunks: [...info.chunks],
        chunkCount: info.chunks.size,
        estimatedSize: info.totalSize,
      },
      suggestion: `Consider grouping these packages using the plugin's groups option, e.g. groups: { "vendor-${groupName}": [${info.packages.map((p) => `'${p}'`).join(', ')}] }.`,
    });
  }

  return recommendations;
}

/** Check if a package name matches any exclude pattern. */
function matchesExclude(packageName: string, exclude: (string | RegExp)[]): boolean {
  for (const pattern of exclude) {
    if (pattern instanceof RegExp) {
      if (pattern.test(packageName)) return true;
    } else {
      if (packageName === pattern) return true;
    }
  }
  return false;
}
