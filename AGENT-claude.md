## Most important RULEs
- Dont modify the AGENT.md, except on explicit user request which must mention the AGENT.md filename!
- Dont solve problems that are not given explicitly in the task. If additional changes are required to make it work the way to intend, then you are obliged to ask the user for permission.
- for any new function you want to create, explain why you need to add a new one and why you cannot modify the most similar ones to be reused. You must verify all functions for similar features and logic before adding any new function. This is very important!
- use npm version patch for minor changes, use npm version minor when new features are added that influence the features available to the user or the user experience!
- check that all logs are removed or use logger (severe problems) after a problem has been solved properly
- if there are undone tasks in the TODOs-highlevel.md work on these. You can create individual tasks in the TODOs.md to manage workflow over multiple sessions, dont forget to mark the highlevel todos as done when planning has been done.
- You may not add any functions, except if have not checked all the existing functions before for similar functionality or ones that might easily be extended to cover the feature. There must absoletely be no multiple functions that handle similar functions. Check the full code before you add any a new function.
- For every task make 3 suggestions how to solve or approach the issue, each with an expected quality/probability that it properly solves the problem. If the best quality is still below 100%, analyze the problems and suggest 3 improvements to make on it. only then continue working on the task.
- Never do any lazy refactorings. Eighter we optimize the code or we leave it, but dont add any additional wrappers and leave the code it executes untouched!
  - When migrating, copy the complete code and verify line by line that it's functionality is retained, fixed and migrated.
  - Only do a refactoring if it's really helpful in code organisation.
  - how complex a refactoring is, is irrelevant.
  - our focus is keeping the code simple and in a clean structure!
  - do not stop with the refactoring until you are completely finished. this must include completely removing any old or obsolete code! if you need to stop, as the last sentence, mention that you are not finished with the work!
  - only stop for questions that the user must answer.
- for every larger action you take. think about the positive and negative outcome of implementing it and the positive and negative outcome of not implementing it. Do not consider the work involved to do it, only the result of the work you would do. weight both sides against each other before taking action. only implement the change if its more then 60% positive! It does not matter how hard the task is, only weight in the impact on the expected result!
- if a thought is a result of unfounded and illogical reasoning, then trash it. Only consider thoughts that are helping towards a good product.
- When refactoring multiple classes or functions together into one, do not use wrappers. Instead fix he callers!

## General rules about handling data:
- use relative paths, relative to the main kanban file for all data storage, except for included files, they use relative paths to theyr own location.
- use the data chache to store modifications unless the user saves the data.
- the default for save/reload actions is to not save and not reload. pressing escape should show the dialogue again.
- Never modify the save data without the users permission.

## General rules about the code:
- Make the changes as minimal as necessary to fulfill the request of the user. Do not add any unrequired complexity when implementing features.
- use KISS when creating code.
	- create classes if some parts of the data is mostly only handled by the contained functions.
  - create functions if their functionality is used in more then one place.
	- create functions to separate different functionalities.
	- make sure to only create new variables if the data is nowhere else stored (an exeption might be the separated front and backend)
	- never store the same information in mutiple places, except if the user wants that. cleanup all data duplication that you detect after discussing it with the user. make sure the data is placed at the most appropriate place and create functions to retreive the single point of knowledge.
		- one exception in this code is the kanban board which is stored in the front and the backend (intentional sync between layers).
		- within each layer (frontend or backend), maintain only ONE reference to each piece of data.
		- keep a list of the single points of data in tmp/single-points-of-knowledge.md and update it when adding new data storage.
- never remove functionality without the users consent.
- if you cleanup code, allways check what the code does, create a list of these features and reimplement all these features.
- Never try to add an alternative implementation without discussing it with the user. Never add any fallback solutions! The code must run correctly, if you cant get it to work, discuss it with the user.
- Dont try to add failsaves or backup solutions, we need the general execution to be perfect.
- Implmement the requested features according to the request. 
- Keep changes small. 
- Suggest DRY cleanups if you find functions get similar functionality. 
- Keep a agent/FUNCTIONS.md actual and update after each modification, the file keeps track of all functions in the code in front and backend. Each functions is described as: 
	- path_to_filename-classname_functionname or -functionname when it's not in a class.
	- a description of the functionality in 1 or 2 lines of keywords or sentences.
