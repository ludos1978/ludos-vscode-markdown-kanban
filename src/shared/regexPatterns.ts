/**
 * Shared Regex Patterns
 *
 * Centralized regex patterns for matching markdown and HTML content.
 * All patterns properly handle optional title attributes in markdown syntax.
 *
 * IMPORTANT: These are factory functions that return NEW RegExp instances.
 * This is necessary because regex objects with the 'g' flag maintain state
 * (lastIndex), and sharing a single instance across multiple uses would
 * cause bugs. Always call the function to get a fresh regex.
 *
 * @module shared/regexPatterns
 */

/**
 * Markdown content patterns
 */
export const MarkdownPatterns = {
    /**
     * Markdown image: ![alt](path) or ![alt](path "title")
     * Captures: [1] = path (without title)
     */
    image: () => /!\[[^\]]*\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g,

    /**
     * Markdown link: [text](path) or [text](path "title")
     * Uses negative lookbehind to exclude images (which start with !)
     * Captures: [1] = path (without title)
     */
    link: () => /(?<!!)\[[^\]]*\]\(([^)\s"]+)(?:\s+"[^"]*")?\)/g,

    /**
     * Include syntax: !!!include(path)!!!
     * Captures: [1] = path
     */
    include: () => /!!!include\(([^)]+)\)!!!/g,
};

/**
 * HTML content patterns
 */
export const HtmlPatterns = {
    /**
     * HTML img tag: <img src="path"> or <img src='path'>
     * Captures: [1] = path
     */
    img: () => /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,

    /**
     * HTML video/audio tags: <video src="path">, <audio src="path">
     * Captures: [1] = path
     */
    media: () => /<(?:video|audio)[^>]+src=["']([^"']+)["'][^>]*>/gi,
};

/**
 * Diagram code block patterns
 */
export const DiagramPatterns = {
    /**
     * PlantUML code block: ```plantuml\n...\n```
     * Captures: [1] = diagram code
     */
    plantuml: () => /```plantuml\s*\n([\s\S]*?)\n```/g,

    /**
     * Mermaid code block: ```mermaid\n...\n```
     * Captures: [1] = diagram code
     */
    mermaid: () => /```mermaid\s*\n([\s\S]*?)\n```/g,

    /**
     * Draw.io file reference: ![alt](path.drawio) or ![alt](path.dio "title")
     * Captures: [1] = file path, [2] = optional title
     */
    drawio: () => /!\[[^\]]*\]\(([^\s"]+\.(?:drawio|dio))(?:\s+"([^"]+)")?\)/g,

    /**
     * Excalidraw file reference: ![alt](path.excalidraw "title") or ![alt](path.excalidraw.json/.svg)
     * Captures: [1] = file path, [2] = optional title
     */
    excalidraw: () => /!\[[^\]]*\]\(([^\s"]+\.excalidraw(?:\.json|\.svg)?)(?:\s+"([^"]+)")?\)/g,

    /**
     * Excel spreadsheet file reference: ![alt](path.xlsx "title"){page=1} or ![alt](path.xls/.ods)
     * Captures: [1] = file path, [2] = optional title, [3] = optional attributes block
     */
    xlsx: () => /!\[[^\]]*\]\(([^\s"]+\.(?:xlsx|xls|ods))(?:\s+"([^"]+)")?\)(\{[^}]+\})?/g,
};

/**
 * Path validation patterns
 */
export const PathPatterns = {
    /**
     * URL pattern - matches http://, https://, data:, blob:, file:
     * Use to identify paths that should be skipped during conversion
     */
    url: () => /^(https?:|data:|blob:|file:)/i,

    /**
     * Windows drive letter pattern: C:, D:, etc.
     */
    windowsDrive: () => /^[a-zA-Z]:/,
};

/**
 * Embed content patterns
 */
export const EmbedPatterns = {
    /**
     * Markdown image with attributes: ![alt](url){.class key="value"}
     * Captures: [1] = alt, [2] = url, [3] = title (optional), [4] = attributes (optional)
     */
    imageWithAttrs: () => /!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)(\{[^}]+\})?/g,

    /**
     * Attribute block: {.class key="value" key2=value2}
     * Captures the entire attribute block for parsing
     */
    attributeBlock: () => /\{([^}]+)\}/,

    /**
     * Individual attribute: key="value" or key=value or .class or #id
     * Captures: [1] = key or class/id marker, [2] = value (if present)
     */
    attribute: () => /(?:\.(\w+)|#(\w+)|(\w+)=["']?([^"'\s}]+)["']?)/g,
};

/**
 * Convert a domain pattern (with wildcards) to a regex
 * Supports * as wildcard for any characters
 * @param pattern Domain pattern like "miro.com/app/embed" or "codepen.io/* /embed"
 * @returns RegExp that matches URLs containing this domain pattern
 */
export function domainPatternToRegex(pattern: string): RegExp {
    // Escape special regex characters except *
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Convert * to regex wildcard
    const regexPattern = escaped.replace(/\*/g, '[^/]*');
    // Match anywhere in URL (after protocol)
    return new RegExp(`^https?://(?:www\\.)?${regexPattern}`, 'i');
}

/**
 * Check if a URL matches any of the known embed domain patterns
 * @param url The URL to check
 * @param domainPatterns Array of domain patterns (supports wildcards)
 * @returns true if URL matches any pattern
 */
export function isEmbedUrl(url: string, domainPatterns: string[]): boolean {
    if (!url || !url.startsWith('http')) {
        return false;
    }
    return domainPatterns.some(pattern => domainPatternToRegex(pattern).test(url));
}

/**
 * Parse attribute block string into key-value pairs
 * @param attrString Attribute string like ".embed fallback=img.png width=100%"
 * @returns Object with parsed attributes including special 'class' and 'id' keys
 */
export function parseAttributeBlock(attrString: string): { [key: string]: string } {
    const attrs: { [key: string]: string } = {};
    if (!attrString) return attrs;

    // Remove surrounding braces if present
    const content = attrString.replace(/^\{|\}$/g, '').trim();

    // Match .class, #id, and key=value patterns
    const classMatches = content.match(/\.(\w[\w-]*)/g);
    if (classMatches) {
        attrs.class = classMatches.map(m => m.slice(1)).join(' ');
    }

    const idMatch = content.match(/#(\w[\w-]*)/);
    if (idMatch) {
        attrs.id = idMatch[1];
    }

    // Match key=value or key="value" patterns
    const kvPattern = /(\w[\w-]*)=["']?([^"'\s}]+)["']?/g;
    let match;
    while ((match = kvPattern.exec(content)) !== null) {
        attrs[match[1]] = match[2];
    }

    return attrs;
}

/**
 * Convenience function to get all content patterns for asset extraction
 * Returns array of pattern factories in order: image, link, htmlImg, htmlMedia
 */
export function getAssetPatterns(): (() => RegExp)[] {
    return [
        MarkdownPatterns.image,
        MarkdownPatterns.link,
        HtmlPatterns.img,
        HtmlPatterns.media,
    ];
}

/**
 * Check if a path is a URL (should be skipped during path processing)
 */
export function isUrl(pathStr: string): boolean {
    return PathPatterns.url().test(pathStr);
}

/**
 * Check if a path is a Windows absolute path
 */
export function isWindowsAbsolute(pathStr: string): boolean {
    return PathPatterns.windowsDrive().test(pathStr);
}
