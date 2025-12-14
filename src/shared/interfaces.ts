/**
 * Shared interfaces used across multiple domains
 *
 * @module shared/interfaces
 */

/**
 * Standard validation result structure
 * Used by CommandRegistry, PluginRegistry, and other validation contexts
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