- Before creating a new functionality or creating larger code parts allways consult the FUNCTIONS.md. 
- Be very careful and think carefully when i type in capital letters! Be extremely careful and check at least three times with different aspects when i use swear-words.$
- NEVER ADD ANYTHING I DONT ASK FOR! Do not invent features or requirements when i dont ask for them. If you think they are needed, ask me.
- When replacing or removing something, allways analyze what it was used for.
- Allways create completely functional code, never implement any partial, demo or abstract code. Integrate it into the complete codebase.
- do not mark as deprecated, remove the code completely!
- do not modify the general application structure if you have not given an explicit task for it.
- do not randomly trim values. spaces might be there for a reason. especially in front of strings!
- Do not create summary documents, only keep a single documentation about the project which you update with changes in the project structure. before adding any new functions, data structures or data instances consult these documents. Add the newly added functions/datastructures and data instances to it before you add them to the code. Before doing any code change consult the documents in the agent folder!
	- agent/FUNCTIONS.md for the functions in the project.
	- agent/DATASTRUCTURE.md for the data structures.
	- agent/DATAINSTANCES.md for the instances of data.

- dont refactor names by just modifying adding underscores or from one style to another. When changing names, think about the function of a variable or class and then rename it properly!

- when analyzing code for refactoring allways check the function calls as well as the code before and after as well!

- Never keep any obsolete code! Rewrite code to make it use new data styles completely or remove it completely. Do not create any compatiblity layers or conversions from old data styles!
- Keep reports short and concise or leave them out if it's already mentioned in the answer.
- Do not use delays or delayed calls anywhere, except for visual effects that have no functional background. Never use delays to create an order of execution. it's fine to use delays (timers) if it's just a visual information to the user.
- Do not add default values for cases where default values cannot be read (for example from config), instead throw warnings or errors!

- If you have to implement a function that is very similar to an existing feature. First verify if the existing functionality could be refactored so the old system still works very well, while allowing to reuse the functionality for the new feature. Only do the refactoring if the old system is very safe to still run properly. Inform the user about your actions first and after implementing it, make sure to have him test the new and the old functionality!
- when refactoring, do not create wrappers.


## Error handling:
- allways check for compile errors
- allways check for log messages that could be removed or made to show up less often.
- allways use a tag to add to log files such s [kanban.functionname.topic-debug-label]
- if you add logs, make sure they are at keypoints of relevant data modifications. only add logs to code instances when data is modified, keep logs that are triggered by events minimal. minimize the number of logs in the code. check front and backend and remove any unneeded logs except errors and warnings, or logs related to the current task.

## GIT handling:
- after finishing a problem and before working on another cleanup the obsolete and unused changes. comiit before doing this and after.
- before working on a new feature make a branch.
- after finishing working on a feature merge the branch with main.
- you are forbidden from using git reset!

## General rules about your behaviour:
- dont be overly optimistic, ony things that are tested are proved, othervise we assume it's still broken.
- use files to store informations that you can use in this working session. It's only for your own usage, the user does not need to read them. Store them in ./tmp/ dont add them to the repository. Remove the files after you finished working on a topics.
- allways think, for every time we try to resolve an unfixed problem think even harder.
- never implement any mock code. allways fully implement it, in the most simple way.
- after working on a problem and verifying that it's solved, check if any of the changes are obsolete or unneeded and remove these changes if it's so.
- Do not assume, rather ask if something is required to implement a feature or change
- If we worked on a problem which was not successfully solved, analyze what might have gone wrong and dont repeat the error.
- dont write reports of the tasks you finish, except if the user specifically requests it, othervise the chat is enough to track the progress.

ALL RULES IN THE AGENT.MD DO NOT NEED TO BE VERIFIED BY ASKING THE USER AGAIN.