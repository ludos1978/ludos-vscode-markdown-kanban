- [ ] when clicking the version number in the burger menu, the code should switch to debug mode. where all debug logs are activated. also the version number should add (debug) after the number while it's active.

- [ ] tab should not switch between field, but alt+enter. 

- [ ] check the code for any timeout calls, i dont want timeout used!

- [ ] could we include pandoc and it's conversion methods into the kanban exporter? are there any other worthwile exporters or converters that use markdown as basic format?

- [x] why is the vscode search feature so much faster then our search feature. can we use the vsocde search api?

- [ ] if we replace links by using "search for file" and do multiple replacements at once, i want all of them undone in one step. not individual ones.

- [x] dont strike trough the columninclude, rather replace it by the new one. actually do that for all replacements, we drop the strike trough functionality and remove it completely. we only put in the new link from now on. we must make sure the undo works properly, even for multiple replacements!

- [ ] remove the "open file" button, but keep the function if it's still used by the board to open the markdown. othervise remove the function as well.

- [ ] analyze the html structure and make a detailed hierarchy structure in a agent/HTML-STRUCTURE.md with structural documentation. i can provide a html of a typical presentation if you need. we will use it to simplify the css afterwards. so include any relevant data needed for a css analysation.

- [ ] do another round of cleanup analysis and refactoring. what could be improved to make the code simpler and more structured, better readable and mainainable. focus on simplicity over complexity. ultrathink . check the ts, js, html and css! start with the most complex refactorings first and then do the simpler ones. think about renaming functions to match the functionality.

- [ ] when using the search for file, could we add a checkbox to the dialogue searching for the alternative files, which would allow replacing all paths that have the same error. so it searches for the filename, the user selects the file. the path element is taken from the broken file (broken-path) and the newly found file (new-path). and all occurances of the broken-path are replaced by the new- path (if the filename exists under the new path). if we check the checkbox, then search trough the kanban board for the same (broken-path) and show the number of files that have this path. also search for the filenames in the new-path, which contain the same filename as the files in the kanban board with the broken-path. 

- [ ] the excalidraw converter doesnt show embedded images and manually drawn strokes. i need them to work!

- [ ] add a table editor that allows sorting of content by each category.

- [ ] in the marp presentation export the video playback plugin must be modified. It should automatically stop videos when the slide is changed (it can allways stop all videos in the presentation). Also it would be nice if we could have a start time and optional end time ./filename.mp4&start=40&end=60s

- [ ] on windows drag & dropping files into the columns doesnt create paths as it does with osx. does it handle c: and other paths equally as / paths?

- [ ] can this be integrated ? https://github.com/Skarlso/adventure-voter 

- [ ] would it be possible to take a screenshot of a webpage if a link is added to the board?

  1. Open Graph images (simplest) - Fetch og:image meta
  tags from URLs. Most websites provide preview images.
  No screenshot needed, just an HTTP fetch + HTML
  parsing.
  2. Puppeteer/Playwright (full screenshots) - Run
  headless browser in extension backend to capture
  actual screenshots. Heavier dependency (~100-400MB),
  slower, but gives real screenshots.

- [ ] #### Combined Queries

A column can have multiple query tags:

```markdown
- Reto This Week ?@reto ?.w15
```

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `&` | AND | `#gather_Reto&day<3` |
| `\|` | OR | `#gather_Reto\|Anita` |
| `=` | EQUAL | `#gather_day=0` |
| `!=` | NOT EQUAL | `#gather_weekday!=sat` |
| `<` | LESS THAN | `#gather_day<7` |
| `>` | GREATER THAN | `#gather_day>0` |

### Date Properties

| Property | Description | Values |
|----------|-------------|--------|
| `day` | Days from today | -2, -1, 0, 1, 2, ... |
| `weekday` | Day name | mon, tue, wed, ... |
| `weekdaynum` | Day number | 1 (Mon) to 7 (Sun) |
| `month` | Month name | jan, feb, mar, ... |
| `monthnum` | Month number | 1 to 12 |

