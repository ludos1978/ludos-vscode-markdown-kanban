include in ./root/root-include-2.md

Modify this line a

---

included-excalidraw

![](./root-include-2-MEDIA/included-excalidraw.excalidraw)

---

Proteus-Nodeland_preview-[h2OqQ6-ESp4]-480p

![](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-ksanban-obsidian/tests/kanban-presentation-tests/Media/Proteus-Nodeland_preview-%5Bh2OqQ6-ESp4%5D-480p.mp4)

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