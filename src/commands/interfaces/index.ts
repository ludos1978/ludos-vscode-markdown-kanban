/**
 * Command Interfaces
 * @module commands/interfaces
 */

export {
    MessageCommand,
    BaseMessageCommand,
    // Main context (composed of sub-interfaces)
    CommandContext,
    // Focused sub-interfaces for type narrowing
    BoardContext,
    FileContext,
    UIContext,
    EditContext,
    IncludeContext,
    ExportContext,
    ServiceContext,
    // Supporting types
    CommandMetadata,
    CommandResult,
    IncludeSwitchParams
} from './MessageCommand';

// Re-export IncomingMessage for command implementations
export { IncomingMessage } from '../../core/bridge/MessageTypes';
