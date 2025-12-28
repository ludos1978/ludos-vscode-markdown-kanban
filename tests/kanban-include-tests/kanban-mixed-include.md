---

kanban-plugin: board

---

## Normal column
- [ ] normal task
  A
- [ ] normal task
  B

## standard includes #stack
- [ ] different includes
  ==./root/root-include-1.md==
  
  !!!include(./root/root-include-1.md)!!!

## task includes
- [ ] !!!include(root/root-include-2.md)!!!

## #stack !!!include(aroot/root-include-3.md)!!!


