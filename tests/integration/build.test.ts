import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { gzipCompressSync } from '../../src/compression/gzip.js';
import { brotliCompressSyncData } from '../../src/compression/brotli.js';
import bundleOptimizer from '../../src/index.js';

const FIXTURE_DIR = resolve(process.cwd(), 'tests/fixtures/react-app');
const DIST_DIR = resolve(FIXTURE_DIR, 'dist');

function setupFixture() {
  // Create fixture project files
  mkdirSync(resolve(FIXTURE_DIR, 'src'), { recursive: true });
  mkdirSync(resolve(FIXTURE_DIR, 'src/pages'), { recursive: true });
  mkdirSync(resolve(FIXTURE_DIR, 'src/__mocks__'), { recursive: true });

  writeFileSync(
    resolve(FIXTURE_DIR, 'index.html'),
    `<!DOCTYPE html>
<html>
  <head><title>Test</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>`,
  );

  // main.ts - entry point, imports CSS so Vite emits a CSS asset
  writeFileSync(
    resolve(FIXTURE_DIR, 'src/main.ts'),
    `import { createApp } from './app';
import './style.css';
createApp();
`,
  );

  // style.css - so Vite emits a CSS asset that can be compressed
  writeFileSync(
    resolve(FIXTURE_DIR, 'src/style.css'),
    `body { color: red; } .foo { bar: baz; } `.repeat(20),
  );

  // app.ts - imports react, dynamically imports editor and dashboard
  writeFileSync(
    resolve(FIXTURE_DIR, 'src/app.ts'),
    `export function createApp() {
  const react = 'react';
  console.log(react);

  import('./pages/Editor');
  import('./pages/Dashboard');
}
`,
  );

  // Editor page - uses monaco-editor (large, lazy)
  writeFileSync(
    resolve(FIXTURE_DIR, 'src/pages/Editor.ts'),
    `export function Editor() {
  return 'editor with monaco';
}
`,
  );

  // Dashboard page - uses chart.js (large, lazy)
  writeFileSync(
    resolve(FIXTURE_DIR, 'src/pages/Dashboard.ts'),
    `export function Dashboard() {
  return 'dashboard with charts';
}
`,
  );

  // Mock modules for the resolver
  writeFileSync(resolve(FIXTURE_DIR, 'src/__mocks__/react.ts'), `export default 'react';`);
  writeFileSync(resolve(FIXTURE_DIR, 'src/__mocks__/react-dom.ts'), `export default 'react-dom';`);
  writeFileSync(resolve(FIXTURE_DIR, 'src/__mocks__/monaco-editor.ts'), `export default 'monaco';`);
  writeFileSync(resolve(FIXTURE_DIR, 'src/__mocks__/chartjs.ts'), `export default 'chartjs';`);

  // package.json
  writeFileSync(
    resolve(FIXTURE_DIR, 'package.json'),
    JSON.stringify({
      name: 'test-fixture',
      version: '1.0.0',
      type: 'module',
    }),
  );
}

function cleanupFixture() {
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
}

/** Recursively collect all file paths in a directory. */
function collectFilesDeep(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesDeep(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/** Get just the file name (with extension) from a full path. */
function baseName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1];
}

/** Mock resolver plugin for the fixture. */
function mockResolverPlugin() {
  return {
    name: 'mock-resolver',
    enforce: 'pre' as const,
    resolveId(source: string, _importer: unknown) {
      if (source === 'react' || source === 'react-dom') {
        return resolve(FIXTURE_DIR, `src/__mocks__/${source}.ts`);
      }
      if (source === 'monaco-editor') {
        return resolve(FIXTURE_DIR, `src/__mocks__/monaco-editor.ts`);
      }
      if (source === 'chart.js') {
        return resolve(FIXTURE_DIR, `src/__mocks__/chartjs.ts`);
      }
      return null;
    },
  };
}

