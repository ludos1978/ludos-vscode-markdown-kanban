/**
 * Global type declarations for extension-wide shared state
 */

interface KanbanFileListener {
    getStatus: () => boolean;
    setStatus: (enabled: boolean) => void;
}

declare global {
    var kanbanFileListener: KanbanFileListener | undefined;
}

export {};
