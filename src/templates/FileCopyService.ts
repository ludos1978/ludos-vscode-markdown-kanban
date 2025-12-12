import * as path from 'path';
import * as fs from 'fs';
import { VariableProcessor } from './VariableProcessor';
import { TemplateVariable } from './TemplateParser';

/**
 * Service for copying template files to the board folder
 * Handles variable substitution in both filenames and file contents
 */
export class FileCopyService {
    /**
     * Copy all files from a template folder to the board folder
     * Applies variable substitution to filenames and content
     *
     * @param templateFolder - Path to the template folder
     * @param boardFolder - Path to the board folder (destination)
     * @param variables - Variable values to substitute
     * @param variableDefinitions - Variable definitions for formatting
     * @returns List of copied files with their new paths
     */
    public static async copyTemplateFiles(
        templateFolder: string,
        boardFolder: string,
        variables: Record<string, string | number>,
        variableDefinitions?: TemplateVariable[]
    ): Promise<{ source: string; destination: string; relativePath: string }[]> {
        const copiedFiles: { source: string; destination: string; relativePath: string }[] = [];

        // Get all files in template folder (excluding template.md)
        const files = await this.getTemplateFiles(templateFolder);

        for (const file of files) {
            const relativePath = path.relative(templateFolder, file);

            // Skip template.md itself
            if (relativePath === 'template.md') {
                continue;
            }

            // Apply variable substitution to the path
            const processedRelativePath = VariableProcessor.substituteFilename(
                relativePath,
                variables,
                variableDefinitions
            );

            const destinationPath = path.join(boardFolder, processedRelativePath);

            // Create destination directory if needed
            const destDir = path.dirname(destinationPath);
            await fs.promises.mkdir(destDir, { recursive: true });

            // Read source file
            const content = await fs.promises.readFile(file);

            // Check if this is a text file that should have variable substitution
            if (this.isTextFile(file)) {
                const textContent = content.toString('utf-8');
                const processedContent = VariableProcessor.substitute(
                    textContent,
                    variables,
                    variableDefinitions
                );
                await fs.promises.writeFile(destinationPath, processedContent, 'utf-8');
            } else {
                // Binary file - copy as-is
                await fs.promises.writeFile(destinationPath, content);
            }

            copiedFiles.push({
                source: file,
                destination: destinationPath,
                relativePath: processedRelativePath
            });
        }

        return copiedFiles;
    }

    /**
     * Get all files in a template folder recursively
     */
    private static async getTemplateFiles(folder: string): Promise<string[]> {
        const files: string[] = [];

        async function scanDir(dir: string) {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    await scanDir(fullPath);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        }

        await scanDir(folder);
        return files;
    }

    /**
     * Check if a file should be treated as text for variable substitution
     */
    private static isTextFile(filePath: string): boolean {
        const textExtensions = [
            '.md', '.markdown',
            '.txt', '.text',
            '.html', '.htm',
            '.css', '.scss', '.less',
            '.js', '.ts', '.jsx', '.tsx',
            '.json', '.yaml', '.yml',
            '.xml', '.svg',
            '.sh', '.bash', '.zsh',
            '.py', '.rb', '.pl',
            '.java', '.c', '.cpp', '.h', '.hpp',
            '.cs', '.go', '.rs', '.swift',
            '.sql',
            '.env', '.ini', '.conf', '.config',
            '.gitignore', '.editorconfig'
        ];

        const ext = path.extname(filePath).toLowerCase();
        return textExtensions.includes(ext);
    }

    /**
     * Process a template's content (template.md body) with variable substitution
     */
    public static processTemplateContent(
        content: string,
        variables: Record<string, string | number>,
        variableDefinitions?: TemplateVariable[]
    ): string {
        return VariableProcessor.substitute(content, variables, variableDefinitions);
    }
}
