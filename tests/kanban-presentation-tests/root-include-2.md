include in ./root/root-include-2.md

Modify this line a

---

included-excalidraw

![](./root-include-2-MEDIA/included-excalidraw.excalidraw)

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