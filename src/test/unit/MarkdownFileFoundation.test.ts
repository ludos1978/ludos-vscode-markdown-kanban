import { MarkdownFile } from '../../files/MarkdownFile';

describe('FOUNDATION-1: Path Normalization Tests', () => {
    describe('MarkdownFile.normalizeRelativePath()', () => {
        test('should convert to lowercase', () => {
            expect(MarkdownFile.normalizeRelativePath('Folder/File.md'))
                .toBe('folder/file.md');
            expect(MarkdownFile.normalizeRelativePath('ROOT/INCLUDE-3.MD'))
                .toBe('root/include-3.md');
        });

        test('should convert backslashes to forward slashes', () => {
            expect(MarkdownFile.normalizeRelativePath('Folder\\File.md'))
                .toBe('folder/file.md');
            expect(MarkdownFile.normalizeRelativePath('root\\include\\file.md'))
                .toBe('root/include/file.md');
        });

        test('should trim whitespace', () => {
            expect(MarkdownFile.normalizeRelativePath('  folder/file.md  '))
                .toBe('folder/file.md');
            expect(MarkdownFile.normalizeRelativePath('\tfolder/file.md\n'))
                .toBe('folder/file.md');
        });

        test('should handle mixed case and separators together', () => {
            expect(MarkdownFile.normalizeRelativePath('Root\\Include\\File.MD'))
                .toBe('root/include/file.md');
            expect(MarkdownFile.normalizeRelativePath('  Folder\\Sub-Folder/File.md  '))
                .toBe('folder/sub-folder/file.md');
        });

        test('should preserve ./ prefix (not removed)', () => {
            expect(MarkdownFile.normalizeRelativePath('./folder/file.md'))
                .toBe('./folder/file.md');
            expect(MarkdownFile.normalizeRelativePath('./File.md'))
                .toBe('./file.md');
        });

        test('should handle empty and null inputs', () => {
            expect(MarkdownFile.normalizeRelativePath('')).toBe('');
            expect(MarkdownFile.normalizeRelativePath(null as any)).toBe('');
            expect(MarkdownFile.normalizeRelativePath(undefined as any)).toBe('');
        });

        test('should handle path variations that should be equivalent', () => {
            const variations = [
                './root/root-include-3.md',
                'root/root-include-3.md',
                'Root/root-include-3.md',
                'root/Root-Include-3.md',
                'ROOT/ROOT-INCLUDE-3.MD',
                '  ./root/root-include-3.md  ',
                'root\\root-include-3.md',
            ];

            const expected = 'root/root-include-3.md';
            variations.forEach(path => {
                const normalized = MarkdownFile.normalizeRelativePath(path);
                // All should normalize to same path (with or without ./)
                expect(normalized === expected || normalized === './' + expected).toBe(true);
            });
        });
    });

    describe('MarkdownFile.isSameFile()', () => {
        test('should return true for identical paths', () => {
            expect(MarkdownFile.isSameFile('folder/file.md', 'folder/file.md')).toBe(true);
            expect(MarkdownFile.isSameFile('./folder/file.md', './folder/file.md')).toBe(true);
        });

        test('should return true for case-insensitive matches', () => {
            expect(MarkdownFile.isSameFile('Folder/File.md', 'folder/file.md')).toBe(true);
            expect(MarkdownFile.isSameFile('ROOT/FILE.MD', 'root/file.md')).toBe(true);
        });

        test('should return true regardless of separator type', () => {
            expect(MarkdownFile.isSameFile('folder\\file.md', 'folder/file.md')).toBe(true);
            expect(MarkdownFile.isSameFile('Folder\\File.md', 'folder/file.md')).toBe(true);
        });

        test('should return true with/without ./ prefix', () => {
            expect(MarkdownFile.isSameFile('./folder/file.md', 'folder/file.md')).toBe(true);
            expect(MarkdownFile.isSameFile('folder/file.md', './folder/file.md')).toBe(true);
        });

        test('should return false for different paths', () => {
            expect(MarkdownFile.isSameFile('folder/file1.md', 'folder/file2.md')).toBe(false);
            expect(MarkdownFile.isSameFile('folder1/file.md', 'folder2/file.md')).toBe(false);
        });

        test('should handle whitespace correctly', () => {
            expect(MarkdownFile.isSameFile('  folder/file.md  ', 'folder/file.md')).toBe(true);
            expect(MarkdownFile.isSameFile('folder/file.md', '  folder/file.md  ')).toBe(true);
        });

        test('should verify path variations from test files', () => {
            // These are the actual variations from tests/kanban-include-tests/
            expect(MarkdownFile.isSameFile('root/root-include-3.md', 'Root/root-include-3.md')).toBe(true);
            expect(MarkdownFile.isSameFile('./root/root-include-3.md', 'root/root-include-3.md')).toBe(true);
            expect(MarkdownFile.isSameFile('root\\root-include-3.md', 'root/root-include-3.md')).toBe(true);
        });
    });

    describe('Registry Key Consistency', () => {
        test('should produce consistent keys for map/set operations', () => {
            // Simulate MarkdownFileRegistry usage
            const testPaths = [
                './root/root-include-3.md',
                'root/root-include-3.md',
                'Root/ROOT-INCLUDE-3.MD',
            ];

            const keys = testPaths.map(p => MarkdownFile.normalizeRelativePath(p));

            // All variations should produce keys that are considered equal
            // (accounting for ./ prefix difference)
            const baseKey = keys[0].replace(/^\.\//, '');
            keys.forEach(key => {
                const normalizedKey = key.replace(/^\.\//, '');
                expect(normalizedKey).toBe(baseKey);
            });
        });

        test('should prevent duplicate registry entries', () => {
            const registry = new Map<string, { path: string }>();
            const paths = [
                'root/include.md',
                'Root/Include.md',
                'root\\include.md',
                './root/include.md',
            ];

            paths.forEach(path => {
                const key = MarkdownFile.normalizeRelativePath(path).replace(/^\.\//, '');
                registry.set(key, { path });
            });

            // Should only have 1 entry, not 4
            expect(registry.size).toBe(1);
        });
    });
});

describe('FOUNDATION-2: Cancellation System Tests', () => {
    // Note: These tests verify the cancellation logic concept
    // Full integration tests require actual MarkdownFile instances

    describe('Sequence Counter Pattern', () => {
        test('should detect operation cancellation', () => {
            let currentSequence = 0;

            // Simulate _startNewReload()
            const startReload = (): number => {
                currentSequence++;
                return currentSequence;
            };

            // Simulate _checkReloadCancelled()
            const checkCancelled = (mySequence: number): boolean => {
                return mySequence !== currentSequence;
            };

            // Operation 1 starts
            const op1 = startReload(); // op1 = 1, current = 1
            expect(checkCancelled(op1)).toBe(false); // Not cancelled

            // Operation 2 starts (cancels op1)
            const op2 = startReload(); // op2 = 2, current = 2
            expect(checkCancelled(op1)).toBe(true);  // op1 cancelled
            expect(checkCancelled(op2)).toBe(false); // op2 not cancelled

            // Operation 3 starts (cancels op2)
            const op3 = startReload(); // op3 = 3, current = 3
            expect(checkCancelled(op1)).toBe(true);  // op1 still cancelled
            expect(checkCancelled(op2)).toBe(true);  // op2 now cancelled
            expect(checkCancelled(op3)).toBe(false); // op3 not cancelled
        });

        test('should handle rapid sequence of operations', () => {
            let currentSequence = 0;

            const startReload = (): number => {
                currentSequence++;
                return currentSequence;
            };

            const checkCancelled = (mySequence: number): boolean => {
                return mySequence !== currentSequence;
            };

            // Start 10 operations rapidly
            const operations: number[] = [];
            for (let i = 0; i < 10; i++) {
                operations.push(startReload());
            }

            // Only the last operation should not be cancelled
            operations.forEach((seq, index) => {
                if (index === operations.length - 1) {
                    expect(checkCancelled(seq)).toBe(false); // Last one succeeds
                } else {
                    expect(checkCancelled(seq)).toBe(true);  // All others cancelled
                }
            });
        });

        test('should prevent stale operations from completing', () => {
            let currentSequence = 0;
            let completedOperations: number[] = [];

            const startReload = (): number => {
                currentSequence++;
                return currentSequence;
            };

            const checkCancelled = (mySequence: number): boolean => {
                return mySequence !== currentSequence;
            };

            const completeReload = (mySequence: number): void => {
                if (!checkCancelled(mySequence)) {
                    completedOperations.push(mySequence);
                }
            };

            // Scenario: A → B → C rapid switching
            const opA = startReload(); // 1
            const opB = startReload(); // 2
            const opC = startReload(); // 3

            // Try to complete all (simulating async operations finishing)
            completeReload(opA);
            completeReload(opB);
            completeReload(opC);

            // Only C should have completed
            expect(completedOperations).toEqual([3]);
            expect(completedOperations).not.toContain(1);
            expect(completedOperations).not.toContain(2);
        });
    });
});
