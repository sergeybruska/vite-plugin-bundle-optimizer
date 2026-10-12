import { gzipCompressSync } from './gzip.js';
import { brotliCompressSyncData } from './brotli.js';
import type { ResolvedConfig } from '../types/index.js';

export { gzipCompressSync, gzipCompress, gzipSize } from './gzip.js';
export { brotliCompressSyncData, brotliCompressData, brotliSize } from './brotli.js';

import type { OutputAsset, OutputBundle, PluginContext } from 'rollup';

function isCompressedFile(fileName: string): boolean {
  return fileName.endsWith('.gz') || fileName.endsWith('.br');
}

/**
 * Compress all JS/CSS assets in the bundle, emitting .gz and .br files via
 * the public `emitFile` API. This is compatible with Rollup and Rolldown.
 */
export function compressBundle(
  context: PluginContext,
  bundle: OutputBundle,
  config: ResolvedConfig,
): void {
  const assets = Object.entries(bundle).filter(
    ([, asset]) => asset.type === 'asset',
  ) as [string, OutputAsset][];

  for (const [fileName, asset] of assets) {
    if (!fileName.endsWith('.js') && !fileName.endsWith('.css')) continue;
    if (isCompressedFile(fileName)) continue;

    const source = typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source);

    if (config.compression.gzip) {
      const gz = gzipCompressSync(source, config.compression.gzipLevel);
      context.emitFile({
        type: 'asset',
        fileName: `${fileName}.gz`,
        source: gz,
      });
    }

    if (config.compression.brotli) {
      const br = brotliCompressSyncData(source, config.compression.brotliQuality);
      context.emitFile({
        type: 'asset',
        fileName: `${fileName}.br`,
        source: br,
      });
    }
  }
}
