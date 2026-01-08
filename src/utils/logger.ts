/**
 * Logger - Centralized logging helper that respects the panel's debug mode.
 *
 * Normal (debug/info) output is muted when debug mode is disabled,
 * but warnings and errors always pass through so urgent signals still reach the console.
 */
export class Logger {
    private debugMode = false;

    public setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    public debug(...args: unknown[]): void {
        if (this.debugMode) {
            console.log(...args);
        }
    }

    public info(...args: unknown[]): void {
        if (this.debugMode) {
            console.info(...args);
        }
    }

    public warn(...args: unknown[]): void {
        console.warn(...args);
    }

    public error(...args: unknown[]): void {
        console.error(...args);
    }
}

export const logger = new Logger();
