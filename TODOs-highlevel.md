- [ ] Remove the "immediate" parameter from the boardUpdate function. 
  We should never use the feature to mark something as unsaved, but use the hash to determine wether a file needs saving to file, because the file content is different to the saved content! Remove this feature and replace it by comparing the hashes from cache and files.
  saveBoardState should not need to update cache, but only save to the files. Because the cache must be kept actual all the time!
   So onWillSaveTextDocument is completely redundant and wrong! 

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
  - check more styles from @https://github.com/marp-team/marp/blob/ffe6cd99/website/docs/guide/directives.md#L74-L84
  - and the website: https://deepwiki.com/marp-team/marp/3.4-theming-and-styling  

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