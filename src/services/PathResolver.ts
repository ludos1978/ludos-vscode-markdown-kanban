import * as path from 'path';

/**
 * Path resolution utility for handling relative paths from webview
 */
export class PathResolver {
    /**
     * Resolve a relative path to absolute, handling URL encoding
     *
     * @param basePath - The base directory (usually document folder)
     * @param relativePath - The relative path to resolve
     * @returns Absolute path
     */
    static resolve(basePath: string, relativePath: string): string {
        // Handle null/undefined
        if (!relativePath) {
            return basePath;
        }

        // Decode URL-encoded paths (from webview)
        let decoded = relativePath;
        if (relativePath.includes('%')) {
            try {
                decoded = decodeURIComponent(relativePath);
            } catch (error) {
                // If decoding fails, use original (might not be URL-encoded)
                decoded = relativePath;
            }
        }

        // If already absolute, return as-is
        if (path.isAbsolute(decoded)) {
            return decoded;
        }

        // Resolve relative to base
        return path.resolve(basePath, decoded);
    }
}
