
- [ ] include in the column header is still not reliably loading the file. also the enable include isnt working properly. i tested in this logfile: @logs/vscode-app-1763916142426.log 

- [ ] in the column handling after a text change of a column header, it must check for #stack tags as well. because if a stack tag is removed a column might in that current stack might be required to be moved into a separate column, or a separate column might get merged with a previous stack.

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
  

- [ ] Can we make the sticky setting for headers (which is currently modified by
 the "sticky stack mode") individual for each column header, with a global 
sticky flag in the "file info bar". so each column gets a sticky flag (a pin icon). when the sticky flag is active, the header will stay on the screeen using the current layout settings.analyze the influence of the "sticky stack mode" on the kanban board. check if we can make each column have it's individual sticky setting . we still want the "sticky stack mode settings, but only "Full stack" and "Title only", the none feature is after this modification modified trough the "sticky flag" 
  -> the sticky state can be saved into the kanban as #sticky, it should be 
considered a layout tag that is filtered when displaying depending on the 
setting, also when exporting it might get filtered! the default state should be 
not sticky. the global setting is overriding the setting if it's pressed 
normally (and not saved as individual setting), if alt+pressed it toggles all 
states of each column and is saved to the files. place the icon right of the 
column folding. make sure it's applied after the rendering in the process where 
all the tags are processed, as the user might add it by text. 

- [ ] when adding multiple files using drag & drop it randomly places them over the board. why does that
  happen?

- [ ] plan high-level cleanups. for this update the files in the agent folder first. then analyze the structure of the code. then analyze wether we could reasonably apply design patterns to optimize it and reduce changes of errors.
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