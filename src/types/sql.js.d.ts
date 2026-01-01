/**
 * Type definitions for sql.js
 *
 * sql.js is a JavaScript SQLite library that uses Emscripten to compile SQLite to WebAssembly.
 */

declare module 'sql.js' {
    export interface Database {
        /**
         * Execute a SQL statement and return the result
         */
        run(sql: string, params?: unknown[]): void;

        /**
         * Execute a SQL query and return all results
         */
        exec(sql: string, params?: unknown[]): QueryExecResult[];

        /**
         * Prepare a SQL statement for execution
         */
        prepare(sql: string): Statement;

        /**
         * Export the database as a binary array
         */
        export(): Uint8Array;

        /**
         * Close the database connection
         */
        close(): void;
    }

    export interface Statement {
        /**
         * Bind parameters to the statement
         */
        bind(params?: unknown[]): boolean;

        /**
         * Execute the statement and advance to the next result row
         */
        step(): boolean;

        /**
         * Get the current row as an object
         */
        getAsObject(): Record<string, unknown>;

        /**
         * Get the current row as an array
         */
        get(): unknown[];

        /**
         * Free the statement resources
         */
        free(): void;

        /**
         * Reset the statement for re-execution
         */
        reset(): void;
    }

    export interface QueryExecResult {
        columns: string[];
        values: unknown[][];
    }

    export interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
    }

    export interface InitSqlJsOptions {
        /**
         * Function to locate the WASM file
         */
        locateFile?: (file: string) => string;
    }

    /**
     * Initialize sql.js and return the SQL module
     */
    export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
