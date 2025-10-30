declare module 'node-plantuml' {
    import { Readable } from 'stream';

    interface GenerateOptions {
        format?: 'png' | 'svg' | 'eps' | 'pdf' | 'vdx' | 'xmi' | 'scxml' | 'html' | 'txt' | 'utxt' | 'latex';
        charset?: string;
    }

    interface GenerateResult {
        out: Readable;
    }

    type GenerateCallback = (error: Error | null, data: Buffer) => void;

    // Stream-based API (returns stream)
    export function generate(umlCode: string, options?: GenerateOptions): GenerateResult;

    // Callback-based API (returns child process with data in callback)
    export function generate(umlCode: string, options: GenerateOptions, callback: GenerateCallback): GenerateResult;
}
