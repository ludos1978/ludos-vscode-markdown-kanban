---

kanban-plugin: board

---

## Normal column
- [ ] normal task
  some content
  
  whatever

## standard includes #stack
- [ ] different includes
  ==./root/root-include-1.md==
  
  !!!include(./root/root-include-1.md)!!!

## task includes
- [ ] !!!taskinclude(./root/root-include-2.md)!!!

## !!!columninclude(./root/root-include-3.md)!!! #stack