### ?ungathered

Collects all cards that didn't match any gather rule:



- [x] add a feature to convert individual or multiple images-paths or referenced document-paths in any of the documents (main or included kanban baords) that allows converting from absolute to relative paths and from relative to absolute paths. each document should get a button on the top-right (an individual breadcrumbs menu), with the option to convert the path type. detect the path type and give the option to convert it to the other tyep. also add the feature to the "File States Overview" system where each (kanban or markdown) file can be individually modified from relative to absolute paths, have both options (convert all to relative paths and convert all to absolute paths). and add one button to convert the main file and all included files.

- [x] move the delete button from the "image not found hover" to the burger menu on the image.

- [x] gray out the option which is not applicable. a relatvie path should not be chageable to relative again.
- add an option to open the file or the path in the file explorer (finder) where the file is in!

- [x] when i delete the top column in a stack, the stack below it should have it's #stack tag removed. in all other cases there is no need to change anything

- [x] when initializing a file it still does not reload the file immediately after adding the required header.

- [x] found problems:
- when i modify a column that has tasks and i add a columninclude. it should be able to add the existing tasks into the included board (as these othervise get lost when the include is added). this was working before, but isnt anymore.
- when i modify the board, it sometimes allways immediately exits editing when i click a editable field, i cant modify the board anymore.
- when i have a save conflict and i save my changes as backup and load from external, a popup should show up with the backup file link to open.
- when dropping a task from the sources on the info header it doesnt do the positional highlight reliably. it maybe does it once, but not the second time i use that feature.

- [x] after copying a column as markdown. i'd like to be able to drop it as a new column with content out of the copyed content.
  - if the first task only is a title without a content. it will be used as column title.\
  - othervise the title of the column is empty\
  
  all other content is used to create tasks ( split by --- by the same mechanic as the column import funcitonality already uses)
  
  can we reuse the task creation functionality of the column include?

- [x] it seems as if the board is loaded twice, or at least the height calculation is reset again while loading the board initially. can you verify and analyze?

- [x] when i copy a task as markdown it doesnt copy the task, but the full board. The same problem is with the column. it should only copy the content as markdown (presentation) which the function is called from!

- [x] when pressing the save button in the fiel states overview it doesnt allways write the file. this is a force save, which writes the file no matter what any automatic system says!

- [x] when switching from one columninclude to another, it doesnt load the content if it's not already in the cache. alwayss immediately remove the old content after asking to save changed content. then emtpy the columns tasks, then fill up as soon as the data is available. verify the current order, make 3 suggestions how to fix the problem with quality rating. do not add new functions, fix the existing flow


- [x] did this about 30 times: do another round of cleanup analysis. what could be improved to make the code simpler and more structured, better readable and mainainable. focus on simplicity over complexity. ultrathink . repeat this until you find no major problems . ultrathink . check the ts, js, html and css!

- [x] The default layout presets are defined in _getLayoutPresetsConfiguration in KanbanWebviewPanel. i want all default configs in the configuration so the user can change them. nothing in the code. check for other default configuration values as well. there is the config and no values that replace the config if it's missing or overrides etc. never use "value = configvalue || someotherdefault;" print a warning or error, make sure the config is defined!


- [x] analyze what code design tempaltes would make sense to use in this project. analyze the high level requirements of the code and do a deep analysis of the current state and a optimal state would it have been done by an team of experts in software architecture that both make sure it's strucutred well, but also not overcomplicated!

- [x] can we highlight the lines where tags are within the task description as well? also 
work with the inheritance system we use. for that we should also support minutes. \
\
for example the task header might have:\
!15:00-16:00\
\
and the task contents might be\
\
!:15-:30 : highlighted between 15:15 to 15:30\
\
!:30-:45 : highlighted between 15:30 to 15:45 \
\
which would highlight the complete line with a right border as we do with the task. \
\
can you integrate that into the existing system? 

