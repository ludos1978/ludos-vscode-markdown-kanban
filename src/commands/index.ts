/**
 * Command System
 *
 * Exports command interfaces, registry, and all command implementations.
 *
 * @module commands
 */

// Interfaces
export {
    MessageCommand,
    BaseMessageCommand,
    CommandContext,
    CommandMetadata,
    CommandResult
} from './interfaces';

// Registry
export { CommandRegistry, ValidationResult, CommandStats } from './CommandRegistry';

// Command implementations
export { TaskCommands } from './TaskCommands';
// export { ColumnCommands } from './ColumnCommands';
// export { FileCommands } from './FileCommands';
// export { ExportCommands } from './ExportCommands';
// export { ClipboardCommands } from './ClipboardCommands';
// export { EditCommands } from './EditCommands';
// export { IncludeCommands } from './IncludeCommands';
// export { DiagramCommands } from './DiagramCommands';
// export { UICommands } from './UICommands';
