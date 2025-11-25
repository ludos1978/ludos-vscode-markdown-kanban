/**
 * File Type Validation Utility Module for TypeScript/Node.js
 * Provides unified file type detection and validation functions using shared definitions
 */

import * as path from 'path';
import { BaseFileTypeUtils } from '../shared/fileTypeDefinitions';

export class FileTypeUtils extends BaseFileTypeUtils {
    /**
     * Get file extension using Node.js path module (without leading dot)
     */
    static getFileExtension(fileName: string): string {
        if (!fileName || typeof fileName !== 'string') {
            return '';
        }
        const ext = path.extname(fileName);
        return this.normalizeExtension(ext);
    }

    /**
     * Get file extension with leading dot (for compatibility with plugin extensions arrays)
     * Example: "file.md" -> ".md", "file.marp.md" -> ".md"
     */
    static getExtensionWithDot(filePath: string): string {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        const lastDot = filePath.lastIndexOf('.');
        if (lastDot === -1) {
            return '';
        }
        return filePath.substring(lastDot).toLowerCase();
    }
}