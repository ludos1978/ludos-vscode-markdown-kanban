---

kanban-plugin: board

---

## # Heading 1 in Columntitle #green #todo
- [ ] ## Heading 2 in Tasktitle #export-exclude
  some long text
  
  Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.
- [ ] andreas-gucklhorn-mawU2PoJWfU-unsplash.jpg #cyan
  ---:
  
  ![](Media/jon-flobrant-rB7-LCa_diU-unsplash.jpg "image"){height=200px}
  
  
  :--:
  
  ![](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/Media/yannis-papanastasopoulos-U6dnImauDAE-unsplash.jpg "another image[^some]")
  
  
  :---
  
  
  [^some]: https://www.nouser.org/
- [ ] 
  Test 7: Pie Chart #idea
  
  ```mermaid
  pie title Browser Usage
      "Chrome" : 58
      "Firefox" : 22
      "Safari" : 12
      "Edge" : 8
  ```
- [ ] 
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

## !!!include(/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/root-include-2.md)!!!

## # A #red
- [ ] #pink
  ![photo-1756244866467-f4682840070c](/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/Media/photo-1756244866467-f4682840070c.avif)
- [ ] ## Include # #orange
  !!!include(/Users/rspoerri/_REPOSITORIES/_TINKERING_REPOs/markdown-kanban-obsidian/tests/kanban-presentation-tests/root-include-1.md)!!!
- [ ] drawio
  ![](./kanban-presentation-1-MEDIA/drawio.drawio)
- [ ] 
  ![screenshot.png](https://miro.com/app/live-embed/uXjVLewdNZE=/?moveToViewport=-956,-2765,1912,1595&embedId=344522680947){height="650px"}


