/**
 * Asset handling strategy for exports
 */
export type AssetStrategy =
    | 'embed'          // Embed assets inline (base64)
    | 'copy'           // Copy assets to export directory
    | 'reference'      // Keep original references
    | 'ignore';        // Don't process assets
