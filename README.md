# Ludos Kanban Editor

This is a feature packed kanban editor that runs as an visual studio code editor extension.

I started this project to create and maintain lecture presentations for my university lectures. As i have been using marp (markdown based presentation tool) several years, and my structure and plugins got more and more complex i wanted to simplify my work environment. I have been using vscode because it's an versatile editor, has lots of plugins, integrates visual editors and allows moving, renaming files within the workspaces. I have started to create and manage new lectures and i found no good tool to create an extensive research storage with a good overview that is local first and doesnt need any subscription (i would never use a subscription based tool that can lock in my data).

This markdown editor contains to many features. 
- Foremost it's managing columns and tasks. 
- But you can organize columns as you want into stacks, into multiple rows. 
- You can fold them, you can make theyr headers sticky (so you can move content into them even outside the view.) . 
- It has an extensive layout system to customize the viewport with some reasonable defaults. 
- It has drag & drop features (from desktop with copy, from clipboard to create files from binary data or direct links). 
- It can embed images (regular image formats, but also excalidraw, drawio, mermaid, plantuml and pdf), videos (mp4, only some audio formats), other markdown files and links. 
- It can export with marp to create live-presentations, pdf-handouts and also editable pptx (an alpha feature of marp), presentations can in realtime update on kanban board modifications. 
- It can also pack all or parts of the kanban into data into a single folder including media.
- It has a extensive Tag system with labels, colors, person and automatic sorting features.

---

To use it, install the vsix into the visual studio code editor in the extensions by using the breadcrumbs / burger menu on the top right and select "install from vsix".

For some features you will need to install other addons as well:
- marp
- excalidraw
- drawio
- mermaid
- plantuml
- pdf

(detailed explanation still missing, some require vscode extensions, some require a command line tool to convert)

---

## Markdown features

---:
Column 1
:--:
Column 2
:---

;; comment 

[comment](/path/to/file "label")
[[markdown-file-link]]
<https://url.link.com>

comment[^com]

[^com]: some explanation

comment^[comment]

> indented note

```mermaid
```

```plantuml
```

- one (normal dotted list)
* two (normal dotted list, incremental dispaly in slide)
+ tree (no dot, incremental display in slide)

  indented for styles

==highlight==

^^sup^^ __sub__ ~~striketrough~~
*as well* **as the normal styles**

---

## Tag features

### Tags

additional groups can be added in the config

a tag is anything starting with # followed by any text and separated by a space.

#1.1 #green

tags are used to save some of the special settings of the kanban such as #row{number} #stack (so a column is stacked below the last non #stack column)




---

Keyboard Shortcuts:
- use vscode keyboard shortcuts to paste content ( i recommend to add --: :--: and :--- as shortcuts)
- paste cmd+shift+v ctrl+shift+v to paste content with link detection
- drag & drop with shift to embed in the kanban
  - will detect files and < 10mb copy to a {filename}-Media folder

---


Its made to mimic the functionality of a obsidian markdown editor which allows data handling and link management in kanban format. Using the tags it's more versatile. It should be data compatible with the Kanban Obsidian Markdown format from https://github.com/mgmeyers/obsidian-kanban .

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

Use comparison operators with `day` to gather cards relative to today. The `day` property represents the number of days from today (negative = past, positive = future).

```markdown
## Past Due ?.day<0
## Today ?.day=0
## Tomorrow ?.day=1
## Next 7 Days ?.day<7
## Next 3 Days ?.day>0&day<4
## Past Week ?.day>-7&day<0
```

| Expression | Description |
|------------|-------------|
| `?.day<0` | Cards with dates before today (overdue) |
| `?.day=0` | Cards with today's date |
| `?.day>0` | Cards with future dates |
| `?.day=1` | Cards with tomorrow's date |
| `?.day<7` | Cards within the next 7 days (including today) |
| `?.day>0&day<4` | Cards 1-3 days from now (tomorrow to 3 days out) |
| `?.day>-7&day<0` | Cards from the past 7 days (not including today) |
| `?.day>-7&day<7` | Cards within ±7 days of today |

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
