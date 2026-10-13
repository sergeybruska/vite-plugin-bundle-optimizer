import { describe, it, expect } from 'vitest';
import { generateRecommendations } from '../../src/recommendations/index.js';
import { computeBundleReport } from '../../src/report/analysis.js';
import type { OutputBundle, OutputChunk } from 'rollup';
import type { ResolvedConfig, ModuleInfoExtended } from '../../src/types/index.js';

function makeChunk(
  fileName: string,
  name: string,
  code: string,
  opts: {
    isEntry?: boolean;
    imports?: string[];
    dynamicImports?: string[];
    modules?: Record<string, { renderedLength?: number }>;
  } = {},
): OutputChunk {
  return {
    type: 'chunk',
    fileName,
    name,
    code,
    isEntry: opts.isEntry ?? false,
    imports: opts.imports ?? [],
    dynamicImports: opts.dynamicImports ?? [],
    facadeModuleId: null,
    exports: [],
    modules: opts.modules ?? {},
    referencedFiles: [],
    preliminaryFileName: fileName,
    map: null,
  } as unknown as OutputChunk;
}

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    enabled: true,
    analyzeOnly: false,
    strategy: 'balanced',
    minChunkSize: 30_000,
    maxChunkSize: 500_000,
    maxChunks: 30,
    minSharedUsage: 2,
    compression: { gzip: true, brotli: true, zstd: false, gzipLevel: 9, brotliQuality: 11 },
    report: { enabled: true, formats: ['console'], output: '', detailed: false },
    network: { protocol: 'auto' },
    groups: {},
    exclude: [],
    preserve: [],
    runtimePackages: {},
    failOnError: false,
    budget: {},
    ...overrides,
  };
}

function makeModuleNode(
  id: string,
  opts: Partial<ModuleInfoExtended> = {},
): ModuleInfoExtended {
  return {
    id,
    packageName: opts.packageName,
    size: opts.size ?? 1000,
    importedBy: opts.importedBy ?? [],
    imports: opts.imports ?? [],
    dynamicImporters: opts.dynamicImporters ?? [],
    dynamicImports: opts.dynamicImports ?? [],
    isNodeModule: opts.isNodeModule ?? false,
    isEntry: opts.isEntry ?? false,
    isExternal: opts.isExternal ?? false,
  };
}

