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
     * Draw.io file reference: ![alt](path.drawio) or ![alt](path.dio)
     * Captures: [1] = file path
     */
    drawio: () => /!\[[^\]]*\]\(([^)]+\.(?:drawio|dio))\)/g,

    /**
     * Excalidraw file reference: ![alt](path.excalidraw) or ![alt](path.excalidraw.json/.svg)
     * Captures: [1] = file path
     */
    excalidraw: () => /!\[[^\]]*\]\(([^)]+\.excalidraw(?:\.json|\.svg)?)\)/g,
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
