/**
 * File Type Validation Utility Module for Browser/JavaScript
 * Provides unified file type detection and validation functions using shared definitions
 *
 * Note: This extends the base functionality but cannot use ES6 imports in browser context
 * So we duplicate the core definitions here but maintain consistency with the shared module
 */

class FileTypeUtils {
    constructor() {
        // Shared file extension definitions (consistent with shared module)
        this.FILE_EXTENSIONS = {
            image: [
                'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp',
                'ico', 'tiff', 'tif', 'avif', 'heic', 'heif'
            ],
            video: [
                'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv',
                'm4v', '3gp', 'ogv', 'mpg', 'mpeg'
            ],
            audio: [
                'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma',
                'opus', 'aiff', 'au'
            ],
            text: [
                'txt', 'md', 'rst', 'org', 'tex', 'rtf', 'csv',
                'tsv', 'log', 'ini', 'cfg', 'conf'
            ]
        };
    }

    /**
     * Check if text appears to be a file path (Unix or Windows)
     * Detects: /path/to/file, C:\path\to\file, \\server\share, file:// URIs
     * Does NOT treat bare filenames (file.txt) as paths - requires path separator or drive letter
     * @param {string} text - Text to check
     * @returns {boolean} True if looks like a file path
     */
    isFilePath(text) {
        if (!text || typeof text !== 'string') {
            return false;
        }

        const trimmed = text.trim();

        // file:// URI is always a path
        if (trimmed.startsWith('file://')) {
            return true;
        }

        // Windows drive letter followed by path separator (C:\, C:/, D:\, etc.)
        // Must have separator after colon to avoid matching "kanban-task:..." or similar
        if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
            return true;
        }

        // Windows network path (\\server\share)
        if (trimmed.startsWith('\\\\')) {
            return true;
        }

        // Has path separator (Unix / or Windows \)
        if (trimmed.includes('/') || trimmed.includes('\\')) {
            // Exclude URLs (http://, https://, etc.)
            if (trimmed.includes('://')) { return false; }
            // Exclude email links
            if (trimmed.startsWith('mailto:')) { return false; }
            return true;
        }

        return false;
    }

    /**
     * Normalize path separators to forward slashes
     * Call this AFTER confirming text is a file path with isFilePath()
     * @param {string} filePath - Path to normalize
     * @returns {string} Path with forward slashes
     */
    normalizePath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }

        // Replace all backslashes with forward slashes
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Extract filename from a path (handles both Unix and Windows paths)
     * @param {string} filePath - Full path
     * @returns {string} Filename with extension
     */
    getFileName(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }

        // Split on both path separators and get last part
        const parts = filePath.split(/[\/\\]/);
        return parts.pop() || '';
    }

    /**
     * Check if a file is an image based on its extension
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's an image file
     */
    isImageFile(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }

        const extension = this._getFileExtension(fileName);
        return this.FILE_EXTENSIONS.image.includes(extension);
    }

    /**
     * Check if a file is a video based on its extension
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's a video file
     */
    isVideoFile(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }

        const extension = this._getFileExtension(fileName);
        return this.FILE_EXTENSIONS.video.includes(extension);
    }

    /**
     * Check if a file is an audio file based on its extension
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's an audio file
     */
    isAudioFile(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }

        const extension = this._getFileExtension(fileName);
        return this.FILE_EXTENSIONS.audio.includes(extension);
    }

    /**
     * Check if a file is any type of media file (image, video, or audio)
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's a media file
     */
    isMediaFile(fileName) {
        return this.isImageFile(fileName) ||
               this.isVideoFile(fileName) ||
               this.isAudioFile(fileName);
    }

    /**
     * Check if a file is a markdown file
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's a markdown file
     */
    isMarkdownFile(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }

        const extension = this._getFileExtension(fileName);
        return extension === 'md';
    }

    /**
     * Check if a file is a text file
     * @param {string} fileName - File name or path
     * @returns {boolean} True if it's a text file
     */
    isTextFile(fileName) {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }

        const extension = this._getFileExtension(fileName);
        return this.FILE_EXTENSIONS.text.includes(extension);
    }



    /**
     * Extract file extension from filename (private helper)
     * @param {string} fileName - File name or path
     * @returns {string} Lowercase extension without the dot
     * @private
     */
    _getFileExtension(fileName) {
        const extension = fileName.split('.').pop();
        return extension ? extension.toLowerCase() : '';
    }
}

// Create singleton instance
const fileTypeUtils = new FileTypeUtils();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = fileTypeUtils;
}

// Global window exposure
if (typeof window !== 'undefined') {
    window.fileTypeUtils = fileTypeUtils;
}