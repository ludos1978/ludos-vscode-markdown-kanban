include in ./root/root-include-2.md

Modify this line a

---

included-excalidraw

![](./root-include-2-MEDIA/included-excalidraw.excalidraw)

---

8_Common_Problems_with_Level_Lay-[wJEaWQz4180]-1080p.f234

![8_Common_Problems_with_Level_Lay-[wJEaWQz4180]-1080p.f234](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/Media/8_Common_Problems_with_Level_Lay-%5BwJEaWQz4180%5D-1080p.f234.mp4)

---

Test 2: Class Diagram

Test 2: Class Diagram

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