- [x] would it be possible to limit the display of active hours, days etc if the above
  timeslots (if they are added) are also active.\
  \
  so if the column has a !W49 tag, then the hourly tag !09:00-12:00 is only showing if
  it's Week 49. But if the column has no Weekly tag, the hourly tag shows allways.\
  \
  the order date/time would be: Year -> Month -> Week-Numer -> Day or Day-Number ->
  Hour/Timeframe\
  \
  The structure is: Column-Title -> Task-Title -> Task-Content\
  \
  if a higher order (for example Year) is in the higher structure (Column-Title), then a
  lower data/time (for example Time) on a lower structure below it is only highlighted
  when the higher order one is also active.\
  \
  make 3 suggestions how to implement this feature with a quality rating!

- [x] when dropping tasks on folded columns it should highlight it's border and be appended to the end of the column. the same applies if the task is dropped on a column but not in a valid position or on the header. this is currently working, but it doesnt highlight the border, it highlights some position in the top of the column.

- [x] if we drag a file into the kanban we check the media folder first. if a file that matches the criteries is found in the media folder (first check same filename and compare the has when also check all files for the first 1mb of the file combined with the filesize) :

to calculate the hash for files < 1mb use the hash, for larger files use the 1mb of t file and the filesize combined to create the hash.

keep the hashes and the last changed time in a .hash_cache file in the media folder. if t last changed date is modified, recalculate the hash for the file
- we give the user the option to open the media folder (copy it manually)
- or link the already existing file (if the file is found, as first option)
- or cancel

- [x] the drag & drop system can copy media into the media folder if the path to the file is not found. but when the media is very large this might crash the webview. in this case the user should be prompted for the action to take instead. check if the file is larger then 10mb and then ask the user to manually copy the file into the media folder or get a path to the file to paste!
  - COMPLETED 2025-12-05: Dialogue with hash-based matching. Uses partial hash (first 1MB + size) to detect existing files in media folder. Options: Link existing file (if found), Open media folder, Cancel. Hash cache stored in .hash_cache file with mtime tracking for efficient updates.

- [x] the drag & drop system is used by many components. dragging internally, draggin externally, for columns, for tasks. They can be dropped in different rows, stacks of columns and tasks into the columns themself. This system described its functionality. 

The system does not use any caching!

first we need to figure out on what row we are (vertical), then which stack (horizontal), then in which column (vertical), if we are moving a task we also need to check within the column for the correct position (vertical). use the positions of the elements directly, do not chache anything!

the row is split up into areas by the:
  kanban-container > kanban-board multi-row > kanban-row
when we determined the row, only check within this row for any further checks!

the vertical dividers between stacks are the:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack column-drop-zone-stack
when on top of one of those
- drop the column into the new stack. do not add a #stack tag to it. depending on the row add a row tag. 
- if a task is dropped here, we dont have a valid solution.

if over a:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack (without column-drop-zone-stack)
we should only check this stack for the right position

only check within the found kanban-column-stack!
- columns are stacked when there is more then one kanban-full-height-column in a kanban-column-stack
- if there is only one column in a kanban-column-stack it's a single column stack

if we are dragging a column: we need to use the middle of a column, which is defined by:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-header > the top of it
  +
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-footer > the bottom of it
  / 2
when above : the column should be placed above
when below : we need to check the next one until we find one that it's above
if there are none left, it's the last one.
to display the position place the marker in:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-margin
if it's the last position display it at the top of:
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > stack-bottom-drop-zone
if it's a column we have determined for the column position here. 

if a vertically folded column is dropped into a stack it must converted to be horizontally folded. also if a column is dropped into a stack with a vertically folded column, it must be converted to horizontally folded.

if the column is dropped as the first column in the stack dont add a stack tag, but add a stack tag to the column below. if the column is placed anywhere else in the stack then add a stack tag.