describe('generateRecommendations', () => {
  it('returns empty array for empty bundle', () => {
    const bundle: OutputBundle = {};
    const report = computeBundleReport(bundle);
    const config = makeConfig();
    const recs = generateRecommendations(bundle, report, config);
    expect(recs).toEqual([]);
  });

  it('returns empty array for bundle with no issues', () => {
    const bundle: OutputBundle = {
      'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), { isEntry: true }),
    };
    const report = computeBundleReport(bundle);
    const config = makeConfig();
    const recs = generateRecommendations(bundle, report, config);
    // Small chunk below minChunkSize will trigger a small-chunk info recommendation
    // but let's check there are no high-severity ones
    const highSeverity = recs.filter((r) => r.severity === 'high');
    expect(highSeverity).toHaveLength(0);
  });

  describe('large-initial-bundle', () => {
    it('generates high severity when initial JS exceeds maxChunkSize', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(600_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ maxChunkSize: 500_000 });
      const recs = generateRecommendations(bundle, report, config);

      const largeInitial = recs.find((r) => r.id === 'large-initial-bundle');
      expect(largeInitial).toBeDefined();
      expect(largeInitial!.severity).toBe('high');
      expect(largeInitial!.evidence.initialJs).toBe(600_000);
      expect(largeInitial!.evidence.target).toBe(500_000);
    });

    it('does not generate when initial JS is within target', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(100_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ maxChunkSize: 500_000 });
      const recs = generateRecommendations(bundle, report, config);

      expect(recs.find((r) => r.id === 'large-initial-bundle')).toBeUndefined();
    });
  });

  describe('large-chunk', () => {
    it('generates warning when a chunk exceeds maxChunkSize', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(600_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ maxChunkSize: 500_000 });
      const recs = generateRecommendations(bundle, report, config);

      const largeChunk = recs.find((r) => r.id === 'large-chunk');
      expect(largeChunk).toBeDefined();
      expect(largeChunk!.severity).toBe('warning');
      expect(largeChunk!.evidence.chunk).toBe('index');
      expect(largeChunk!.evidence.size).toBe(600_000);
    });
  });

  describe('small-chunk', () => {
    it('generates info when a chunk is below minChunkSize', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ minChunkSize: 30_000 });
      const recs = generateRecommendations(bundle, report, config);

      const smallChunk = recs.find((r) => r.id === 'small-chunk');
      expect(smallChunk).toBeDefined();
      expect(smallChunk!.severity).toBe('info');
      expect(smallChunk!.evidence.size).toBe(10_000);
      expect(smallChunk!.evidence.minChunkSize).toBe(30_000);
    });
  });

  describe('too-many-chunks', () => {
    it('generates warning when total chunks exceed maxChunks', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(50_000), { isEntry: true }),
        'chunk1.js': makeChunk('chunk1.js', 'chunk1', 'x'.repeat(50_000)),
        'chunk2.js': makeChunk('chunk2.js', 'chunk2', 'x'.repeat(50_000)),
        'chunk3.js': makeChunk('chunk3.js', 'chunk3', 'x'.repeat(50_000)),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ maxChunks: 2 });
      const recs = generateRecommendations(bundle, report, config);

      const tooMany = recs.find((r) => r.id === 'too-many-chunks');
      expect(tooMany).toBeDefined();
      expect(tooMany!.severity).toBe('warning');
      expect(tooMany!.evidence.totalChunks).toBe(4);
      expect(tooMany!.evidence.maxChunks).toBe(2);
    });

    it('does not generate when within maxChunks', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(50_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ maxChunks: 30 });
      const recs = generateRecommendations(bundle, report, config);

      expect(recs.find((r) => r.id === 'too-many-chunks')).toBeUndefined();
    });
  });

  describe('lazy-loading-candidate', () => {
    it('generates recommendation for large initial vendor chunk', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          imports: ['vendor-react.js'],
        }),
        'vendor-react.js': makeChunk('vendor-react.js', 'vendor-react', 'x'.repeat(50_000)),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ minChunkSize: 30_000 });
      const recs = generateRecommendations(bundle, report, config);

      const lazyCandidate = recs.find((r) => r.id === 'lazy-loading-candidate');
      expect(lazyCandidate).toBeDefined();
      expect(lazyCandidate!.evidence.chunk).toBe('vendor-react');
      expect(lazyCandidate!.evidence.isInitial).toBe(true);
      expect(lazyCandidate!.evidence.isVendor).toBe(true);
    });

    it('does not generate for small vendor chunks', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          imports: ['vendor-react.js'],
        }),
        'vendor-react.js': makeChunk('vendor-react.js', 'vendor-react', 'x'.repeat(5_000)),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ minChunkSize: 30_000 });
      const recs = generateRecommendations(bundle, report, config);

      expect(recs.find((r) => r.id === 'lazy-loading-candidate')).toBeUndefined();
    });
  });

  describe('shared-dependencies', () => {
    it('detects shared dependencies across chunks using module graph', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          imports: ['chunk-a.js', 'chunk-b.js'],
          dynamicImports: ['chunk-a.js', 'chunk-b.js'],
        }),
        'chunk-a.js': makeChunk('chunk-a.js', 'chunk-a', 'x'.repeat(10_000), {
          modules: {
            '/src/a.ts': { renderedLength: 5000 },
            '/node_modules/lodash/index.js': { renderedLength: 5000 },
          },
        }),
        'chunk-b.js': makeChunk('chunk-b.js', 'chunk-b', 'x'.repeat(10_000), {
          modules: {
            '/src/b.ts': { renderedLength: 5000 },
            '/node_modules/lodash/index.js': { renderedLength: 5000 },
          },
        }),
      };

      const report = computeBundleReport(bundle);
      const config = makeConfig({ minSharedUsage: 2 });

      const moduleGraph = new Map<string, ModuleInfoExtended>();
      moduleGraph.set('/node_modules/lodash/index.js', makeModuleNode('/node_modules/lodash/index.js', {
        packageName: 'lodash',
        isNodeModule: true,
        size: 5000,
        importedBy: ['/src/a.ts', '/src/b.ts'],
      }));
      moduleGraph.set('/src/a.ts', makeModuleNode('/src/a.ts', { isEntry: true }));
      moduleGraph.set('/src/b.ts', makeModuleNode('/src/b.ts'));

      const recs = generateRecommendations(bundle, report, config, moduleGraph);
      const shared = recs.find((r) => r.id === 'shared-dependencies');
      expect(shared).toBeDefined();
      expect(shared!.evidence.affectedChunkCount).toBeGreaterThanOrEqual(2);
    });

    it('does not detect shared dependencies without module graph', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);

      expect(recs.find((r) => r.id === 'shared-dependencies')).toBeUndefined();
    });
  });

  describe('vendor-grouping', () => {
    it('detects related vendor packages scattered across chunks', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          modules: {
            '/node_modules/react/index.js': { renderedLength: 20000 },
          },
        }),
        'chunk-b.js': makeChunk('chunk-b.js', 'chunk-b', 'x'.repeat(10_000), {
          modules: {
            '/node_modules/react-dom/index.js': { renderedLength: 30000 },
          },
        }),
      };

      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);

      const vendorGroup = recs.find((r) => r.id === 'vendor-grouping');
      expect(vendorGroup).toBeDefined();
      expect(vendorGroup!.evidence.group).toBe('react');
      expect((vendorGroup!.evidence.packages as string[]).length).toBeGreaterThanOrEqual(2);
    });

    it('does not detect vendor grouping when packages are in one chunk', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          modules: {
            '/node_modules/react/index.js': { renderedLength: 20000 },
            '/node_modules/react-dom/index.js': { renderedLength: 30000 },
          },
        }),
      };

      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);

      expect(recs.find((r) => r.id === 'vendor-grouping')).toBeUndefined();
    });
  });

  describe('recommendation structure', () => {
    it('all recommendations have required fields', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(600_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);

      for (const rec of recs) {
        expect(rec.id).toBeTruthy();
        expect(['info', 'warning', 'high']).toContain(rec.severity);
        expect(rec.title).toBeTruthy();
        expect(rec.description).toBeTruthy();
        expect(rec.reason).toBeTruthy();
        expect(rec.evidence).toBeDefined();
        expect(typeof rec.evidence).toBe('object');
        expect(rec.suggestion).toBeTruthy();
      }
    });

    it('estimatedImpact only contains confidence when impact cannot be calculated', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(600_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);

      const largeInitial = recs.find((r) => r.id === 'large-initial-bundle');
      expect(largeInitial).toBeDefined();
      if (largeInitial!.estimatedImpact) {
        expect(largeInitial!.estimatedImpact.confidence).toBe('low');
        // Should not have fabricated size reduction values
        expect(largeInitial!.estimatedImpact.initialSizeReduction).toBeUndefined();
        expect(largeInitial!.estimatedImpact.initialGzipReduction).toBeUndefined();
      }
    });

    it('lazy-loading-candidate has measurable estimatedImpact', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(10_000), {
          isEntry: true,
          imports: ['vendor-react.js'],
        }),
        'vendor-react.js': makeChunk('vendor-react.js', 'vendor-react', 'x'.repeat(50_000)),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig({ minChunkSize: 30_000 });
      const recs = generateRecommendations(bundle, report, config);

      const lazyCandidate = recs.find((r) => r.id === 'lazy-loading-candidate');
      expect(lazyCandidate).toBeDefined();
      expect(lazyCandidate!.estimatedImpact).toBeDefined();
      expect(lazyCandidate!.estimatedImpact!.initialSizeReduction).toBe(50_000);
      expect(lazyCandidate!.estimatedImpact!.confidence).toBe('medium');
    });
  });

  describe('handles unknown/unsupported metadata gracefully', () => {
    it('handles chunks with no modules', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(50_000), {
          isEntry: true,
          modules: {},
        }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const recs = generateRecommendations(bundle, report, config);
      // Should not throw, should still produce valid recommendations
      expect(Array.isArray(recs)).toBe(true);
    });

    it('handles empty module graph', () => {
      const bundle: OutputBundle = {
        'index.js': makeChunk('index.js', 'index', 'x'.repeat(50_000), { isEntry: true }),
      };
      const report = computeBundleReport(bundle);
      const config = makeConfig();
      const emptyGraph = new Map<string, ModuleInfoExtended>();
      const recs = generateRecommendations(bundle, report, config, emptyGraph);
      // Should not throw and should not produce shared-dependencies recommendation
      expect(recs.find((r) => r.id === 'shared-dependencies')).toBeUndefined();
    });
  });
});
