/**
 * Jest Test Setup
 * Configures the test environment before tests run
 */

// Mock the vscode module - must be inline to avoid scope issues
jest.mock('vscode', () => ({
    Uri: {
        file: (path) => ({ fsPath: path, scheme: 'file', path }),
        parse: (str) => ({ fsPath: str, scheme: 'file', path: str })
    },
    workspace: {
        getConfiguration: () => ({
            get: () => undefined,
            update: () => Promise.resolve()
        }),
        workspaceFolders: [],
        fs: {
            readFile: () => Promise.resolve(Buffer.from('')),
            writeFile: () => Promise.resolve(),
            stat: () => Promise.resolve({ type: 1 })
        }
    },
    window: {
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        createOutputChannel: () => ({
            appendLine: jest.fn(),
            show: jest.fn(),
            dispose: jest.fn()
        })
    },
    commands: {
        registerCommand: jest.fn(),
        executeCommand: jest.fn()
    },
    EventEmitter: class {
        constructor() {
            this.event = jest.fn();
        }
        fire() {}
        dispose() {}
    },
    Disposable: {
        from: (...disposables) => ({
            dispose: () => disposables.forEach(d => d && d.dispose && d.dispose())
        })
    },
    FileType: {
        File: 1,
        Directory: 2
    }
}), { virtual: true });

// Increase timeout for async tests
jest.setTimeout(10000);
