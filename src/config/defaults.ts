import type {
  BundleOptimizerOptions,
  ResolvedConfig,
  Strategy,
  NetworkProtocol,
  ReportFormat,
} from '../types/index.js';
import { mergeRuntimePackages } from '../optimizer/vendor-groups.js';

/** Default configuration values. */
export const DEFAULTS = {
  enabled: true,
  analyzeOnly: false,
  strategy: 'balanced' as Strategy,
  minChunkSize: 30_000,
  maxChunkSize: 500_000,
  maxChunks: 30,
  minSharedUsage: 2,
  compression: {
    gzip: true,
    brotli: true,
    zstd: false,
    gzipLevel: 9,
    brotliQuality: 11,
  },
  report: {
    enabled: true,
    formats: ['console'] as ReportFormat[],
    output: '',
    detailed: false,
  },
  network: {
    protocol: 'auto' as NetworkProtocol,
  },
  groups: {},
  exclude: [],
  preserve: [],
  failOnError: false,
  budget: {},
} as const;

/** Strategy-specific overrides. */
const STRATEGY_PRESETS: Record<Strategy, Partial<ResolvedConfig>> = {
  aggressive: {
    minChunkSize: 20_000,
    maxChunkSize: 300_000,
    maxChunks: 50,
    minSharedUsage: 2,
  },
  balanced: {
    minChunkSize: 30_000,
    maxChunkSize: 500_000,
    maxChunks: 30,
    minSharedUsage: 2,
  },
  conservative: {
    minChunkSize: 50_000,
    maxChunkSize: 1_000_000,
    maxChunks: 15,
    minSharedUsage: 3,
  },
};

/** Network protocol-specific overrides. */
const NETWORK_PRESETS: Record<NetworkProtocol, { maxChunks: number }> = {
  http1: { maxChunks: 15 },
  http2: { maxChunks: 30 },
  http3: { maxChunks: 40 },
  auto: { maxChunks: 30 },
};

/** Resolve user options by merging with defaults and applying strategy/network presets. */
export function resolveOptions(options: BundleOptimizerOptions = {}): ResolvedConfig {
  const strategy = options.strategy ?? DEFAULTS.strategy;
  const protocol = options.network?.protocol ?? DEFAULTS.network.protocol;

  const strategyPreset = STRATEGY_PRESETS[strategy];
  const networkPreset = NETWORK_PRESETS[protocol];

  // Resolve report config
  const reportInput = options.report;
  let report: ResolvedConfig['report'];
  if (reportInput === false) {
    report = { enabled: false, formats: [], output: '', detailed: false };
  } else if (reportInput === true || reportInput === undefined) {
    report = {
      enabled: true,
      formats: DEFAULTS.report.formats,
      output: '',
      detailed: false,
    };
  } else {
    const formats: ReportFormat[] = reportInput.format
      ? Array.isArray(reportInput.format)
        ? reportInput.format
        : [reportInput.format]
      : DEFAULTS.report.formats;
    report = {
      enabled: reportInput.enabled ?? true,
      formats,
      output: reportInput.output ?? '',
      detailed: reportInput.detailed ?? false,
    };
  }

  // maxChunks: explicit option > network preset (non-auto) > strategy preset > default
  const networkMaxChunks = protocol !== 'auto' ? networkPreset.maxChunks : undefined;
  const maxChunks =
    options.maxChunks ??
    networkMaxChunks ??
    strategyPreset.maxChunks ??
    DEFAULTS.maxChunks;

  const resolved: ResolvedConfig = {
    enabled: options.enabled ?? DEFAULTS.enabled,
    analyzeOnly: options.analyzeOnly ?? DEFAULTS.analyzeOnly,
    strategy,
    minChunkSize: options.minChunkSize ?? strategyPreset.minChunkSize ?? DEFAULTS.minChunkSize,
    maxChunkSize: options.maxChunkSize ?? strategyPreset.maxChunkSize ?? DEFAULTS.maxChunkSize,
    maxChunks,
    minSharedUsage: options.minSharedUsage ?? strategyPreset.minSharedUsage ?? DEFAULTS.minSharedUsage,
    compression: {
      gzip: options.compression?.gzip ?? DEFAULTS.compression.gzip,
      brotli: options.compression?.brotli ?? DEFAULTS.compression.brotli,
      zstd: options.compression?.zstd ?? DEFAULTS.compression.zstd,
      gzipLevel: options.compression?.gzipLevel ?? DEFAULTS.compression.gzipLevel,
      brotliQuality: options.compression?.brotliQuality ?? DEFAULTS.compression.brotliQuality,
    },
    report,
    network: { protocol },
    groups: options.groups ?? { ...DEFAULTS.groups },
    exclude: options.exclude ?? [...DEFAULTS.exclude],
    preserve: options.preserve ?? [...DEFAULTS.preserve],
    runtimePackages: mergeRuntimePackages(options.runtimePackages),
    failOnError: options.failOnError ?? DEFAULTS.failOnError,
    budget: options.budget ?? DEFAULTS.budget,
  };

  return resolved;
}
