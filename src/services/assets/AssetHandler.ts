import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * Asset handling utility
 *
 * Provides MD5 hash calculation for asset deduplication during exports.
 */
export class AssetHandler {
    /**
     * Calculate MD5 hash for a file
     *
     * @param filePath - Path to the file
     * @param maxBytes - Maximum bytes to hash (for large files)
     * @returns MD5 hash
     */
    static async calculateMD5(filePath: string, maxBytes: number = 100 * 1024): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('md5');
            const stream = fs.createReadStream(filePath);
            const stats = fs.statSync(filePath);

            let bytesRead = 0;
            const limit = Math.min(stats.size, maxBytes);

            stream.on('data', (chunk) => {
                bytesRead += chunk.length;
                if (bytesRead <= limit) {
                    hash.update(chunk);
                } else {
                    const remaining = limit - (bytesRead - chunk.length);
                    if (remaining > 0) {
                        hash.update(
                            Buffer.isBuffer(chunk)
                                ? chunk.subarray(0, remaining)
                                : chunk.slice(0, remaining)
                        );
                    }
                    stream.destroy();
                    resolve(hash.digest('hex'));
                    return;
                }
            });

            stream.on('end', () => {
                resolve(hash.digest('hex'));
            });

            stream.on('error', reject);
        });
    }
}
