## Presentation format generation

| # | Function | Method | Separator Before | Separator After | Newlines |
|---|----------|--------|------------------|-----------------|----------|
| 1 | `boardToPresentation()` | join | `\n---\n` | N/A | 1-1 |
| 2 | `convertToPresentationFormat()` | join | `\n---\n` | N/A | 1-1 |
| 3 | `kanbanToPresentation()` | join | `\n---\n` | N/A | 1-1 |
| 4 | `tasksToPresentation()` | join | `\n\n---\n` | N/A | **2-1** ⚠️ |
| 5 | `kanbanToMarp()` | concat | N/A | `\n---\n\n` OR `---\n\n` | varies |
| 6 | `convertMarkdownToMarp()` | concat | N/A | `\n---\n\n` | 1-2 |
| 7 | `columnToSlides()` | concat | N/A | `\n---\n\n` OR `---\n\n` | varies |


// - ExportService.boardToPresentation
// - ExportService.convertToPresentationFormat
// - FormatConverter.kanbanToPresentation
// - PresentationParser.tasksToPresentation
// - MarpConverter.convertMarkdownToMarp

  Using .join() Method:

  1. ✅ ExportService.boardToPresentation() - Separator: \n---\n
  2. ✅ ExportService.convertToPresentationFormat() - Separator: \n---\n
  3. ✅ FormatConverter.kanbanToPresentation() - Separator: \n---\n
  4. ⚠️ PresentationParser.tasksToPresentation() - Separator: \n\n---\n
  (INCONSISTENT!)

  Using String Concatenation:

  5. ✅ MarpConverter.kanbanToMarp() - Appends via columnToSlides()
  6. ✅ MarpConverter.convertMarkdownToMarp() - Appends \n---\n\n
  7. ✅ MarpConverter.columnToSlides() - Helper, appends ---\n\n and
  \n---\n\n
