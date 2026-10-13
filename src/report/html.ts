import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BundleReport, BundleRecommendation, ChunkInfo } from '../types/index.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;');
}

const SEVERITY_COLORS: Record<BundleRecommendation['severity'], string> = {
  high: '#e74c3c',
  warning: '#f39c12',
  info: '#3498db',
};

const SEVERITY_LABELS: Record<BundleRecommendation['severity'], string> = {
  high: 'HIGH',
  warning: 'WARNING',
  info: 'INFO',
};

/** Generate an HTML visualization of the bundle report. */
export function generateHtmlReport(report: BundleReport): string {
  const chunks = report.chunks;
  const maxSize = Math.max(...chunks.map((c) => c.size), 1);

  const chunkRows = chunks
    .map((chunk: ChunkInfo) => {
      const widthPct = Math.max((chunk.size / maxSize) * 100, 1);
      const barColor = chunk.isInitial ? 'var(--bar-initial)' : 'var(--bar-lazy)';
      return `
        <tr>
          <td class="name">${escapeHtml(chunk.name)}</td>
          <td class="bar-cell">
            <div class="bar" style="width: ${widthPct}%; background: ${barColor};"></div>
          </td>
          <td class="size">${formatBytes(chunk.size)}</td>
          <td class="size">${formatBytes(chunk.gzipSize)}</td>
          <td class="size">${formatBytes(chunk.brotliSize)}</td>
          <td class="type">${chunk.isInitial ? 'initial' : 'lazy'}</td>
          <td class="type">${chunk.isVendor ? 'vendor' : 'app'}</td>
        </tr>`;
    })
    .join('');

  const isAnalyzeOnly = report.mode === 'analyzeOnly';

  const initialRawSaved =
    report.before.initial.raw > 0
      ? ((1 - report.after.initial.raw / report.before.initial.raw) * 100).toFixed(0)
      : '0';
  const initialGzipSaved =
    report.before.initial.gzip > 0
      ? ((1 - report.after.initial.gzip / report.before.initial.gzip) * 100).toFixed(0)
      : '0';

  // Structured recommendations (analyze-only mode)
  const structuredRecs = report.bundleRecommendations ?? [];
  const structuredRecsHtml = structuredRecs.length > 0
    ? structuredRecs.map((rec) => {
        const color = SEVERITY_COLORS[rec.severity];
        const label = SEVERITY_LABELS[rec.severity];
        const evidenceHtml = Object.entries(rec.evidence)
          .map(([k, v]) => `<tr><td class="ev-key">${escapeHtml(k)}</td><td class="ev-val">${escapeHtml(formatEvidenceValue(v))}</td></tr>`)
          .join('');
        const impactHtml = rec.estimatedImpact
          ? `<div class="rec-impact"><strong>Estimated impact:</strong> confidence: ${escapeHtml(rec.estimatedImpact.confidence)}${
              rec.estimatedImpact.initialSizeReduction !== undefined
                ? `, initial size reduction: ~${formatBytes(rec.estimatedImpact.initialSizeReduction)}`
                : ''
            }${
              rec.estimatedImpact.initialGzipReduction !== undefined
                ? `, initial gzip reduction: ~${formatBytes(rec.estimatedImpact.initialGzipReduction)}`
                : ''
            }</div>`
          : '';
        return `
        <div class="rec-card" style="border-left: 4px solid ${color};">
          <div class="rec-header">
            <span class="rec-severity" style="background: ${color};">${label}</span>
            <span class="rec-title">${escapeHtml(rec.title)}</span>
          </div>
          <p class="rec-desc">${escapeHtml(rec.description)}</p>
          <p class="rec-reason"><strong>Why:</strong> ${escapeHtml(rec.reason)}</p>
          ${evidenceHtml ? `<table class="rec-evidence"><tbody>${evidenceHtml}</tbody></table>` : ''}
          <p class="rec-suggestion"><strong>Suggestion:</strong> ${escapeHtml(rec.suggestion)}</p>
          ${impactHtml}
        </div>`;
      }).join('')
    : '';

  // Legacy string recommendations (optimize mode)
  const legacyRecsHtml = report.recommendations.length > 0
    ? report.recommendations.map((r) => `<div class="rec">${escapeHtml(r)}</div>`).join('')
    : '';

  const recommendationsHtml = structuredRecsHtml
    ? `<h2>Recommendations</h2>\n${structuredRecsHtml}`
    : legacyRecsHtml
      ? `<h2>Recommendations</h2>\n${legacyRecsHtml}`
      : '';

  const analyzeOnlyBanner = isAnalyzeOnly
    ? `<div class="banner">⚠ No automatic chunk optimization was applied. Recommendations are estimates and require verification.</div>`
    : '';

  const summaryCards = isAnalyzeOnly
    ? `
    <div class="card">
      <h3>Initial JS</h3>
      <div class="value">${formatBytes(report.after.initial.raw)}</div>
      <div class="saved">gzip: ${formatBytes(report.after.initial.gzip)}</div>
      <div class="saved">brotli: ${formatBytes(report.after.initial.brotli ?? 0)}</div>
    </div>
    <div class="card">
      <h3>Total JS</h3>
      <div class="value">${formatBytes(report.after.total.raw)}</div>
      <div class="saved">gzip: ${formatBytes(report.after.total.gzip)}</div>
    </div>
    <div class="card">
      <h3>Initial Chunks</h3>
      <div class="value">${report.after.chunks}</div>
      <div class="saved">total chunks: ${report.chunks.length}</div>
    </div>
    <div class="card">
      <h3>Mode</h3>
      <div class="value">Analyze Only</div>
      <div class="saved">no optimization applied</div>
    </div>`
    : `
    <div class="card">
      <h3>Initial JS (Before)</h3>
      <div class="value">${formatBytes(report.before.initial.raw)}</div>
      <div class="saved">gzip: ${formatBytes(report.before.initial.gzip)}</div>
    </div>
    <div class="card">
      <h3>Initial JS (After)</h3>
      <div class="value">${formatBytes(report.after.initial.raw)}</div>
      <div class="saved">gzip: ${formatBytes(report.after.initial.gzip)}</div>
    </div>
    <div class="card">
      <h3>Saved</h3>
      <div class="value">${initialRawSaved}%</div>
      <div class="saved">gzip: ${initialGzipSaved}%</div>
    </div>
    <div class="card">
      <h3>Chunks</h3>
      <div class="value">${report.after.chunks}</div>
      <div class="saved">initial chunks</div>
    </div>`;

  const title = isAnalyzeOnly ? 'Vite Bundle Optimizer — Analyze Only' : 'Vite Bundle Optimizer Report';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bundle Report</title>
  <style>
    :root {
      --bg: #f8f9fa;
      --text: #333;
      --heading: #2c3e50;
      --subheading: #34495e;
      --card-bg: #fff;
      --card-shadow: 0 1px 3px rgba(0,0,0,0.1);
      --label: #7f8c8d;
      --value: #2c3e50;
      --saved: #27ae60;
      --table-bg: #fff;
      --th-bg: #ecf0f1;
      --th-color: #7f8c8d;
      --td-border: #ecf0f1;
      --type-color: #95a5a6;
      --rec-bg: #fff3cd;
      --banner-bg: #fff3cd;
      --banner-border: #ffeaa7;
      --banner-color: #856404;
      --rec-card-bg: #fff;
      --rec-reason-color: #7f8c8d;
      --rec-impact-color: #7f8c8d;
      --ev-border: #f0f0f0;
      --ev-key-color: #7f8c8d;
      --bar-initial: #4a90d9;
      --bar-lazy: #66b0a0;
      --rec-severity-text: #fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a2e;
        --text: #d1d1e0;
        --heading: #e0e0f0;
        --subheading: #c0c0d8;
        --card-bg: #252540;
        --card-shadow: 0 1px 3px rgba(0,0,0,0.3);
        --label: #8c8caa;
        --value: #e0e0f0;
        --saved: #2ecc71;
        --table-bg: #252540;
        --th-bg: #2a2a48;
        --th-color: #8c8caa;
        --td-border: #2a2a48;
        --type-color: #7a7a9a;
        --rec-bg: #3a3a1a;
        --banner-bg: #3a3a1a;
        --banner-border: #5a5a2a;
        --banner-color: #ffd966;
        --rec-card-bg: #252540;
        --rec-reason-color: #8c8caa;
        --rec-impact-color: #8c8caa;
        --ev-border: #2a2a48;
        --ev-key-color: #8c8caa;
        --bar-initial: #5a9fe0;
        --bar-lazy: #76c8b8;
        --rec-severity-text: #fff;
      }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: var(--bg); color: var(--text); }
    h1 { color: var(--heading); }
    h2 { color: var(--subheading); margin-top: 32px; }
    .summary { display: flex; gap: 24px; margin: 20px 0; }
    .card { background: var(--card-bg); padding: 20px; border-radius: 8px; box-shadow: var(--card-shadow); flex: 1; }
    .card h3 { margin: 0 0 8px 0; font-size: 14px; color: var(--label); text-transform: uppercase; }
    .card .value { font-size: 28px; font-weight: bold; color: var(--value); }
    .card .saved { font-size: 14px; color: var(--saved); margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: var(--table-bg); border-radius: 8px; overflow: hidden; box-shadow: var(--card-shadow); }
    th { text-align: left; padding: 12px 16px; background: var(--th-bg); font-size: 13px; color: var(--th-color); text-transform: uppercase; }
    td { padding: 10px 16px; border-top: 1px solid var(--td-border); font-size: 14px; }
    .name { font-family: 'SF Mono', Monaco, monospace; font-size: 13px; }
    .bar-cell { width: 300px; }
    .bar { height: 20px; border-radius: 3px; min-width: 2px; }
    .size { text-align: right; font-variant-numeric: tabular-nums; }
    .type { text-align: center; font-size: 12px; color: var(--type-color); }
    .rec { background: var(--rec-bg); padding: 12px 16px; border-radius: 6px; margin: 8px 0; font-size: 14px; }
    .banner { background: var(--banner-bg); border: 1px solid var(--banner-border); padding: 12px 16px; border-radius: 6px; margin: 16px 0; font-size: 14px; color: var(--banner-color); }
    .rec-card { background: var(--rec-card-bg); padding: 16px; border-radius: 8px; margin: 12px 0; box-shadow: var(--card-shadow); }
    .rec-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .rec-severity { color: var(--rec-severity-text); font-size: 11px; font-weight: bold; padding: 2px 8px; border-radius: 3px; }
    .rec-title { font-size: 15px; font-weight: bold; }
    .rec-desc { margin: 4px 0; font-size: 14px; }
    .rec-reason { margin: 4px 0; font-size: 13px; color: var(--rec-reason-color); }
    .rec-suggestion { margin: 8px 0 4px 0; font-size: 14px; }
    .rec-impact { margin: 4px 0; font-size: 13px; color: var(--rec-impact-color); }
    .rec-evidence { width: auto; max-width: 100%; margin: 8px 0; box-shadow: none; border-radius: 4px; table-layout: fixed; }
    .rec-evidence td { padding: 4px 12px; font-size: 13px; border-top: 1px solid var(--ev-border); word-break: break-word; overflow-wrap: anywhere; }
    .ev-key { color: var(--ev-key-color); font-weight: bold; width: 140px; white-space: nowrap; }
    .ev-val { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; word-break: break-word; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${analyzeOnlyBanner}
  <div class="summary">
    ${summaryCards}
  </div>

  <h2>Chunk Details</h2>
  <table>
    <thead>
      <tr>
        <th>Chunk</th>
        <th>Distribution</th>
        <th>Size</th>
        <th>Gzip</th>
        <th>Brotli</th>
        <th>Load</th>
        <th>Type</th>
      </tr>
    </thead>
    <tbody>
      ${chunkRows}
    </tbody>
  </table>

  ${recommendationsHtml}
</body>
</html>`;
}

/** Write the HTML report to a file. */
export function writeHtmlReport(report: BundleReport, outputPath: string): void {
  const filePath = resolve(outputPath);
  writeFileSync(filePath, generateHtmlReport(report), 'utf-8');
  console.log(`Bundle report written to ${filePath}`);
}

/** Format an evidence value for HTML display. */
function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (value > 1024) return formatBytes(value);
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatEvidenceValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
