import * as vscode from 'vscode';
import { KanbanBoard } from './markdownParser';

function deepCloneBoard(board: KanbanBoard): KanbanBoard {
    return JSON.parse(JSON.stringify(board));
}

export class UndoRedoManager {
    private _undoStack: KanbanBoard[] = [];
    private _redoStack: KanbanBoard[] = [];
    private readonly _maxUndoStackSize = 100;
    private _webview: vscode.Webview;
    private _document?: vscode.TextDocument;

    constructor(webview: vscode.Webview) {
        this._webview = webview;
    }

    public saveStateForUndo(board: KanbanBoard) {
        if (!board || !board.valid) {return;}
        
        this._undoStack.push(deepCloneBoard(board));
        if (this._undoStack.length > this._maxUndoStackSize) {
            this._undoStack.shift();
        }
        this._redoStack = [];
        this.sendUndoRedoStatus();
    }

    public undo(currentBoard: KanbanBoard | undefined): KanbanBoard | null {
        if (this._undoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to undo');
            return null;
        }
        
        if (currentBoard && currentBoard.valid) {
            this._redoStack.push(deepCloneBoard(currentBoard));
        }
        
        const restoredBoard = this._undoStack.pop()!;
        this.sendUndoRedoStatus();
                
        this.disableFileListenerTemporarily();
        
        return restoredBoard;
    }

    public redo(currentBoard: KanbanBoard | undefined): KanbanBoard | null {
        if (this._redoStack.length === 0) {
            vscode.window.showInformationMessage('Nothing to redo');
            return null;
        }
        
        if (currentBoard && currentBoard.valid) {
            this._undoStack.push(deepCloneBoard(currentBoard));
        }
        
        const restoredBoard = this._redoStack.pop()!;
        this.sendUndoRedoStatus();
        
        this.disableFileListenerTemporarily();
        
        return restoredBoard;
    }

    public canUndo(): boolean {
        return this._undoStack.length > 0;
    }

    public canRedo(): boolean {
        return this._redoStack.length > 0;
    }

    public clear() {
        this._undoStack = [];
        this._redoStack = [];
        this.sendUndoRedoStatus();
    }

    private sendUndoRedoStatus() {
        // Send immediately - no delay needed for message posting
        this._webview.postMessage({
            type: 'undoRedoStatus',
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        });
    }

    private disableFileListenerTemporarily() {
        try {
            const kanbanFileListener = (globalThis as any).kanbanFileListener;
            if (kanbanFileListener && kanbanFileListener.getStatus) {
                const wasEnabled = kanbanFileListener.getStatus();
                if (wasEnabled) {
                    kanbanFileListener.setStatus(false);

                    // Re-enable immediately after undo/redo operations complete
                    // Note: The messageHandler sets _isUndoRedoOperation flag to coordinate this.
                    // The file listener should check that flag instead of being disabled.
                    // This immediate re-enable is safe because undo/redo marks as unsaved but doesn't save to disk yet.
                    kanbanFileListener.setStatus(true);
                }
            }
        } catch (error) {
            console.warn('Failed to disable file listener during undo/redo:', error);
        }
    }
}