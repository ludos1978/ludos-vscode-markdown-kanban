# Kanban Search Sidebar Panel

## Feature Summary

Add a VS Code sidebar panel for searching the kanban board with two modes:
1. **Find Broken Elements** - Detect missing images, includes, links, media, diagrams
2. **Text Search** - Search for text across column titles, task titles, and descriptions

Click a result to navigate/scroll to and highlight that element on the board.

## Architecture

**Approach: WebviewViewProvider** (like VS Code's built-in Search panel)
- Full control over search UI with mode toggle, search input, and styled results
- Persists in sidebar across sessions
- Communicates with active kanban panel via message passing

## New Files to Create

| File | Purpose |
|------|---------|
| `src/kanbanSearchProvider.ts` | WebviewViewProvider for sidebar panel |
| `src/services/BoardContentScanner.ts` | Extract embedded elements from board content |
| `src/html/searchPanel.html` | HTML template for search sidebar |
| `src/html/searchPanel.css` | Styles for search sidebar |
| `src/html/searchPanel.js` | Frontend JavaScript for sidebar |

## Files to Modify

| File | Changes |
|------|---------|
| `package.json` | Add webview view contribution, commands |
| `src/extension.ts` | Register KanbanSearchProvider |
| `src/core/bridge/MessageTypes.ts` | Add search-related message types |
| `src/html/webview.js` | Add scrollToElement handler with highlight |
| `src/html/webview.css` | Add highlight animation styles |

## Implementation Phases

### Phase 1: Infrastructure

**1.1 Update package.json**
```json
{
  "contributes": {
    "views": {
      "kanbanBoards": [
        { "id": "kanbanBoardsSidebar", "name": "Kanban Boards" },
        { "type": "webview", "id": "kanbanSearch", "name": "Kanban Search" }
      ]
    },
    "commands": [
      { "command": "markdown-kanban.search.findBroken", "title": "Find Broken Elements" },
      { "command": "markdown-kanban.search.searchText", "title": "Search Board Content" }
    ]
  }
}
```

**1.2 Create BoardContentScanner.ts**
- Extract all embedded elements using existing regex patterns from `regexPatterns.ts`
- Reuse `MediaTracker.extractMediaReferences()` pattern for images/media
- Parse `!!!include(path)!!!` patterns for includes
- Parse markdown links `[text](path)` for links
- Check file extensions for diagrams (.drawio, .excalidraw)
- Return elements with location info (columnId, taskId, field)

**1.3 Add Message Types**
```typescript
// Sidebar -> Backend
interface SearchBrokenElementsMessage { type: 'searchBrokenElements' }
interface SearchTextMessage { type: 'searchText'; query: string }
interface NavigateToElementMessage {
  type: 'navigateToElement';
  columnId: string;
  taskId?: string;
  elementPath?: string;
}

// Backend -> Sidebar
interface SearchResultsMessage {
  type: 'searchResults';
  results: SearchResult[];
  searchType: 'broken' | 'text';
}

// Backend -> Main Webview
interface ScrollToElementMessage {
  type: 'scrollToElement';
  columnId: string;
  taskId?: string;
  highlight: boolean;
}
```

### Phase 2: Sidebar Provider

**2.1 Create KanbanSearchProvider.ts**
```typescript
export class KanbanSearchProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'kanbanSearch';

  resolveWebviewView(webviewView: vscode.WebviewView) {
    // Set up webview with HTML/CSS/JS
    // Handle messages from sidebar
  }

  handleBrokenElementsSearch() {
    // Get board from active panel
    // Extract all elements with BoardContentScanner
    // Check existence with fs.existsSync() or fileManager.resolveFilePath()
    // Also check columns/tasks with includeError === true
    // Send results to sidebar
  }

  handleTextSearch(query: string) {
    // Search column titles, task titles, descriptions
    // Case-insensitive search with context
    // Send results to sidebar
  }

  handleNavigateToElement(result: SearchResult) {
    // Send scrollToElement message to main webview
  }
}
```

**2.2 Create Search Panel UI (HTML/CSS/JS)**
- Mode toggle: "Broken Elements" | "Text Search"
- Search input (visible in text mode)
- "Find Broken" button (visible in broken mode)
- Results tree grouped by type (Images, Includes, Links, etc.)
- Each result shows: icon, path/text, location (column > task)
- Click handler sends navigateToElement message

### Phase 3: Navigation & Highlighting

**3.1 Add scrollToElement handler in webview.js**
```javascript
case 'scrollToElement':
  scrollToAndHighlight(msg.columnId, msg.taskId, msg.elementPath);
  break;

function scrollToAndHighlight(columnId, taskId, elementPath) {
  // Find element: column header, task card, or specific element within
  // Scroll into view with smooth behavior
  // Add highlight class for animation
  // Remove highlight after 2 seconds
}
```

**3.2 Add highlight styles in webview.css**
```css
.search-highlight {
  animation: highlight-pulse 2s ease-out;
}
@keyframes highlight-pulse {
  0% { box-shadow: 0 0 0 4px var(--vscode-focusBorder); }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

### Phase 4: Integration

**4.1 Register provider in extension.ts**
```typescript
const searchProvider = new KanbanSearchProvider(context.extensionUri);
context.subscriptions.push(
  vscode.window.registerWebviewViewProvider(
    KanbanSearchProvider.viewType,
    searchProvider
  )
);
```

**4.2 Connect to active panel**
- Use `KanbanWebviewPanel.currentPanel` to get active kanban
- Handle case when no panel is open (show message in sidebar)
- Refresh results when board changes (optional enhancement)

## Element Detection Logic

| Element Type | Detection Pattern | Existence Check |
|--------------|-------------------|-----------------|
| Images | `!\[...\](path)` and `<img src="path">` | `fs.existsSync(resolved)` |
| Includes | `!!!include(path)!!!` | `column.includeError` or `task.includeError` |
| Links | `[text](path)` (non-http) | `fileManager.resolveFilePath().exists` |
| Media | `<video>`, `<audio>` src | `fs.existsSync(resolved)` |
| Diagrams | `.drawio`, `.excalidraw` refs | `fs.existsSync(resolved)` |

## Search Result Data Structure

```typescript
interface SearchResult {
  type: 'image' | 'include' | 'link' | 'media' | 'diagram' | 'text';
  path?: string;           // File path for element
  matchText?: string;      // Matched text for text search
  context?: string;        // Surrounding text for context
  location: {
    columnId: string;
    columnTitle: string;
    taskId?: string;
    taskTitle?: string;
    field: 'columnTitle' | 'taskTitle' | 'description';
  };
  exists: boolean;         // For broken detection
}
```

## Key Dependencies

- `src/shared/regexPatterns.ts` - Reuse MarkdownPatterns for extraction
- `src/services/MediaTracker.ts` - Reference for media extraction pattern
- `src/fileManager.ts` - Use resolveFilePath() for existence checking
- `src/kanbanSidebarProvider.ts` - Reference for view registration pattern

## Expected Outcomes

1. New "Kanban Search" view appears in sidebar under "Kanban Boards"
2. Toggle between "Find Broken" and "Text Search" modes
3. Broken elements scan shows all missing files grouped by type
4. Text search finds matches across entire board content
5. Clicking result scrolls to and highlights element on board
6. Works with currently active kanban panel
