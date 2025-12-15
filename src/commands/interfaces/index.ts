/**
 * Command Interfaces
 * @module commands/interfaces
 */

export {
    MessageCommand,
    BaseMessageCommand,
    CommandContext,
    CommandMetadata,
    CommandResult
} from './MessageCommand';

// Re-export IncomingMessage for command implementations
export { IncomingMessage } from '../../core/bridge/MessageTypes';
