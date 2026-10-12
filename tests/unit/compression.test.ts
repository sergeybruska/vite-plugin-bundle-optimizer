import { describe, it, expect } from 'vitest';
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { compressBundle } from '../../src/compression/index.js';
import type { ResolvedConfig } from '../../src/types/index.js';
import type { OutputBundle, PluginContext, OutputAsset } from 'rollup';

function createMockContext(): {
  context: PluginContext;
  emitted: { fileName: string; source: string | Uint8Array; type: string }[];
} {
  const emitted: { fileName: string; source: string | Uint8Array; type: string }[] = [];
  const context = {
    emitFile: (file: { type: string; fileName?: string; source?: string | Uint8Array }) => {
      emitted.push({
        fileName: file.fileName ?? '',
        source: file.source ?? '',
        type: file.type,
      });
      return file.fileName ?? '';
    },
  } as unknown as PluginContext;
  return { context, emitted };
}

function makeConfig(gzip: boolean, brotli: boolean): ResolvedConfig {
  return {
    enabled: true,
    strategy: 'balanced',
    minChunkSize: 30_000,
    maxChunkSize: 500_000,
    maxChunks: 30,
    minSharedUsage: 2,
    compression: {
      gzip,
      brotli,
      zstd: false,
      gzipLevel: 9,
      brotliQuality: 11,
    },
    report: { enabled: false, formats: [], output: '', detailed: false },
    network: { protocol: 'auto' },
    groups: {},
    exclude: [],
    preserve: [],
    runtimePackages: {},
    failOnError: false,
    budget: {},
  };
}

function makeBundleAsset(fileName: string, source: string | Uint8Array): OutputBundle {
  const asset: OutputAsset = {
    type: 'asset',
    fileName,
    names: [],
    originalFileNames: [],
    needsCodeReference: false,
    source,
  };
  return { [fileName]: asset };
}

