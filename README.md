# Kanban Markdown for Visual Studio Code & VSCodium

A VS Code extension that allows editing Markdown files as an interactive Kanban board. Its made to mimic the functionality of a obsidian markdown editor which allows data handling and link management in kanban format. Using the tags it's more versatile. It should be data compatible with the Kanban Obsidian Markdown format from https://github.com/mgmeyers/obsidian-kanban .

## A word of caution

The project is in active use by me. But i have encountered rare data storage and loading problems. But it might habe been just one intermediate version that modified some cards (the last card or the indention of content). So dont handle very important data with it yet. State in 2025-Sept-03.

## For Developers

This extension uses a **state machine architecture** for handling all file changes. Before contributing:

- **Architecture Overview**: Read [ARCHITECTURE.md](ARCHITECTURE.md) for system design and patterns
- **State Machine Design**: See [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) for complete state flow specification
- **Migration Guide**: Follow [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) when modifying change handling
- **Development Rules**: Consult [AGENT.md](AGENT.md) for coding guidelines and best practices
- **Function Catalog**: Check [agent/FUNCTIONS.md](agent/FUNCTIONS.md) before adding new functions

**Key Principle**: All file changes must go through `ChangeStateMachine.processChange()` - never create direct handlers.

## Features

### Basic Features

- **Markdown Parsing**: Automatically parses task lists from Markdown files.
- **Kanban View**: Displays tasks in a Kanban board format with multi-column layout.
- **Drag & Drop**: Supports dragging and dropping tasks between different columns. Proper movement and displaying of card and column movements. however they seem to be placed on top/bottom incoherently. Shift to drag from external (will copy the file to the {filename}-Media folder if linking is impossible)
- **Real-time Sync**: Ensures real-time, two-way synchronization between the Kanban board and the Markdown file.
- **Undo & Redo**
- **Image & File dropping** creates new cards
- **Links** embeds images and allows links to other files. Path resolution is done relatively to file, secondly relatively to the opened workspace folders or absolute depending on the path.
- **Tags** that color the columns and cards (if used in the title)
- **Folding** of cards, columns.
- **Image Pasting** paste an image using meta+shift+v to create a link direclty from an path or an copyied image data.


### Supported Formats for Embeddings

\[\]\(\) or \!\[\]\(\) for direct preview
- Images
- Videos (only some mp4 audio formats are supported in vscode)
- draw.io
- excalidraw

\`\`\`mermaid
\`\`\`

#### To use draw.io

  Option 1: Install via Homebrew (Recommended)

  brew install --cask drawio
  This creates a drawio CLI command in your PATH.

  Option 2: Add CLI to PATH Manually

  If you want to keep using the installed app, you need to make the CLI
  accessible. However, this may still not work because the .app bundle needs a display server.

  Option 3: Use drawio-desktop CLI

  Download the CLI-capable version from:
  https://github.com/jgraph/drawio-desktop/releases



### Required Format

Requires a YAML header with 'kanban-plugin: board'
Add a H2 Title (Boards) and Tasks (Cards) below it.

```
---

kanban-plugin: board

---

## Title of Board
- [ ] Card
  Text of Card
- [ ] Next Card
  Content of Card
```

### Installation

1. Download the vsix and install

### How to Use

Press the "Kanban" button on the top right.
Add columns using the buttons.
Add cards using the buttons.

### Open Issues

Drag & Dropping Files from outside the editor doesnt create a correct path. Caused by https://github.com/microsoft/vscode-discussions/discussions/1663

### Screenshot

![](./imgs/screenshot-20250901.png)


## Tag System

The Kanban board uses a flexible tag system with four distinct tag types, each with its own prefix character. Tags capture everything after the prefix until whitespace (space, tab, or newline).

### Tag Types Overview

| Prefix | Type | Description | Examples |
|--------|------|-------------|----------|
| `#` | Hash tags | Regular tags for categorization | `#todo`, `#urgent`, `#feature` |
| `@` | Person tags | Assign people/mentions | `@john`, `@team-alpha` |
| `.` | Temporal tags | Dates, times, weeks, weekdays | `.2025.01.28`, `.w15`, `.mon` |
| `?` | Query tags | Gather cards matching criteria | `?#todo`, `?@reto`, `?.today` |

---

## Hash Tags (`#`)

Regular tags for categorization, status, and layout control.

### Basic Tags

```markdown
- [ ] Review code #urgent #frontend
- [ ] Write tests #todo #backend
```

### Priority & State Tags

```markdown
#high #medium #low #urgent
#todo #doing #done #blocked #waiting
```

### Layout Tags

| Tag | Description | Example |
|-----|-------------|---------|
| `#row2` | Place column in row 2 | `## Backlog #row2` |
| `#span2` | Column spans 2 units wide | `## Main #span2` |
| `#stack` | Stack columns horizontally | `## Week 1 #stack` |
| `#sticky` | Prevent card from being moved during sorting | `- [ ] Important #sticky` |
| `#fold` | Collapse column/card by default | `## Archive #fold` |
| `#archive` | Mark as archived | `## Done #archive` |
| `#hidden` | Hide from view | `## Hidden #hidden` |
| `#include:path` | Include content from another file | `## Tasks #include:./tasks.md` |

### Numeric Index Tags

For ordering columns/cards:

```markdown
## #1 First Column
## #2 Second Column
## #1.1 Sub-section
## #3.1.4 Deep nesting
```

---