if we are dragging a tasks, then position must be further calculated using these two rules:
- determine the current column by checking if we are hovering over the column-title. if this is the case we can directly put the task into at the end of the column.
- then check if we are hovering over the "top of the column-header" and the "bottom of the column-footer" . 
only check it within the previously selected stack!
all further calculations are only done on this column!
when hovering over the footer or the header on a folded column, it must highlight the header and put the task as last position in the column.

iteratively go over each task-item in the column and break once you found one that the task is hovered over: 
  kanban-container > kanban-board multi-row > kanban-row > kanban-column-stack > kanban-full-height-column (collapsed-horizontal) > column-inner > column-content > tasks-container > task-item
if it's hovered above a gap, this is the position we want it to drop onto!

the task must be placed above, if above the mid. it should be placed below, if below the mid.
if no solution is found, drop it at the end of the column.

((( the position of the task is calculated by:
- if the task is dropped onto the column-title, column-header or column-footer, place it as the last task of the column! )))



- [x] ARCHITECTURE REFACTORING: Event-Driven Component System
  **Plan:** See `agent/ARCHITECTURE-REFACTORING-PLAN.md` for full details
  **Phase 1 Guide:** See `agent/PHASE1-EVENTBUS-IMPLEMENTATION.md`

  **Target Architecture:**
  ```
  KanbanPanelShell (~200 lines) - VS Code lifecycle only
       │
       ▼
  PanelEventBus (~400 lines) - typed events, middleware, correlation
       │
       ├── BoardStore (~350 lines) - state, selectors, undo/redo
       ├── FileCoordinator (~500 lines) - files, includes, conflicts
       ├── WebviewBridge (~400 lines) - messages, batching, req/res
       └── EditSession (~250 lines) - edit mode, checkpoints
  ```

  **Phases (14 sessions, ~40 hours total):**
  - [ ] Phase 1: PanelEventBus (foundation) - 2 sessions
  - [ ] Phase 2: BoardStore (state management) - 2 sessions
  - [ ] Phase 3: WebviewBridge (message routing) - 2 sessions
  - [ ] Phase 4: FileCoordinator (file operations) - 2 sessions
  - [ ] Phase 5: EditSession (undo/redo) - 2 sessions
  - [ ] Phase 6: KanbanPanelShell (final assembly) - 2 sessions
  - [ ] Phase 7: Testing & Documentation - 2 sessions

  **Quality Targets:** All components 95%+ quality rating
  **Risk:** Medium-High (core refactoring), mitigated by incremental migration

- [ ] I want to be able to add templates for columns. these should be markdown presentation style that create the content of a column with none or some tasks with default content when dragged into the scene. It should also allow a -Media folder with the same name that would be instantiated into the markdown-kanban when instantiated.

On instantiation the user is asked for a filename which is defined by default from the first line of the file where {kanbanfilename} is the filename of the main-board-markdown-file.

a template might look like:
"""
{kanbanfilename}-Homework

## Homework

==Requirements==

- ...

==Deliveries==

- ... 
"""

or 

"""
{kanbanfilename}-SemesterSchedule

## Semester Schedule

![]({thisfilename}-Schedule)
"""

- [x] if a column already has tasks and a !!!include()!!! is added to the column header the content gets removed when saving it. To prevent loosing data the user should be asked wether he wants to add the existing tasks to the included file or if it should be discarded.

- [x] currently when i modify a task which contains a drawio it regenerates the image every time, could we cache it somehow? maybe in a subfolder (drawio-cache) of the Media folder of the markdown "{filename}-Media" ? it should be individual for each file, so included files have the media cached in a {include-filename}-Media folder next to the include file.

