
## presentation format reading structure

// get the first 2 lines with content
contentLines = []
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() !== '') {
    contentLines.add(i);
    if contentLines.length >= 2 {
      break;
    }
  }
}

titleLine = -1; // undefined
descriptionStartLine = -1; // undefined
descriptionEndLine = contentLines.length;

if (contentLines.length == 1) {
  if (contentLines[0] < 2) { // first content after 0 or 1 empty newlines => it's a title
    titleLine = contentLines[0];
    if (contentLines.length == 2) {
      descriptionStartLine = min(contentLines[0] + max(contentLines[1]-contentLines[0], 1), 3); // take the line after the title or at max one after that as descriptionStartLine
    }
  }
  else { // first content after more then 2 empty newlines => take the first line with content, or othervise the 3th
    titleLine = undefined;
    descriptionStartLine = min(contentLines[0], 3);
  }
}

title = lines[titleLine]

// Add lines AFTER title
for (let i = descriptionStartLine; i < descriptionEndLine; i++) {
  descriptionLines.push(lines[i]);
}
description = descriptionLines.join('\n');

### Verify with these examples


"""
---
Title
Content
"""

"""
---
Title

Content
"""

"""
---

Title
Content
"""

"""
---

Title

Content
"""

but
"""
---


Content
"""

"""
---



Content
"""

and when saving we allways

"""
---

Title

Content
"""

when there is only content
"""
---



Content
"""


