import type { Plugin } from 'vite';
import type {
  OutputBundle,
  OutputOptions,
  ManualChunksOption,
  GetModuleInfo as RollupGetModuleInfo,
  ManualChunkMeta,
} from 'rollup';
import { resolveOptions } from './config/defaults.js';
import { computeChunkPlan } from './optimizer/chunk-planner.js';
import { compressBundle } from './compression/index.js';
import { computeBundleReport, computeAnalyzeOnlyReport } from './report/analysis.js';
import { printConsoleReport } from './report/console.js';
import { writeJsonReport } from './report/json.js';
import { writeHtmlReport } from './report/html.js';
import { generateRecommendations } from './recommendations/index.js';
import { isNodeModule, extractPackageName, matchAnyPattern } from './analyzer/package-analyzer.js';
import { buildModuleGraph, getEntryIds } from './analyzer/module-graph.js';
import { computeStaticReachability } from './analyzer/dependency-graph.js';
import { findVendorGroup, findUserGroup } from './optimizer/vendor-groups.js';
import type { BundleOptimizerOptions, ResolvedConfig, ModuleInfoExtended } from './types/index.js';

interface PluginState {
  /** moduleId → chunkName (undefined = let Rollup decide) */
  plan: Map<string, string | undefined> | null;
  /** Statically reachable module IDs (initial bundle) */
  initialModules: Set<string> | null;
  isSSR: boolean;
  config: ResolvedConfig;
  /** Original manualChunks from user/Vite config, preserved and wrapped */
  existingManualChunks: ManualChunksOption | undefined;
}

/** Create a Vite plugin for automatic bundle optimization. */
export function bundleOptimizer(options: BundleOptimizerOptions = {}): Plugin {
  const config = resolveOptions(options);

  const state: PluginState = {
    plan: null,
    initialModules: null,
    isSSR: false,
    config,
    existingManualChunks: undefined,
  };

  return {
    name: 'vite-bundle-optimizer',
    enforce: 'post',
    apply: 'build',

    /** Raise Vite's chunk size warning limit to match our maxChunkSize. */
    config(userConfig) {
      if (!config.enabled || config.analyzeOnly) return;
      return {
        ...userConfig,
        build: {
          ...userConfig.build,
          chunkSizeWarningLimit: config.maxChunkSize,
        },
      };
    },

    configResolved(resolvedConfig) {
      state.isSSR = !!(resolvedConfig.build as { ssr?: unknown }).ssr;
    },

    /**
     * Capture manualChunks from resolved output options (not `options` hook,
     * since Vite's internal plugins set it during config resolution, after
     * `options` but before `outputOptions`).
     */
    outputOptions(outputOptions: OutputOptions) {
      if (!config.enabled || state.isSSR || config.analyzeOnly) return;

      const existing = (outputOptions as { manualChunks?: ManualChunksOption }).manualChunks;
      state.existingManualChunks = existing;

      // Replace with our wrapper; the plan is computed in buildEnd before rendering.
      return {
        ...outputOptions,
        manualChunks: createManualChunksFunction(existing, state),
      } as OutputOptions;
    },

    /** After all modules are built, compute the chunk plan (before render phase). */
    buildEnd(error) {
      if (error) return;
      if (!config.enabled || state.isSSR || config.analyzeOnly) return;

      try {
        const moduleIds = (this as unknown as { getModuleIds: () => IterableIterator<string> }).getModuleIds();
        const getModuleInfo: RollupGetModuleInfo = (id: string) =>
          (this as unknown as { getModuleInfo: RollupGetModuleInfo }).getModuleInfo(id);

        const plan = computeChunkPlan(moduleIds, getModuleInfo, config);
        state.plan = plan.assignments;
        state.initialModules = plan.initialModules;

        if (config.report.enabled) {
          const chunkCount = plan.chunks.size;
          const moduleCount = plan.assignments.size;
          console.warn(`\x1b[36m[vite-bundle-optimizer]\x1b[0m Analyzed ${moduleCount} modules, planned ${chunkCount} chunks`);
        }
      } catch (err) {
        if (config.failOnError) throw err;
        console.warn('⚠ [vite-bundle-optimizer] Failed to compute chunk plan:', err);
        state.plan = null;
      }
    },

    generateBundle(_opts: OutputOptions, bundle: OutputBundle) {
      if (!config.enabled || state.isSSR) return;

      try {
        if (config.analyzeOnly) {
          // Analyze-only mode: generate reports with recommendations, no compression or optimization
          if (config.report.enabled) {
            // Build module graph for deeper analysis (shared dependencies, vendor grouping)
            let moduleGraph: Map<string, ModuleInfoExtended> | undefined;
            try {
              const moduleIds = (this as unknown as { getModuleIds: () => IterableIterator<string> }).getModuleIds();
              const getModuleInfo: RollupGetModuleInfo = (id: string) =>
                (this as unknown as { getModuleInfo: RollupGetModuleInfo }).getModuleInfo(id);
              moduleGraph = buildModuleGraph(moduleIds, getModuleInfo);
            } catch {
              // Module graph is optional; recommendations will skip shared-dependency analysis
            }

            // Compute initial modules for report
            let initialModules: Set<string> | undefined;
            if (moduleGraph) {
              const entryIds = getEntryIds(moduleGraph);
              initialModules = computeStaticReachability(moduleGraph, entryIds);
            }

            const report = computeAnalyzeOnlyReport(bundle, initialModules);
            const recommendations = generateRecommendations(bundle, report, config, moduleGraph);
            report.bundleRecommendations = recommendations;

            for (const format of config.report.formats) {
              if (format === 'console') {
                printConsoleReport(report, config.report.detailed);
              } else if (format === 'json') {
                const outputPath = config.report.output || './bundle-report.json';
                writeJsonReport(report, outputPath);
              } else if (format === 'html') {
                const outputPath = config.report.output || './bundle-report.html';
                writeHtmlReport(report, outputPath);
              }
            }

            // Budget checks (same semantics as normal mode)
            checkBudgets(report, config);
          }
          return;
        }

        // Normal mode: compression + optimization reports
        // Compression
        if (config.compression.gzip || config.compression.brotli) {
          compressBundle(this, bundle, config);
        }

        // Report
        if (config.report.enabled) {
          const report = computeBundleReport(bundle, state.initialModules ?? undefined);

          for (const format of config.report.formats) {
            if (format === 'console') {
              printConsoleReport(report, config.report.detailed);
            } else if (format === 'json') {
              const outputPath = config.report.output || './bundle-report.json';
              writeJsonReport(report, outputPath);
            } else if (format === 'html') {
              const outputPath = config.report.output || './bundle-report.html';
              writeHtmlReport(report, outputPath);
            }
          }

          // Budget checks
          checkBudgets(report, config);
        }
      } catch (err) {
        if (config.failOnError) throw err;
        console.warn('⚠ [vite-bundle-optimizer] Error in generateBundle:', err);
      }
    },
  };
}