## Person Tags (`@`)

Assign people or teams to cards. Everything after `@` until whitespace is the person/team name.

```markdown
- [ ] Review PR @reto
- [ ] Team meeting @team-alpha
- [ ] Collaboration @johnson&smith
```

---

## Temporal Tags (`.`)

Date and time tags for scheduling. The `.` prefix is followed by various time formats.

### Date Formats

```markdown
.2025.01.28      # Date with dots
.2025-01-28      # Date with dashes
.2025/01/28      # Date with slashes
```

### Week Tags

```markdown
.w15             # Week 15 (current year)
.W15             # Case insensitive
.2025.w15        # Week 15 of 2025
.2025-w15        # Alternative format
```

### Weekday Tags

```markdown
.mon .monday     # Monday
.tue .tuesday    # Tuesday
.wed .wednesday  # Wednesday
.thu .thursday   # Thursday
.fri .friday     # Friday
.sat .saturday   # Saturday
.sun .sunday     # Sunday
```

### Time Tags

```markdown
.15:30           # 24-hour format
.9am             # 12-hour format
.10pm            # Evening
.22:00           # 24-hour evening
```

### Time Slot Tags

```markdown
.9am-5pm         # Work hours
.15:30-17:00     # Meeting slot
.10am-12pm       # Morning block
```

### Temporal Highlighting

Cards and columns with temporal tags matching the current date/time are automatically highlighted (e.g., today's date, current week, current weekday).

---

## Query Tags (`?`)

Query tags gather/collect cards matching specific criteria into a column. The `?` is followed by a tag type prefix (`#`, `@`, or `.`) and the query content.

### Basic Syntax

```markdown
## Reto's Tasks ?@reto
## Todo Items ?#todo
## Today ?.today
```

### Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `&` | AND - all conditions must match | `?#urgent&important` |
| `\|` | OR - any condition matches | `?@reto\|bruno` |
| `!` | NOT - exclude matches | `?#todo!done` |

### Query Examples

#### Gather by Person

```markdown
## Reto's Tasks ?@reto
## Team Work ?@reto|bruno|anna
```

#### Gather by Hash Tag

```markdown
## Urgent ?#urgent
## Features ?#feature&frontend
## Not Done ?#todo!completed
```

#### Gather by Temporal

```markdown
## Today ?.today
## Today (alternate) ?.day=0
## This Week ?.w15
## Monday Tasks ?.mon
```

#### Gather by Day Offset

Use comparison operators with `day` to gather cards relative to today:

```markdown
## Past Due ?.day<0
## Today ?.day=0
## Tomorrow ?.day=1
## Next 7 Days ?.day<7
## This Week ?.0<day&day<7
```

| Expression | Description |
|------------|-------------|
| `?.day<0` | Cards with dates before today (overdue) |
| `?.day=0` | Cards with today's date |
| `?.day>0` | Cards with future dates |
| `?.day<7` | Cards within the next 7 days |
| `?.day>-7&day<0` | Cards from the past 7 days |

#### Combined Queries

A column can have multiple query tags:

```markdown
## Reto This Week ?@reto ?.w15
```

---

## Legacy Gather System

The legacy `#gather_` syntax is still supported for backward compatibility:

```markdown
## To Do #gather_Reto
## This Week #gather_day<7
```

### Legacy Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `&` | AND | `#gather_Reto&day<3` |
| `\|` | OR | `#gather_Reto\|Anita` |
| `=` | EQUAL | `#gather_day=0` |
| `!=` | NOT EQUAL | `#gather_weekday!=sat` |
| `<` | LESS THAN | `#gather_day<7` |
| `>` | GREATER THAN | `#gather_day>0` |

### Legacy Date Properties

| Property | Description | Values |
|----------|-------------|--------|
| `day` | Days from today | -2, -1, 0, 1, 2, ... |
| `weekday` | Day name | mon, tue, wed, ... |
| `weekdaynum` | Day number | 1 (Mon) to 7 (Sun) |
| `month` | Month name | jan, feb, mar, ... |
| `monthnum` | Month number | 1 to 12 |

### #ungathered

Collects all cards that didn't match any gather rule:

```markdown
## Backlog #ungathered
```

---

## Sorting Tags

### Sort Within Column

```markdown
## Tasks #sort-bydate
## People #sort-byname
```

### Sorting Process

1. **Sticky cards** (`#sticky`) stay in place
2. **Query/gather rules** processed left to right
3. **First match wins** - card moves to matching column
4. **#ungathered** processes remaining tagged cards
5. **Sort rules** applied within each column

---

## Complete Example

```markdown
---
kanban-plugin: board
---

## Today ?.today #sort-bydate
- [ ] Morning standup .9am @team
- [ ] Code review #urgent @reto

## This Week ?.w48
- [ ] Feature implementation #feature .fri
- [ ] Documentation #docs .thu

## Reto ?@reto
- [ ] Bug fix #bug
- [ ] Testing #qa

## Backlog #ungathered #fold
- [ ] Future task #idea
```

---

## Tips

1. **Order matters**: Place columns with specific queries first
2. **First match wins**: Cards stop checking after first match
3. **Use #sticky**: Keep important cards in place during sorting
4. **Temporal highlighting**: Current date/week/day cards are highlighted
5. **Combine tags**: Use multiple tag types on same card/column

---

## marp

put own themes into one of these folders in your workspace.

.marp/themes/
themes/
_themes/
assets/themes/
