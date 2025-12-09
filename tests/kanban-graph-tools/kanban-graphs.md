---

kanban-plugin: board

---

## PlantUML Diagram Tests
- [ ] Test 1: Simple Sequence Diagram
  ```plantuml
  Alice -> Bob: Authentication Request
  Bob -> Alice: Authentication Response
  ```

- [ ] Test 2: Class Diagram

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
  

- [ ] Test 3: Activity Diagram
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

- [ ] Test 4: Component Diagram
  ```plantuml
  [Frontend] --> [Markdown Renderer]
  [Markdown Renderer] --> [PlantUML.js]
  [PlantUML.js] --> [WASM Engine]
  [Frontend] --> [Backend]
  [Backend] --> [File System]
  ```

- [ ] Test 5: State Diagram
  ```plantuml
  [*] --> Placeholder
  Placeholder --> Rendering: Queue Processing
  Rendering --> Rendered: SVG Ready
  Rendering --> Error: Render Failed
  Rendered --> [*]
  Error --> [*]
  ```

- [ ] Expected Behavior
  1. All diagrams should render with a brief placeholder flash
  2. Each diagram should have a "💾 Convert to SVG" button
  3. Clicking the button should:
    - Create `Media-test-plantuml/` folder
    - Save SVG file as `plantuml-{timestamp}.svg`
    - Comment out PlantUML code
    - Replace with `![PlantUML Diagram](Media-test-plantuml/plantuml-{timestamp}.svg)`
    - Reload the file
  4. Second render should be instant (cache hit)



## Mermaid Diagram Tests

- [ ] 
  This file tests various Mermaid diagram types for the Markdown Kanban extension.

- [ ] Test 1: Simple Flowchart
  ```mermaid
  graph TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Great!]
    B -->|No| D[Debug]
    D --> B
    C --> E[End]
  ```

- [ ] Test 2: Sequence Diagram
  ```mermaid
  sequenceDiagram
  participant Alice
  participant Bob
  Alice->>Bob: Hello Bob, how are you?
  Bob-->>Alice: Great! Thanks for asking!
  Alice->>Bob: Let's work together
  Bob-->>Alice: Sure!
  ```

- [ ]  Test 3: Class Diagram
  ```mermaid
  classDiagram
      class Animal {
          +String name
          +int age
          +makeSound()
      }
      class Dog {
          +String breed
          +bark()
      }
      class Cat {
          +String color
          +meow()
      }
      Animal <|-- Dog
      Animal <|-- Cat
  ```

- [ ] Test 4: State Diagram
  ```mermaid
  stateDiagram-v2
      [*] --> Idle
      Idle --> Running: Start
      Running --> Paused: Pause
      Paused --> Running: Resume
      Running --> Stopped: Stop
      Paused --> Stopped: Stop
      Stopped --> [*]
  ```

- [ ] Test 5: Entity Relationship Diagram
  ```mermaid
  erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE-ITEM : contains
      CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
      CUSTOMER {
          string name
          string email
      }
      ORDER {
          int orderNumber
          date orderDate
      }
  ```

- [ ] Test 6: Gantt Chart
  ```mermaid
  gantt
      title Project Timeline
      dateFormat YYYY-MM-DD
      section Planning
      Requirements    :a1, 2024-01-01, 7d
      Design          :a2, after a1, 5d
      section Development
      Backend         :a3, after a2, 10d
      Frontend        :a4, after a2, 8d
      section Testing
      Integration     :a5, after a3, 3d
      UAT             :a6, after a5, 2d
  ```

- [ ] Test 7: Pie Chart
  ```mermaid
  pie title Browser Usage
      "Chrome" : 58
      "Firefox" : 22
      "Safari" : 12
      "Edge" : 8
  ```

- [ ]  Test 8: Git Graph
  ```mermaid-disabled
  gitGraph
      commit
      commit
      branch develop
      checkout develop
      commit
      commit
      checkout main
      merge develop
      commit
      commit

  ```

  ![Mermaid Diagram](Media-kanban-graphs/mermaid-1765231704283.svg)