- [x] do another round of code de-duplication! verify the complete code  structure. use the files in the agent folder to search for duplicates. analyze the data and code structure deeply, then suggest improvements you could work on. generate 3 solutions to solve the problem you found and rate  the quality. improve the quality of each solution until all are very high,  then pick the best solution or combine the solution to a final suggestion.  the quality must be above 95% to be allowed to continue working on it! then continue implementing the solution. ultrathink plan

- [x] "move to column" from a task burger menu doesnt work.

- [x] an #tag, @tags and .tags are only separated by spaces, tabs, newlines etc, not by any other character such as dots, commas, etc. 
  - #tags that start with a number are allways displayed as numbers in a badge (the system is already in place, but it doesnt accept 3.1.3 indexes)
  - @tags
    - can be @w13 : week 13
    - can be @mon or @monday : any weekdays
    - can be @10:30 : time in 24h mode, without am, pm it's allways 24h mode
    - can be @10pm : time in 12h mode
    - can be @10:30-12:00 : timeslot in 24h mode

    - the date and timeslots will be highlighted when they are active (already in place for dates)

- [x] include in the column header is still not reliably loading the file. also the enable include isnt working properly. i tested in this logfile: @logs/vscode-app-1763916142426.log 

- [x] Create a group of tags

  - #schedule
  - #planning
  - #preparation
  - #verify

  - #overview
  - #information
  - #presentation

  - #example
  - #tasks
  - #homework

  - #deliveries
  - #handouts
  - #references

- [x] in the column handling after a text change of a column header, it must check for #stack tags as well. because if a stack tag is removed a column might in that current stack might be required to be moved into a separate column, or a separate column might get merged with a previous stack.

- [x] when focus is regained by the kanban (possible configuration change), check if the tag menus of column and tag burger menus have changed and if so, regenerate these submenus.


- [x] before starting the migration, create todos, make sure that before you replace a function you know
  all features of the old code and reimplement them in the replacement. also make sure you remove the
  old code ompletely!
  - PLANNED: See tmp/plugin-migration-features.md for feature checklist
  - Solution 1 (Interface-Based Plugin Registry, 96% quality) selected

- [x] COMPLETED: PLUGIN ARCHITECTURE MIGRATION (Solution 1: Interface-Based Plugin Registry)
  - [x] PHASE 0: Document existing code features (see tmp/plugin-migration-features.md)
  - [x] PHASE 1: Create plugin interfaces (ImportPlugin.ts, ExportPlugin.ts)
  - [x] PHASE 2: Create plugin implementations
    - ColumnIncludePlugin, TaskIncludePlugin, RegularIncludePlugin
    - MarpExportPlugin
  - [x] PHASE 3: Migrate FileFactory to use plugins (createIncludeViaPlugin, createIncludeDirect methods)
  - [x] PHASE 4: Migrate markdownParser to use PluginRegistry.detectIncludes (NO fallback)
  - [x] PHASE 5: Unified IncludeFile class with fileType property
    - DELETED: ColumnIncludeFile.ts, TaskIncludeFile.ts, RegularIncludeFile.ts
    - All functionality consolidated into IncludeFile.ts
  - [x] PHASE 6: Update all imports and usages
    - Updated: kanbanWebviewPanel.ts, includeFileManager.ts, FileOperationVisitor.ts
    - Updated: MarkdownFileRegistry.ts, files/index.ts
  - ARCHITECTURE:
    - IncludeFile.ts: Unified class with fileType='include-column'|'include-task'|'include-regular'
    - Plugins create IncludeFile instances with appropriate fileType
    - NO fallback code - plugins MUST be loaded at extension activation
    - FileFactory.createIncludeDirect() for direct file creation
    - FileFactory.createInclude() uses plugins for context-based creation
  - FILES:
    - src/plugins/{interfaces,registry,import,export}/, PluginLoader.ts
    - src/files/IncludeFile.ts (unified, non-abstract)
    - REMOVED: src/files/{ColumnIncludeFile,TaskIncludeFile,RegularIncludeFile}.ts


