import type { BundleReport, BundleRecommendation } from '../types/index.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatPercent(value: number): string {
  if (value === 0) return '0%';
  const sign = value > 0 ? '-' : '+';
  return `${sign}${Math.abs(value * 100).toFixed(0)}%`;
}

const LINE = '────────────────────────────────────────────────────────';

const SEVERITY_LABEL: Record<BundleRecommendation['severity'], string> = {
  high: '[HIGH]',
  warning: '[WARNING]',
  info: '[INFO]',
};

/** Print the bundle report to the console. */
export function printConsoleReport(report: BundleReport, detailed: boolean = false): void {
  if (report.mode === 'analyzeOnly') {
    printAnalyzeOnlyReport(report, detailed);
    return;
  }

  const before = report.before;
  const after = report.after;

  const initialRawSaved = before.initial.raw > 0 ? 1 - after.initial.raw / before.initial.raw : 0;
  const initialGzipSaved = before.initial.gzip > 0 ? 1 - after.initial.gzip / before.initial.gzip : 0;

  // Count vendor vs app, and initial vs lazy
  const vendorChunks = report.chunks.filter((c) => c.isVendor);
  const lazyChunks = report.chunks.filter((c) => !c.isInitial);
  const totalChunks = report.chunks.length;

  console.log('');
  console.log('\x1b[36m%s\x1b[0m', 'Vite Bundle Optimizer');
  console.log('');

  console.log('Before');
  console.log(LINE);
  console.log(`  Initial JS       ${formatBytes(before.initial.raw)}`);
  console.log(`  Initial gzip     ${formatBytes(before.initial.gzip)}`);
  if (before.initial.brotli) {
    console.log(`  Initial brotli   ${formatBytes(before.initial.brotli)}`);
  }
  console.log(`  Total JS         ${formatBytes(before.total.raw)}`);
  console.log(`  Total gzip       ${formatBytes(before.total.gzip)}`);
  console.log(`  Chunks            ${before.chunks}`);
  console.log('');

  console.log('After');
  console.log(LINE);
  console.log(`  Initial JS       ${formatBytes(after.initial.raw)}`);
  console.log(`  Initial gzip     ${formatBytes(after.initial.gzip)}`);
  if (after.initial.brotli) {
    console.log(`  Initial brotli   ${formatBytes(after.initial.brotli)}`);
  }
  console.log(`  Total JS         ${formatBytes(after.total.raw)}`);
  console.log(`  Total gzip       ${formatBytes(after.total.gzip)}`);
  console.log(`  Total chunks     ${totalChunks}`);
  console.log(`  Initial chunks   ${after.chunks}`);
  console.log(`  Lazy chunks      ${lazyChunks.length}`);
  console.log(`  Vendor chunks    ${vendorChunks.length}`);
  console.log('');

  console.log('Saved');
  console.log(LINE);
  console.log(`  Initial JS       ${formatPercent(initialRawSaved)}`);
  console.log(`  Initial gzip     ${formatPercent(initialGzipSaved)}`);
  console.log('');

  // Show caching benefit even when initial size didn't decrease
  if (initialRawSaved === 0 && vendorChunks.length > 1) {
    console.log('Cacheability');
    console.log(LINE);
    console.log(`  Vendor chunks    ${vendorChunks.length} separate cacheable chunks`);
    console.log(`  App code         separated from vendor code`);
    console.log(`  Long-term cache  vendor chunks stay cached when app code changes`);
    console.log('');
  }

  if (detailed) {
    console.log('Chunk Details');
    console.log(LINE);
    const header = `  ${'Chunk'.padEnd(36)} ${'Size'.padStart(10)} ${'Gzip'.padStart(10)} ${'Type'.padStart(8)}`;
    console.log(header);
    console.log(`  ${'─'.repeat(68)}`);
    for (const chunk of report.chunks) {
      const type = chunk.isInitial ? 'initial' : 'lazy';
      const name = chunk.name.length > 34 ? chunk.name.slice(0, 31) + '...' : chunk.name;
      console.log(
        `  ${name.padEnd(36)} ${formatBytes(chunk.size).padStart(10)} ${formatBytes(chunk.gzipSize).padStart(10)} ${type.padStart(8)}`,
      );
    }
    console.log('');
  }

  if (report.recommendations.length > 0) {
    console.log('Recommendations');
    console.log(LINE);
    for (const rec of report.recommendations) {
      console.log(`  ${rec}`);
    }
    console.log('');
  }
}

/** Print the analyze-only report to the console. */
function printAnalyzeOnlyReport(report: BundleReport, detailed: boolean): void {
  const after = report.after;
  const totalChunks = report.chunks.length;
  const lazyChunks = report.chunks.filter((c) => !c.isInitial).length;

  console.log('');
  console.log('\x1b[36m%s\x1b[0m', 'Vite Bundle Optimizer — Analyze Only');
  console.log('');

  console.log('Current Build');
  console.log(LINE);
  console.log(`  Initial JS       ${formatBytes(after.initial.raw)}`);
  console.log(`  Initial gzip     ${formatBytes(after.initial.gzip)}`);
  if (after.initial.brotli) {
    console.log(`  Initial brotli   ${formatBytes(after.initial.brotli)}`);
  }
  console.log(`  Initial chunks   ${after.chunks}`);
  console.log(`  Total JS         ${formatBytes(after.total.raw)}`);
  console.log(`  Total chunks     ${totalChunks}`);
  console.log(`  Lazy chunks       ${lazyChunks}`);
  console.log('');

  if (detailed) {
    console.log('Chunk Details');
    console.log(LINE);
    const header = `  ${'Chunk'.padEnd(36)} ${'Size'.padStart(10)} ${'Gzip'.padStart(10)} ${'Type'.padStart(8)}`;
    console.log(header);
    console.log(`  ${'─'.repeat(68)}`);
    for (const chunk of report.chunks) {
      const type = chunk.isInitial ? 'initial' : 'lazy';
      const name = chunk.name.length > 34 ? chunk.name.slice(0, 31) + '...' : chunk.name;
      console.log(
        `  ${name.padEnd(36)} ${formatBytes(chunk.size).padStart(10)} ${formatBytes(chunk.gzipSize).padStart(10)} ${type.padStart(8)}`,
      );
    }
    console.log('');
  }

  const recs = report.bundleRecommendations ?? [];
  if (recs.length > 0) {
    console.log('Recommendations');
    console.log(LINE);
    for (const rec of recs) {
      console.log(`  ${SEVERITY_LABEL[rec.severity]} ${rec.title}`);
      console.log(`  ${rec.description}`);
      if (rec.suggestion) {
        console.log(`  Suggestion: ${rec.suggestion}`);
      }
      console.log('');
    }
  } else {
    console.log('Recommendations');
    console.log(LINE);
    console.log('  No issues detected. The bundle looks well-optimized.');
    console.log('');
  }

  console.log('Note: Recommendations are estimates.');
  console.log('No automatic chunk optimization was applied.');
  console.log('');
}
