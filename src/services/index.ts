/**
 * Services barrel file
 * Centralized exports for all service modules
 */

// Path and file utilities
export { PathResolver } from './PathResolver';
export { KeybindingService } from './KeybindingService';

// Link handling
export { LinkHandler } from './LinkHandler';

// Backup management
export { BackupManager, BackupOptions } from './BackupManager';

// Conflict resolution
export {
    ConflictResolver,
    ConflictContext,
    ConflictResolution,
    ConflictType,
    ConflictFileType
} from './ConflictResolver';

// Configuration
export {
    ConfigurationService,
    configService,
    KanbanConfiguration,
    ConfigurationDefaults
} from './ConfigurationService';

// Output channel
export { getOutputChannel, initializeOutputChannel } from './OutputChannelService';

// Asset services
export * from './assets';

// Diagram services
export * from './diagram';

// Export services
export * from './export';