- [x] COMPLETED: Draw.io & Excalidraw diagram integration
  - [x] Export-time SVG conversion for `.drawio`, `.dio`, `.excalidraw`, `.excalidraw.json`, `.excalidraw.svg` files
  - [x] DrawIOService.ts - CLI-based conversion using draw.io desktop app
  - [x] ExcalidrawService.ts - Library-based conversion with @excalidraw/excalidraw
  - [x] Extended DiagramPreprocessor to handle file-based diagram references
  - [x] Asset type detection updated in ExportService
  - [x] Webview preview rendering (markdownRenderer.js + messageHandler.ts)
  - [x] Added @excalidraw/excalidraw npm dependency to package.json
  - NOTE: Excalidraw library integration needs testing - may require puppeteer for server-side rendering
  - NOTE: Users must install draw.io CLI: `brew install --cask drawio` (macOS) or download from GitHub releases

- [ ] pressing delete when not in edit mode of a column-header, task-header or task-content but having some element selected, should delete the currently highlighted task.
Pressing enter should start editing the task.

- [x] can you add a speaker note function that makes lines after ;; to be speakernotes. the way speakernotes are displayed can be defined separately in the css. they should get a border with light oclors. also they might get exported with into different styles. For marp the speaker notes are exported as html comments "<!-- note -->. Also add how html comments are handled when exporting to marp (of course handle this separately from the speaker notes. ex: do NOT convert speakernotes to comments and then handle them according to the speaker note rules). By default they should be hidden by the post processor. make both of these multiple choise selection:
- Marp Notes:
  - Comment (<!-- -->)
  - Keep Style (;;)
  - Remove
- Html Comments:
  - Remove
  - Keep Style (<!-- -->)
- Html Content:
  - Keep Style (<>)
  - Remove
Integrate these into the exporter, with the default value being the first one. Save the last defined values for the next export.

- [x] Export Column in the column burger menu doesnt close the burger menu.
- [x] Copy as Markdown copies the full board, not the selected column or tasks content!

- [x] can you add a sidebar that lists all kanbans in the opened workspaces. it should only have one button to check all workspaces for markdown files with the yaml header element "kanban-plugin: board". the user might also drag&drop kanban board files into it. this files should be saved into the workspaces somehow, so when loading again i have a list of all kanbans in the workspaces.

- [x] when an image is dropped into vscode it can read and display it. but when i drop it into the kanban it can only create a link without the file path. would it somehow be possible to copy the file, suggest to the user to create a duplicate or similar so we have better external image handling?