describe('compressBundle', () => {
  it('emits .gz files when gzip is enabled and brotli is disabled', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));
    compressBundle(context, bundle, makeConfig(true, false));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe('app.js.gz');
    expect(emitted[0].type).toBe('asset');
  });

  it('emits .br files when brotli is enabled and gzip is disabled', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));
    compressBundle(context, bundle, makeConfig(false, true));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe('app.js.br');
    expect(emitted[0].type).toBe('asset');
  });

  it('emits both .gz and .br files when both algorithms are enabled', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(2);
    const names = emitted.map((e) => e.fileName).sort();
    expect(names).toEqual(['app.js.br', 'app.js.gz']);
  });

  it('emits no files when both algorithms are disabled', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));
    compressBundle(context, bundle, makeConfig(false, false));

    expect(emitted).toHaveLength(0);
  });

  it('processes both JS and CSS assets', () => {
    const { context, emitted } = createMockContext();
    const bundle: OutputBundle = {
      ...makeBundleAsset('app.js', 'const x = 1; '.repeat(50)),
      ...makeBundleAsset('style.css', '.foo { color: red; } '.repeat(50)),
    };
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(4);
    const names = emitted.map((e) => e.fileName).sort();
    expect(names).toEqual(['app.js.br', 'app.js.gz', 'style.css.br', 'style.css.gz']);
  });

  it('skips non-JS/CSS files', () => {
    const { context, emitted } = createMockContext();
    const bundle: OutputBundle = {
      ...makeBundleAsset('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      ...makeBundleAsset('data.json', '{"key":"value"}'),
      ...makeBundleAsset('app.js', 'const x = 1; '.repeat(50)),
    };
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(2);
    const names = emitted.map((e) => e.fileName).sort();
    expect(names).toEqual(['app.js.br', 'app.js.gz']);
  });

  it('does not modify original assets', () => {
    const { context } = createMockContext();
    const originalSource = 'const x = 1; '.repeat(50);
    const bundle = makeBundleAsset('app.js', originalSource);
    compressBundle(context, bundle, makeConfig(true, true));

    expect(bundle['app.js']).toBeDefined();
    expect((bundle['app.js'] as OutputAsset).source).toBe(originalSource);

    expect(bundle['app.js.gz']).toBeUndefined();
    expect(bundle['app.js.br']).toBeUndefined();
  });

  it('does not compress already-compressed files', () => {
    const { context, emitted } = createMockContext();
    const gzData = gzipSync('const x = 1; '.repeat(50));
    const brData = brotliCompressSync('const x = 1; '.repeat(50));
    const bundle: OutputBundle = {
      ...makeBundleAsset('app.js', 'const x = 1; '.repeat(50)),
      ...makeBundleAsset('app.js.gz', gzData),
      ...makeBundleAsset('app.js.br', brData),
    };
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(2);
    const names = emitted.map((e) => e.fileName).sort();
    expect(names).toEqual(['app.js.br', 'app.js.gz']);
  });

  it('handles string sources correctly', () => {
    const { context, emitted } = createMockContext();
    const source = 'const x = 1; '.repeat(50);
    const bundle = makeBundleAsset('app.js', source);
    compressBundle(context, bundle, makeConfig(true, false));

    expect(emitted).toHaveLength(1);
    const gz = Buffer.from(emitted[0].source as Uint8Array);
    const decompressed = gunzipSync(gz).toString();
    expect(decompressed).toBe(source);
  });

  it('handles binary (Uint8Array) sources correctly', () => {
    const { context, emitted } = createMockContext();
    const source = Buffer.from('const x = 1; '.repeat(50), 'utf-8');
    const bundle = makeBundleAsset('app.js', source);
    compressBundle(context, bundle, makeConfig(false, true));

    expect(emitted).toHaveLength(1);
    const br = Buffer.from(emitted[0].source as Uint8Array);
    const decompressed = brotliDecompressSync(br).toString();
    expect(decompressed).toBe(source.toString());
  });

  it('produces gz files that decompress to the original content', () => {
    const { context, emitted } = createMockContext();
    const source = 'function foo() { return 42; } '.repeat(100);
    const bundle = makeBundleAsset('app.js', source);
    compressBundle(context, bundle, makeConfig(true, false));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe('app.js.gz');
    const gz = Buffer.from(emitted[0].source as Uint8Array);

    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    const decompressed = gunzipSync(gz).toString();
    expect(decompressed).toBe(source);
  });

  it('produces br files that decompress to the original content', () => {
    const { context, emitted } = createMockContext();
    const source = 'function foo() { return 42; } '.repeat(100);
    const bundle = makeBundleAsset('style.css', source);
    compressBundle(context, bundle, makeConfig(false, true));

    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe('style.css.br');
    const br = Buffer.from(emitted[0].source as Uint8Array);
    const decompressed = brotliDecompressSync(br).toString();
    expect(decompressed).toBe(source);
  });

  it('uses emitFile API (does not directly assign to bundle)', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(2);
    expect(bundle['app.js.gz']).toBeUndefined();
    expect(bundle['app.js.br']).toBeUndefined();
  });

  it('handles empty bundle gracefully', () => {
    const { context, emitted } = createMockContext();
    const bundle: OutputBundle = {};
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(0);
  });

  it('does not process chunks (only assets)', () => {
    const { context, emitted } = createMockContext();
    const bundle: OutputBundle = {
      'app.js': {
        type: 'chunk',
        fileName: 'app.js',
        code: 'const x = 1; '.repeat(50),
      } as never,
    };
    compressBundle(context, bundle, makeConfig(true, true));

    expect(emitted).toHaveLength(0);
  });

  it('repeated call does not produce duplicates from already-emitted assets', () => {
    const { context, emitted } = createMockContext();
    const bundle = makeBundleAsset('app.js', 'const x = 1; '.repeat(50));

    compressBundle(context, bundle, makeConfig(true, false));
    expect(emitted).toHaveLength(1);

    compressBundle(context, bundle, makeConfig(true, false));

    expect(emitted).toHaveLength(2);
    expect(emitted[1].fileName).toBe('app.js.gz');
  });

  it('respects custom gzip level', () => {
    const source = 'const x = 1; '.repeat(200);

    const { context: ctx1, emitted: emitted1 } = createMockContext();
    compressBundle(ctx1, makeBundleAsset('app.js', source), {
      ...makeConfig(true, false),
      compression: { gzip: true, brotli: false, zstd: false, gzipLevel: 1, brotliQuality: 11 },
    });

    const { context: ctx9, emitted: emitted9 } = createMockContext();
    compressBundle(ctx9, makeBundleAsset('app.js', source), {
      ...makeConfig(true, false),
      compression: { gzip: true, brotli: false, zstd: false, gzipLevel: 9, brotliQuality: 11 },
    });

    const size1 = Buffer.from(emitted1[0].source as Uint8Array).length;
    const size9 = Buffer.from(emitted9[0].source as Uint8Array).length;

    expect(size9).toBeLessThanOrEqual(size1);
  });

  it('respects custom brotli quality', () => {
    const source = 'const x = 1; '.repeat(200);

    const { context: ctxLow, emitted: emittedLow } = createMockContext();
    compressBundle(ctxLow, makeBundleAsset('app.js', source), {
      ...makeConfig(false, true),
      compression: { gzip: false, brotli: true, zstd: false, gzipLevel: 9, brotliQuality: 1 },
    });

    const { context: ctxHigh, emitted: emittedHigh } = createMockContext();
    compressBundle(ctxHigh, makeBundleAsset('app.js', source), {
      ...makeConfig(false, true),
      compression: { gzip: false, brotli: true, zstd: false, gzipLevel: 9, brotliQuality: 11 },
    });

    const sizeLow = Buffer.from(emittedLow[0].source as Uint8Array).length;
    const sizeHigh = Buffer.from(emittedHigh[0].source as Uint8Array).length;

    expect(sizeHigh).toBeLessThanOrEqual(sizeLow);
  });
});
