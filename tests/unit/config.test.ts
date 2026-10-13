import { describe, it, expect } from 'vitest';
import { resolveOptions } from '../../src/config/defaults.js';

describe('resolveOptions', () => {
  it('uses defaults when no options provided', () => {
    const config = resolveOptions();
    expect(config.enabled).toBe(true);
    expect(config.strategy).toBe('balanced');
    expect(config.minChunkSize).toBe(30_000);
    expect(config.maxChunkSize).toBe(500_000);
    expect(config.maxChunks).toBe(30);
    expect(config.minSharedUsage).toBe(2);
    expect(config.compression.gzip).toBe(true);
    expect(config.compression.brotli).toBe(true);
    expect(config.compression.zstd).toBe(false);
    expect(config.report.enabled).toBe(true);
    expect(config.report.formats).toEqual(['console']);
    expect(config.failOnError).toBe(false);
  });

  it('applies aggressive strategy presets', () => {
    const config = resolveOptions({ strategy: 'aggressive' });
    expect(config.minChunkSize).toBe(20_000);
    expect(config.maxChunkSize).toBe(300_000);
    expect(config.maxChunks).toBe(50);
  });

  it('applies conservative strategy presets', () => {
    const config = resolveOptions({ strategy: 'conservative' });
    expect(config.minChunkSize).toBe(50_000);
    expect(config.maxChunkSize).toBe(1_000_000);
    expect(config.maxChunks).toBe(15);
  });

  it('explicit options override strategy presets', () => {
    const config = resolveOptions({ strategy: 'aggressive', minChunkSize: 100_000 });
    expect(config.minChunkSize).toBe(100_000);
    expect(config.maxChunkSize).toBe(300_000); // still from strategy
  });

  it('applies network protocol presets for maxChunks', () => {
    const http1 = resolveOptions({ network: { protocol: 'http1' } });
    expect(http1.maxChunks).toBe(15);

    const http2 = resolveOptions({ network: { protocol: 'http2' } });
    expect(http2.maxChunks).toBe(30);

    const http3 = resolveOptions({ network: { protocol: 'http3' } });
    expect(http3.maxChunks).toBe(40);
  });

  it('explicit maxChunks overrides network preset', () => {
    const config = resolveOptions({ network: { protocol: 'http1' }, maxChunks: 25 });
    expect(config.maxChunks).toBe(25);
  });

  it('resolves report as boolean true', () => {
    const config = resolveOptions({ report: true });
    expect(config.report.enabled).toBe(true);
    expect(config.report.formats).toEqual(['console']);
  });

  it('resolves report as boolean false', () => {
    const config = resolveOptions({ report: false });
    expect(config.report.enabled).toBe(false);
    expect(config.report.formats).toEqual([]);
  });

  it('resolves report with format string', () => {
    const config = resolveOptions({ report: { format: 'json' } });
    expect(config.report.enabled).toBe(true);
    expect(config.report.formats).toEqual(['json']);
  });

  it('resolves report with format array', () => {
    const config = resolveOptions({
      report: { format: ['console', 'json', 'html'] },
    });
    expect(config.report.formats).toEqual(['console', 'json', 'html']);
  });

  it('resolves report with output path', () => {
    const config = resolveOptions({
      report: { format: 'json', output: './reports/bundle.json' },
    });
    expect(config.report.output).toBe('./reports/bundle.json');
  });

  it('resolves report with detailed flag', () => {
    const config = resolveOptions({ report: { detailed: true } });
    expect(config.report.detailed).toBe(true);
  });

  it('resolves compression options', () => {
    const config = resolveOptions({
      compression: { gzip: false, brotli: true, gzipLevel: 6, brotliQuality: 9 },
    });
    expect(config.compression.gzip).toBe(false);
    expect(config.compression.brotli).toBe(true);
    expect(config.compression.gzipLevel).toBe(6);
    expect(config.compression.brotliQuality).toBe(9);
  });

  it('resolves groups, exclude, preserve', () => {
    const config = resolveOptions({
      groups: { editor: ['monaco-editor'] },
      exclude: ['react', /@internal/],
      preserve: ['lodash'],
    });
    expect(config.groups).toEqual({ editor: ['monaco-editor'] });
    expect(config.exclude).toEqual(['react', /@internal/]);
    expect(config.preserve).toEqual(['lodash']);
  });

  it('resolves budget options', () => {
    const config = resolveOptions({
      budget: { initialGzip: 200_000, totalGzip: 1_000_000 },
    });
    expect(config.budget.initialGzip).toBe(200_000);
    expect(config.budget.totalGzip).toBe(1_000_000);
  });

  it('resolves failOnError', () => {
    expect(resolveOptions({ failOnError: true }).failOnError).toBe(true);
    expect(resolveOptions().failOnError).toBe(false);
  });

  it('analyzeOnly defaults to false', () => {
    expect(resolveOptions().analyzeOnly).toBe(false);
  });

  it('resolves analyzeOnly when set to true', () => {
    expect(resolveOptions({ analyzeOnly: true }).analyzeOnly).toBe(true);
  });

  it('resolves analyzeOnly when explicitly set to false', () => {
    expect(resolveOptions({ analyzeOnly: false }).analyzeOnly).toBe(false);
  });
});