- [x] might it be that the way a file is !!!included()!!! (different types of paths) has an influence on the tracking of changes?
the path might be of an included file:
- absolute to the filesystem
- relative to the include file (the included markdown file, if it's included)
- relative to the main file (main markdown file)
- relative to any of the opened workspaces  workspace1/folder/to/file.md

relative paths might start width:
- ./
- ../
- folder/
- or ..\ (for windows)
absolute paths start with:
- /
- C:


- the image include function should be updated so it can also include files relative to an included files path as priority, if the image is not found it should search for the images relative to the main markdown file. can this be included into the include handling process, so it rewrites the paths if an image is found relative to the include file, rather then the main file? it should allways write relative paths!

- [x] i still see %INCLUDE_BADGE:path/to/filename.md% in the column titles, THIS SHOULD NOT HAPPEN. We solved this problem before!!! make sure there is only one codepath that handles include columninclude and taskinclude (in column and task headers) . the include in the task content is implemented only in the frontend. But make sure it never passes any !!!include()!!! in a task or column header into the markdown renderer!!! . i think the %INCLUDE appears when the path starts with "../path/to/something", so a relative path in a folder above.

- [x] view focus should do some things which are currently only done when the kanban is opened.
  - reload all configuration and update menus. for example the active tag groups. or when default changes have been modified.
  - the keyboard shortcuts.
  all these configurations should not be loaded at any other time. verify this by checking the complete code for configuration or setting loading or api access.

- [x] we have additional shortcuts defined. which seem to open a buffer (a new view). which it closes automatically. we need to remove this feature and try to implement it using the default process, as it sometimes closes the wrong view. eighter it works with the default pasting or not. 

- [x] the keyboard shortcuts that edit insert content using the vscode default shortcuts dont work anymore. can you verify the process that is currently running and suggest 3 solutions on solving it with a quality measurement. improve until you have 100% quality or near.

- [x] the column header is still broken when it contains an !!!include(filename.md)!!! there seem to be interfering system in the code. for example it does different displays on initial load and on updating the colums. maybe because the backend does something with the !!!include()!!! title as well? 

- [x] when creating or editing tasks or after moving them sometimes the tasks cannot be edited again or the drag button doesnt work. we need to verify and unify how tasks are created, i assume we have multiple codepaths that create tasks in different was. for example the are quite reliable after unfolding. ultrathink . create 3 suggested solutions and rate theyr quality

- [x] if search finds the result in a column title, it should focus the column title, not the full column.

- [x] dragging is still sometimes extremely slow, how about we just   display the position it's dropped and dont preview the change with the actualy column or task moved? we can remove all height recalculation during drag events.

- [x] lets modify some of the directives. these settings should go into a burger menu, next to the filename in the file-info-header.
"""
theme 	Set a theme name for the slide deck ▶️
style 	Specify CSS for tweaking theme
headingDivider 	Specify heading divider option ▶️
size 	Choose the slide size preset provided by theme
math 	Choose a library to render math typesetting ▶️
title 	Set a title of the slide deck
author 	Set an author of the slide deck
description 	Set a description of the slide deck
keywords 	Set comma-separated keywords for the slide deck
url 	Set canonical URL for the slide deck (for HTML export)
image 	Set Open Graph image URL (for HTML export)
marp 	Set whether or not enable Marp feature in VS Code

paginate 	Show page number on the slide if set to true ▶️
header 	Specify the content of the slide header ▶️
footer 	Specify the content of the slide footer ▶️
class 	Set HTML class attribute for the slide element <section>
backgroundColor 	Set background-color style of the slide
backgroundImage  Set background-image style of the slide
backgroundPosition 	Set background-position style of the slide
backgroundRepeat 	Set background-repeat style of the slide
backgroundSize 	Set background-size style of the slide
color 	Set color style of the slide
"""
they can be written to the yaml header and must also be read from there when loading the kanban!

remove the marp theme and style from the column headers and task headers.



- [ ] Remove the "immediate" parameter from the boardUpdate function. 
  We should never use the feature to mark something as unsaved, but use the hash to determine wether a file needs saving to file, because the file content is different to the saved content! Remove this feature and replace it by comparing the hashes from cache and files.
  saveBoardState should not need to update cache, but only save to the files. Because the cache must be kept actual all the time!
   So onWillSaveTextDocument is completely redundant and wrong! 

- [ ] The shortcuts dont work properly anymore. Also the complex feature for translation does not work properly. The complexity it adds is not feasable. We could try again with the paste version which just pastes the replaced content, but using new files is too much.

- [ ] add a feature to add templates for marp styles. the user would be able to defined those, but a current list would be. Each can be toggled on or off. 
  - _class stylings which are set as <!-- class: style --> . style can be
    - fontXX : where XX is a number. the list of fonts tags are in the section.fontXX in /Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/marp-engine/themes/style-roboto-light.css
    - invert 
    - center
    - no_wordbreak
    - highlight
    - column_spacing
    - column_border
    - fontbg
    more elements should be addable by the user in the configuration. as a string list.
  - check more styles from <https://github.com/marp-team/marp/blob/ffe6cd99/website/docs/guide/directives.md>
  - and the website: <https://deepwiki.com/marp-team/marp/3.4-theming-and-styling> 
  

- [x] Can we make the sticky setting for headers (which is currently modified by the "sticky stack mode") individual for each column header, with a global sticky flag in the "file info bar". so each column gets a sticky flag (a pin icon). when the sticky flag is active, the header will stay on the screeen using the current layout settings.analyze the influence of the "sticky stack mode" on the kanban board. check if we can make each column have it's individual sticky setting . we still want the "sticky stack mode settings, but only "Full stack" and "Title only", the none feature is after this modification modified trough the "sticky flag" 
  -> the sticky state can be saved into the kanban as #sticky, it should be 
considered a layout tag that is filtered when displaying depending on the 
setting, also when exporting it might get filtered! the default state should be 
not sticky. the global setting is overriding the setting if it's pressed 
normally (and not saved as individual setting), if alt+pressed it toggles all 
states of each column and is saved to the files. place the icon right of the 
column folding. make sure it's applied after the rendering in the process where 
all the tags are processed, as the user might add it by text. 

- [x] when adding multiple files using drag & drop it randomly places them over the board. why does that
  happen?

- [x] plan high-level cleanups. for this update the files in the agent folder first. then analyze the structure of the code. then analyze wether we could reasonably apply design patterns to optimize it and reduce changes of errors.
- [x] COMPLETED: PlantUML integration (LOCAL WASM)
  - [x] Renders ```plantuml code blocks as SVG diagrams using LOCAL WASM (no server!)
  - [x] Uses @sakirtemel/plantuml.js with CheerpJ for browser-based Java execution
  - [x] Convert to SVG button saves diagram and comments out code
  - [x] Files saved to Media-{markdown-filename}/ folder
  - [x] Complete offline rendering - NO network calls to plantuml.com
  - [x] SVG rendering via com.plantuml.wasm.v1.Svg Java class
  - [x] Package size: 4.2MB jar + 17MB jar.js (one-time load, then cached)

- [x] Add mermaid rendering into the kanban and the export!
- [ ] Could we add a feature that we could add full pdf files or individual pages from pdf files, where each page is a task? 
  - the format would be something like ![](path/to/document.pdf p13)  for page 13 of the pdf.
  - best if you create a markdown-it plugin for it. as it should also work in the export.
- [x] COMPLETED: Simplified conflict detection using 3-variant structure
  - [x] Implemented hasAnyUnsavedChanges() method (checks 4 conditions)
  - [x] Simplified handleExternalChange() to just 2 decision paths
  - [x] Added JSON.stringify logging for better debugging
  - [x] VARIANT 1: ANY unsaved changes → show conflict dialog
  - [x] VARIANT 2: NO unsaved changes → auto-reload
  - [x] Prevents ALL data loss without user consent
  - [x] Works for main kanban and all include file types
  - [x] See: tmp/IMPLEMENTATION-SUMMARY.md, tmp/TEST-PLAN.md
- Add tags that parse numbers such as #1 #2 #13 and #04 #032 . They should be displayed as batches next to the column or task in a good contrast.

- Re-Analyze the full process of file change detection and caching, conflict checking and user response as well as saving the data in the different ways. then i save the main file externally with an unsaved internal change its overwriting the external file. BUT THERE ARE OTHER PROBLEMS AS WELL. I WANT A COMPLETE AND FULL ANALYSIS, USING AN UML STRUCTURE. THEN VERIFY EACH STEP WETHER ITS NEEDED AND IN ORDER. THEN MAKE 3 SUGGESTIONS HOW TO SOLVE EACH OF THE PROBLEMS, IF CONFIDENCE IN SOLVING THE PROBLEM IS NOT 100% ANALYZE AGAIN AND REPEAT UNTIL YOU ARE SURE THE PROBLEM IS PROPERLY SOLVED. WORK AUTOMATICALLY UNTIL I INTERRUPT YOU!!!

- [x] it seems as if the board is rendered twice when loading the board.

