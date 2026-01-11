// Shared utilities for WYSIWYG editor
// Consolidates duplicated code from wysiwygEditor.ts and tokenParser.ts

export const videoExtensions = new Set(['avi', 'm4v', 'mkv', 'mov', 'mpg', 'mp4', 'ogv', 'webm', 'wmv']);
export const audioExtensions = new Set(['aac', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'wav']);
export const diagramLangs = new Set(['mermaid', 'plantuml']);

/**
 * Infers media type from file extension in source path
 */
export function inferMediaTypeFromSrc(src: string): 'video' | 'audio' | null {
    if (!src) {
        return null;
    }
    try {
        const url = new URL(src, 'http://unused.invalid');
        const extension = url.pathname.split('.').pop()?.toLowerCase() ?? '';
        if (videoExtensions.has(extension)) {
            return 'video';
        }
        if (audioExtensions.has(extension)) {
            return 'audio';
        }
    } catch {
        const cleaned = src.split(/[?#]/)[0];
        const extension = cleaned.split('.').pop()?.toLowerCase() ?? '';
        if (videoExtensions.has(extension)) {
            return 'video';
        }
        if (audioExtensions.has(extension)) {
            return 'audio';
        }
    }
    return null;
}

/**
 * Determines the flavor of a tag based on its value
 */
export function getTagFlavor(value: string): 'tag' | 'gather' | 'polarity' {
    if (value.startsWith('gather_')) {
        return 'gather';
    }
    if (/^(\+\+|\+|\u00f8|\u00d8|--|-)$/u.test(value)) {
        return 'polarity';
    }
    return 'tag';
}

/**
 * Checks if a value looks like a date (contains numbers or date-like patterns)
 */
export function isDateLike(value: string): boolean {
    if (!value) {
        return false;
    }
    if (/[0-9]/.test(value)) {
        return true;
    }
    return /^w\d+/i.test(value) || /[:/.-]/.test(value);
}
