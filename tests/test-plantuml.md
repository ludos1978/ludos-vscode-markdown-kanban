---

kanban-plugin: board

---

## Test 1: Simple Sequence Diagram
- [ ] title
  ```plantuml
  Alice -> Bob: Authentication Request
  Bob --> Alice: Authentication Response
  ```

## Test 2: Class Diagram
- [ ] title
  ```plantuml
  class User {
    +name: string
    +email: string
    +login()
    +logout()
  }
  
  class Admin {
    +permissions: string[]
    +grantAccess()
  }
  
  User <|-- Admin
  ```

## Test 3: Activity Diagram
- [ ] title
  ```plantuml
  start
  :Read markdown file;
  if (Contains PlantUML?) then (yes)
    :Render PlantUML diagrams;
    :Show Convert button;
  else (no)
    :Skip PlantUML processing;
  endif
  :Display markdown;
  stop
  ```

## Test 4: Component Diagram
- [ ] title
  ```plantuml
  [Frontend] --> [Markdown Renderer]
  [Markdown Renderer] --> [PlantUML.js]
  [PlantUML.js] --> [WASM Engine]
  [Frontend] --> [Backend]
  [Backend] --> [File System]
  ```

## Test 5: State Diagram
- [ ] title
  ```plantuml
  [*] --> Placeholder
  Placeholder --> Rendering: Queue Processing
  Rendering --> Rendered: SVG Ready
  Rendering --> Error: Render Failed
  Rendered --> [*]
  Error --> [*]
  ```

## Expected Behavior
- [ ] title
  1. All diagrams should render with a brief placeholder flash
  2. Each diagram should have a "💾 Convert to SVG" button
  3. Clicking the button should:
    - Create `Media-test-plantuml/` folder
    - Save SVG file as `plantuml-{timestamp}.svg`
    - Comment out PlantUML code
    - Replace with `![PlantUML Diagram](Media-test-plantuml/plantuml-{timestamp}.svg)`
    - Reload the file
  4. Second render should be instant (cache hit)