/** Wrap existing manualChunks and fall back to our computed plan. */
function createManualChunksFunction(
  existing: ManualChunksOption | undefined,
  state: PluginState,
): ManualChunksOption {
  return (id: string, api: ManualChunkMeta) => {
    // 1. Existing manualChunks (user or Vite config)
    if (typeof existing === 'function') {
      const result = existing(id, api);
      if (result) return result;
    } else if (existing && typeof existing === 'object') {
      for (const [chunkName, ids] of Object.entries(existing)) {
        if (ids.some((pattern: string) => id.includes(pattern))) return chunkName;
      }
    }

    // 2. Computed plan
    if (state.plan) {
      const chunk = state.plan.get(id);
      if (chunk !== undefined) return chunk;
    }

    // 3. Fallback: simple vendor grouping without graph analysis
    return simpleVendorChunk(id, state.config);
  };
}

/** Simple per-module vendor chunk assignment (fallback when plan is unavailable). */
function simpleVendorChunk(id: string, config: ResolvedConfig): string | undefined {
  if (!isNodeModule(id)) return undefined;

  const packageName = extractPackageName(id);
  if (!packageName) return undefined;

  if (matchAnyPattern(packageName, config.exclude)) return undefined;
  if (config.preserve.includes(packageName)) return undefined;

  const userGroup = findUserGroup(packageName, config.groups);
  if (userGroup) return userGroup;

  const vendorGroup = findVendorGroup(packageName);
  if (vendorGroup) return `vendor-${vendorGroup}`;

  return 'vendor';
}

/** Check performance budgets and warn/fail if exceeded. */
function checkBudgets(
  report: ReturnType<typeof computeBundleReport>,
  config: ResolvedConfig,
): void {
  const checks: [string, number, number | undefined][] = [
    ['Initial gzip', report.after.initial.gzip, config.budget.initialGzip],
    ['Total gzip', report.after.total.gzip, config.budget.totalGzip],
    ['Initial raw', report.after.initial.raw, config.budget.initialRaw],
    ['Total raw', report.after.total.raw, config.budget.totalRaw],
  ];

  for (const [label, actual, limit] of checks) {
    if (limit === undefined) continue;
    if (actual > limit) {
      const msg = `❌ ${label} exceeded budget\n  Expected: < ${limit} bytes\n  Actual:   ${actual} bytes`;
      if (config.failOnError) {
        throw new Error(msg);
      }
      console.warn(msg);
    }
  }
}

export default bundleOptimizer;