describe('integration: Vite build with bundleOptimizer', () => {
  it('completes build without errors', async () => {
    setupFixture();
    try {
      const result = await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [bundleOptimizer(), mockResolverPlugin()],
      });

      expect(result).toBeDefined();
      const outputs = Array.isArray(result) ? result : [result];
      expect(outputs.length).toBeGreaterThan(0);
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('generates gzip and brotli compressed files', () => {
    const testCode = 'const x = 1; '.repeat(100);
    const gz = gzipCompressSync(testCode);
    const br = brotliCompressSyncData(testCode);
    expect(gz.length).toBeLessThan(testCode.length);
    expect(br.length).toBeLessThan(testCode.length);
    expect(gz[0]).toBe(0x1f); // gzip magic number
    expect(gz[1]).toBe(0x8b);
  });

  it('writes .gz and .br files for CSS assets to disk during real build', async () => {
    setupFixture();
    try {
      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: true, brotli: true },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      // Check dist directory for compressed files (recursively, Vite uses assets/)
      expect(existsSync(DIST_DIR)).toBe(true);
      const allFiles = collectFilesDeep(DIST_DIR).map(baseName);
      const cssFiles = allFiles.filter((f) => f.endsWith('.css'));
      const gzFiles = allFiles.filter((f) => f.endsWith('.css.gz'));
      const brFiles = allFiles.filter((f) => f.endsWith('.css.br'));

      // There should be CSS asset files
      expect(cssFiles.length).toBeGreaterThan(0);
      // There should be corresponding .gz files
      expect(gzFiles.length).toBeGreaterThan(0);
      // There should be corresponding .br files
      expect(brFiles.length).toBeGreaterThan(0);

      // Each .gz file should correspond to a .css file
      for (const gzFile of gzFiles) {
        const cssFile = gzFile.replace(/\.gz$/, '');
        expect(allFiles).toContain(cssFile);
      }

      // Each .br file should correspond to a .css file
      for (const brFile of brFiles) {
        const cssFile = brFile.replace(/\.br$/, '');
        expect(allFiles).toContain(cssFile);
      }
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('compressed CSS files decompress to original content', async () => {
    setupFixture();
    try {
      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: true, brotli: true },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      const allFiles = collectFilesDeep(DIST_DIR);
      const gzFiles = allFiles.filter((f) => f.endsWith('.css.gz'));
      const brFiles = allFiles.filter((f) => f.endsWith('.css.br'));

      // Verify gzip files decompress correctly
      for (const gzPath of gzFiles) {
        const cssPath = gzPath.replace(/\.gz$/, '');
        expect(existsSync(cssPath)).toBe(true);

        const gzContent = readFileSync(gzPath);
        const cssContent = readFileSync(cssPath, 'utf-8');
        const decompressed = gunzipSync(gzContent).toString();

        expect(decompressed).toBe(cssContent);
      }

      // Verify brotli files decompress correctly
      for (const brPath of brFiles) {
        const cssPath = brPath.replace(/\.br$/, '');
        expect(existsSync(cssPath)).toBe(true);

        const brContent = readFileSync(brPath);
        const cssContent = readFileSync(cssPath, 'utf-8');
        const decompressed = brotliDecompressSync(brContent).toString();

        expect(decompressed).toBe(cssContent);
      }
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('does not write .gz/.br files when compression is disabled', async () => {
    setupFixture();
    try {
      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: false, brotli: false },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      const allFiles = collectFilesDeep(DIST_DIR).map(baseName);
      const gzFiles = allFiles.filter((f) => f.endsWith('.gz'));
      const brFiles = allFiles.filter((f) => f.endsWith('.br'));

      expect(gzFiles).toHaveLength(0);
      expect(brFiles).toHaveLength(0);
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('writes only .gz files when only gzip is enabled', async () => {
    setupFixture();
    try {
      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: true, brotli: false },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      const allFiles = collectFilesDeep(DIST_DIR).map(baseName);
      const gzFiles = allFiles.filter((f) => f.endsWith('.css.gz'));
      const brFiles = allFiles.filter((f) => f.endsWith('.css.br'));

      expect(gzFiles.length).toBeGreaterThan(0);
      expect(brFiles).toHaveLength(0);
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('writes only .br files when only brotli is enabled', async () => {
    setupFixture();
    try {
      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: false, brotli: true },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      const allFiles = collectFilesDeep(DIST_DIR).map(baseName);
      const gzFiles = allFiles.filter((f) => f.endsWith('.css.gz'));
      const brFiles = allFiles.filter((f) => f.endsWith('.css.br'));

      expect(gzFiles).toHaveLength(0);
      expect(brFiles.length).toBeGreaterThan(0);
    } finally {
      cleanupFixture();
    }
  }, 30_000);

  it('does not produce "assigns to bundle variable" warnings', async () => {
    setupFixture();
    const warnings: string[] = [];
    const originalWarn = console.warn;

    try {
      console.warn = (msg: unknown) => {
        if (typeof msg === 'string') {
          warnings.push(msg);
        }
        originalWarn(msg);
      };

      await build({
        root: FIXTURE_DIR,
        logLevel: 'warn',
        build: {
          outDir: 'dist',
          write: true,
          minify: false,
          rollupOptions: {
            output: {
              manualChunks: undefined as unknown as undefined,
            },
          },
        },
        plugins: [
          bundleOptimizer({
            compression: { gzip: true, brotli: true },
            report: { enabled: false },
          }),
          mockResolverPlugin(),
        ],
      });

      // Check that no "assigns to bundle variable" warnings were produced
      const bundleWarnings = warnings.filter((w) => w.includes('assigns to bundle variable'));
      expect(bundleWarnings).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
      cleanupFixture();
    }
  }, 30_000);
});
