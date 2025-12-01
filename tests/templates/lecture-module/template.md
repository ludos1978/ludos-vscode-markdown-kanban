---
name: Lecture Module
description: Create a lecture module with slides and exercises
icon: 📚
variables:
  - name: number
    label: Module Number
    type: number
    format: "02d"
    default: 1
  - name: topic
    label: Topic Name
    type: string
    required: true
---

## {topic} Overview #stack
- [ ] Introduction !!!include(includes/{number:02d}-{topic:slug}.md)!!!
- [ ] Key Concepts
- [ ] Examples

## {topic} Exercises #stack
- [ ] Exercise 1
  Practice the basics
- [ ] Exercise 2
  Apply concepts
- [ ] Exercise 3
  Challenge problem

## {topic} Review
- [ ] Summary
- [ ] Quiz Questions
- [ ] Resources
