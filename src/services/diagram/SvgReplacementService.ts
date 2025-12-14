/**
 * SVG Replacement Service
 *
 * Generic utilities for replacing code blocks with SVG images in markdown.
 * Supports exact matching and fuzzy matching for any diagram type.
 *
 * @module services/diagram/SvgReplacementService
 */

import { escapeRegExp } from '../../utils/stringUtils';

/**
 * Options for code block replacement
 */
export interface ReplaceCodeBlockOptions {
    /** The code block type (e.g., 'plantuml', 'mermaid') */
    blockType: string;
    /** Alt text for the image (e.g., 'PlantUML Diagram') */
    altText: string;
    /** Similarity threshold for fuzzy matching (default: 0.8) */
    similarityThreshold?: number;
}

/**
 * Replace a code block with a disabled version + SVG image
 *
 * Uses exact matching with indentation preservation.
 * Falls back to fuzzy matching if exact match not found.
 *
 * @param content - The full file content
 * @param code - The code block content to match
 * @param svgRelativePath - Relative path to the SVG file
 * @param options - Replacement options (blockType, altText)
 * @returns Updated content with code block replaced
 */
export function replaceCodeBlockWithSVG(
    content: string,
    code: string,
    svgRelativePath: string,
    options: ReplaceCodeBlockOptions
): string {
    const { blockType, altText } = options;

    // Split the code into lines to handle per-line matching with indentation
    // NOTE: The frontend sends TRIMMED code, but the file may have indented code
    const codeLines = code.split('\n').filter(line => line.trim().length > 0);
    const escapedLines = codeLines.map(line => escapeRegExp(line.trim()));
    // Each line can have any indentation, then the trimmed content
    const codePattern = escapedLines.map(line => '[ \\t]*' + line).join('\\s*\\n');

    // Create regex to match ```blockType ... ``` block with any indentation
    const regexPattern = '([ \\t]*)```' + escapeRegExp(blockType) + '\\s*\\n' + codePattern + '\\s*\\n[ \\t]*```';
    const regex = new RegExp(regexPattern, 'g');

    // Replace with custom function to preserve indentation
    let updatedContent = content.replace(regex, (_match, indent) => {
        // Indent each line of the code
        const indentedCode = code.split('\n').map(line =>
            line ? `${indent}${line}` : indent.trimEnd()
        ).join('\n');

        // Create replacement with disabled block + image, preserving indentation
        return `${indent}\`\`\`${blockType}-disabled
${indentedCode}
${indent}\`\`\`

${indent}![${altText}](${svgRelativePath})`;
    });

    // Check if replacement happened
    if (updatedContent === content) {
        console.warn(`[SvgReplacementService] No matching ${blockType} block found for replacement`);
        // Try fuzzy matching as fallback
        return replaceCodeBlockWithSVGFuzzy(content, code, svgRelativePath, options);
    }

    return updatedContent;
}

/**
 * Fuzzy matching fallback for code block replacement
 *
 * Uses similarity matching to find the best matching code block.
 *
 * @param content - The full file content
 * @param code - The code block content to match
 * @param svgRelativePath - Relative path to the SVG file
 * @param options - Replacement options
 * @returns Updated content with code block replaced
 */
export function replaceCodeBlockWithSVGFuzzy(
    content: string,
    code: string,
    svgRelativePath: string,
    options: ReplaceCodeBlockOptions
): string {
    const { blockType, altText, similarityThreshold = 0.8 } = options;

    const fuzzyRegex = new RegExp('```' + escapeRegExp(blockType) + '\\s*\\n([\\s\\S]*?)\\n```', 'g');
    let match;
    let bestMatch: RegExpExecArray | null = null;
    let bestMatchIndex = -1;
    let similarity = 0;

    while ((match = fuzzyRegex.exec(content)) !== null) {
        const blockCode = match[1].trim();
        const targetCode = code.trim();

        // Calculate simple similarity
        const matchRatio = calculateSimilarity(blockCode, targetCode);

        if (matchRatio > similarity && matchRatio > similarityThreshold) {
            similarity = matchRatio;
            bestMatch = match;
            bestMatchIndex = match.index;
        }
    }

    if (bestMatch) {
        const replacement = `\`\`\`${blockType}-disabled
${code}
\`\`\`

![${altText}](${svgRelativePath})`;

        const beforeMatch = content.substring(0, bestMatchIndex);
        const afterMatch = content.substring(bestMatchIndex + bestMatch[0].length);
        return beforeMatch + replacement + afterMatch;
    }

    // If no fuzzy match found, return original content unchanged
    console.warn(`[SvgReplacementService] No fuzzy match found for ${blockType}, content unchanged`);
    return content;
}

/**
 * Calculate similarity between two strings (0 = no match, 1 = exact match)
 *
 * Uses Levenshtein distance normalized by string length.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Similarity ratio between 0 and 1
 */
export function calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    return (longerLength - editDistance(longer, shorter)) / longerLength;
}

/**
 * Calculate Levenshtein edit distance between two strings
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (number of single-character edits)
 */
export function editDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}
