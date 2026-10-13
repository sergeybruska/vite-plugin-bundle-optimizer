/** Public type definitions for vite-bundle-optimizer. */

export type Strategy = 'aggressive' | 'balanced' | 'conservative';
export type NetworkProtocol = 'http1' | 'http2' | 'http3' | 'auto';
export type ReportFormat = 'console' | 'json' | 'html';

export interface CompressionOptions {
  /** Generate .gz files for JS and CSS assets. Default: true */
  gzip?: boolean;
  /** Generate .br files for JS and CSS assets. Default: true */
  brotli?: boolean;
  /** Generate .zst files (requires Node 22+ or external support). Default: false */
  zstd?: boolean;
  /** Compression level for gzip (1-9). Default: 9 */
  gzipLevel?: number;
  /** Compression quality for brotli (0-11). Default: 11 */
  brotliQuality?: number;
}

export interface ReportOptions {
  /** Enable/disable reporting. Default: true */
  enabled?: boolean;
  /** Output format(s). Default: 'console' */
  format?: ReportFormat | ReportFormat[];
  /** Output file path for JSON/HTML reports. Default: './bundle-report.json' or './bundle-report.html' */
  output?: string;
  /** Include detailed per-chunk breakdown. Default: false */
  detailed?: boolean;
}

export interface NetworkOptions {
  /** Network protocol assumption for chunk count tuning. Default: 'auto' */
  protocol?: NetworkProtocol;
}

export interface BudgetOptions {
  /** Maximum allowed initial gzip size in bytes. Exceeding fails the build (when failOnError). */
  initialGzip?: number;
  /** Maximum allowed total gzip size in bytes. */
  totalGzip?: number;
  /** Maximum allowed initial raw size in bytes. */
  initialRaw?: number;
  /** Maximum allowed total raw size in bytes. */
  totalRaw?: number;
}

export interface BundleOptimizerOptions {
  /** Enable/disable the plugin. Default: true */
  enabled?: boolean;
  /**
   * Analyze-only mode: analyze the production build and generate recommendations
   * without modifying chunk topology or output files. Default: false
   */
  analyzeOnly?: boolean;
  /** Optimization strategy. Default: 'balanced' */
  strategy?: Strategy;
  /** Minimum chunk size in bytes. Chunks smaller than this are merged. Default: 30_000 */
  minChunkSize?: number;
  /** Maximum chunk size in bytes. Chunks larger than this are split. Default: 500_000 */
  maxChunkSize?: number;
  /** Maximum number of chunks to create. Default: 30 */
  maxChunks?: number;
  /** Minimum number of importers for a module to be considered shared. Default: 2 */
  minSharedUsage?: number;
  /** Compression settings. */
  compression?: CompressionOptions;
  /** Report settings. Can be a boolean or detailed options. */
  report?: ReportOptions | boolean;
  /** Network protocol assumptions. */
  network?: NetworkOptions;
  /** Explicit chunk groups. Keys are chunk names, values are package name patterns. */
  groups?: Record<string, string[]>;
  /** Packages to exclude from optimization (left to Rollup's default behavior). */
  exclude?: (string | RegExp)[];
  /** Packages to preserve in their current chunk (not redistributed). */
  preserve?: string[];
  /**
   * Framework runtime packages whose APIs are accessed at module-init time.
   * Packages transitively depending on these are forced into the runtime's
   * chunk to avoid TDZ ("Cannot access X before initialization") errors.
   * Keys are framework names (matching vendor group names), values are core
   * runtime package names. Extends the built-in defaults; new frameworks can
   * be added. Default: built-in set for react/vue/svelte/solid/preact/angular.
   */
  runtimePackages?: Record<string, string[]>;
  /** Fail the build on optimization errors. Default: false */
  failOnError?: boolean;
  /** Performance budgets. Exceeding fails the build (when failOnError). */
  budget?: BudgetOptions;
}

/** Internal extended module info built from Rollup's getModuleInfo. */
export interface ModuleInfoExtended {
  id: string;
  packageName?: string;
  size: number;
  /** Modules that statically import this module (importers). */
  importedBy: string[];
  /** Modules that this module statically imports. */
  imports: string[];
  /** Modules that dynamically import this module. */
  dynamicImporters: string[];
  /** Modules that this module dynamically imports. */
  dynamicImports: string[];
  isNodeModule: boolean;
  isEntry: boolean;
  isExternal: boolean;
}

export interface ChunkScore {
  sizeSaving: number;
  duplicatedBytesSaved: number;
  requestCost: number;
  initialLoadImpact: number;
  cacheability: number;
  totalScore: number;
}

export interface ChunkInfo {
  name: string;
  modules: string[];
  isInitial: boolean;
  isVendor: boolean;
  isShared: boolean;
  size: number;
  gzipSize: number;
  brotliSize: number;
}

export interface BundleReport {
  before: {
    initial: { raw: number; gzip: number; brotli?: number };
    total: { raw: number; gzip: number; brotli?: number };
    chunks: number;
  };
  after: {
    initial: { raw: number; gzip: number; brotli?: number };
    total: { raw: number; gzip: number; brotli?: number };
    chunks: number;
  };
  chunks: ChunkInfo[];
  recommendations: string[];
  /** Structured recommendations (analyze-only mode). */
  bundleRecommendations?: BundleRecommendation[];
  /** Mode used to produce this report. */
  mode?: 'analyzeOnly' | 'optimize';
}

/** A structured optimization recommendation with measurable evidence. */
export interface BundleRecommendation {
  id: string;
  severity: 'info' | 'warning' | 'high';
  title: string;
  description: string;
  reason: string;
  evidence: Record<string, unknown>;
  suggestion: string;
  estimatedImpact?: {
    initialSizeReduction?: number;
    initialGzipReduction?: number;
    confidence: 'low' | 'medium' | 'high';
  };
}

/** Resolved (non-optional) configuration after merging user options with defaults. */
export interface ResolvedConfig {
  enabled: boolean;
  analyzeOnly: boolean;
  strategy: Strategy;
  minChunkSize: number;
  maxChunkSize: number;
  maxChunks: number;
  minSharedUsage: number;
  compression: {
    gzip: boolean;
    brotli: boolean;
    zstd: boolean;
    gzipLevel: number;
    brotliQuality: number;
  };
  report: {
    enabled: boolean;
    formats: ReportFormat[];
    output: string;
    detailed: boolean;
  };
  network: {
    protocol: NetworkProtocol;
  };
  groups: Record<string, string[]>;
  exclude: (string | RegExp)[];
  preserve: string[];
  runtimePackages: Record<string, string[]>;
  failOnError: boolean;
  budget: {
    initialGzip?: number;
    totalGzip?: number;
    initialRaw?: number;
    totalRaw?: number;
  };
}
