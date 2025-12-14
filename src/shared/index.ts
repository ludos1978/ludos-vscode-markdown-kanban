/**
 * Shared module barrel file
 * Centralized exports for shared definitions used by both backend and frontend
 */

// File type definitions
export {
    FILE_EXTENSIONS,
    DOTTED_EXTENSIONS,
    MIME_TYPE_MAP,
    FileCategory,
    BaseFileTypeUtils
} from './fileTypeDefinitions';

// Shared interfaces
export { ValidationResult } from './interfaces';
