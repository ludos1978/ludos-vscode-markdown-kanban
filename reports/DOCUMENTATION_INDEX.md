# Documentation Index

Complete guide to all documentation in the Kanban Markdown Extension project.

---

## 🚀 Quick Start

### For Users
- [README.md](README.md) - User guide, features, and installation

### For Developers
Start here before making any code changes:
1. **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture overview (READ THIS FIRST)
2. **[AGENT.md](AGENT.md)** - Development rules and guidelines
3. **[STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md)** - State machine specification

---

## 📐 Architecture Documentation

### Core Architecture
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Complete system architecture
  - State machine pattern explanation
  - File system hierarchy
  - Change handling flow
  - Data synchronization
  - Include files system
  - Design principles

### State Machine
- **[STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md)** - State machine design
  - 15 state definitions with transitions
  - State flow diagrams
  - Event routing architecture
  - Example flows
  - Implementation strategy
  - Benefits and rationale

- **[STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md)** - Implementation guide
  - Migration checklist
  - Entry point migration examples
  - State handler implementation templates
  - Testing strategy
  - Common pitfalls
  - Rollout plan

---

## 👨‍💻 Development Documentation

### Rules & Guidelines
- **[AGENT.md](AGENT.md)** - Development rules (MUST READ)
  - Coding rules
  - Data handling guidelines
  - Error handling
  - Git workflow
  - Behavioral guidelines

### Code Reference
- **[agent/FUNCTIONS.md](agent/FUNCTIONS.md)** - Complete function catalog
  - All functions in codebase
  - State machine methods
  - Critical fixes history
  - Phase-by-phase changes

- **[agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md)** - Data structure definitions
  - TypeScript interfaces
  - Type hierarchies
  - Board structure
  - Task structure

- **[agent/DATAINSTANCES.md](agent/DATAINSTANCES.md)** - Data instance tracking
  - Singleton instances
  - Registry instances
  - File instances

### Frontend Documentation
- **[agent/JS-FUNCTIONS.md](agent/JS-FUNCTIONS.md)** - Frontend JavaScript functions
- **[agent/JS-DATASTRUCTURE.md](agent/JS-DATASTRUCTURE.md)** - Frontend data structures
- **[agent/JS-DATAINSTANCES.md](agent/JS-DATAINSTANCES.md)** - Frontend instances

---

## 🎯 Project Management

### TODOs
- **[TODOs-highlevel.md](TODOs-highlevel.md)** - High-level feature planning
- **[TODOs.md](TODOs.md)** - Current sprint tasks
- **[TODOs-archive.md](TODOs-archive.md)** - Completed requirements archive

---

## 📝 Recent Changes & Fixes

### Phase 6: State Machine Architecture (2025-11-02)
**Files Created:**
- [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Complete state machine specification
- [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) - Migration guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - Architecture overview
- [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) - This file
- [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts) - State machine implementation

**Files Updated:**
- [AGENT.md](AGENT.md) - Added architecture overview section
- [README.md](README.md) - Added "For Developers" section
- [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Added Phase 6 state machine functions

**Problem Solved:**
- ⚠️ Multiple scattered entry points → ✅ Single unified entry point
- ⚠️ Inconsistent unsaved check → ✅ ALWAYS executed for switches
- ⚠️ Unpredictable execution flow → ✅ Clear state transitions
- ⚠️ Difficult debugging → ✅ State history tracking

### Previous Phases (Phase 1-5)
See [agent/FUNCTIONS.md](agent/FUNCTIONS.md) for complete history:
- Phase 5: Critical cleanup (2025-10-29)
- Phase 4: Source restructuring
- Phase 3: Unified change handler
- Phase 2: Column include switch fixes
- Phase 1: Foundation fixes

---

## 🔍 Finding Information

### "I want to understand the system architecture"
→ Start with [ARCHITECTURE.md](ARCHITECTURE.md)

### "I want to add a new feature"
1. Read [AGENT.md](AGENT.md) - Development rules
2. Check [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Existing functions
3. Check [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md) - Data structures
4. Read [ARCHITECTURE.md](ARCHITECTURE.md) - Architecture patterns

### "I want to modify file change handling"
1. Read [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Understand states
2. Read [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) - How to migrate
3. Check [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts) - Implementation

### "I want to fix a bug"
1. Check [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Recent fixes
2. Read [AGENT.md](AGENT.md) - Error handling rules
3. Add tests before fixing

### "I want to understand a specific function"
→ Search in [agent/FUNCTIONS.md](agent/FUNCTIONS.md)

### "I want to understand data structures"
→ Check [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md)

---

## 📚 Documentation by Topic

### File System & Changes
- [ARCHITECTURE.md](ARCHITECTURE.md) - File system hierarchy, change handling flow
- [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Change event types, state flow
- [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts) - Implementation

### Include Files
- [ARCHITECTURE.md](ARCHITECTURE.md) - Include files system section
- [TODOs-archive.md](TODOs-archive.md) - Include file requirements
- Column includes use Marp presentation format (slides with `---`)
- Task includes use plain description content

### Conflict Resolution
- [ARCHITECTURE.md](ARCHITECTURE.md) - Conflict resolution section
- [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Edit capture flow
- Baseline capture preserves user edits during external changes

### Data Synchronization
- [ARCHITECTURE.md](ARCHITECTURE.md) - Two-way sync architecture
- Message batching for performance
- Targeted updates (only modified content)

### Testing
- [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) - Testing strategy
- Unit tests for state handlers
- Integration tests for event types

---

## 🎓 Learning Path

### New to the Project
1. Read [README.md](README.md) - Understand what the extension does
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) - Understand system design
3. Read [AGENT.md](AGENT.md) - Learn development rules
4. Browse [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Familiarize with codebase

### Contributing Code
1. Read [AGENT.md](AGENT.md) - Follow these rules strictly
2. Consult [agent/FUNCTIONS.md](agent/FUNCTIONS.md) - Check existing functions
3. Read [ARCHITECTURE.md](ARCHITECTURE.md) - Understand patterns
4. Follow [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) if touching change handling

### Understanding State Machine
1. Read [ARCHITECTURE.md](ARCHITECTURE.md) - Why state machine?
2. Read [STATE_MACHINE_DESIGN.md](STATE_MACHINE_DESIGN.md) - Complete specification
3. Review [src/core/ChangeStateMachine.ts](src/core/ChangeStateMachine.ts) - Implementation
4. Read [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md) - Examples

---

## 🔧 Maintenance

### Keeping Documentation Updated

When you make changes:

1. **Update [agent/FUNCTIONS.md](agent/FUNCTIONS.md)**
   - Add new functions
   - Document changes to existing functions
   - Update "Last Updated" date

2. **Update [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md)**
   - Add new interfaces/types
   - Document structure changes

3. **Update [agent/DATAINSTANCES.md](agent/DATAINSTANCES.md)**
   - Add new singleton instances
   - Document instance lifecycle changes

4. **Update [ARCHITECTURE.md](ARCHITECTURE.md)**
   - If architecture patterns change
   - If new major components added

5. **Update this file ([DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md))**
   - If new documentation files added
   - If major documentation restructuring

---

## 📋 Documentation Checklist

Before committing code changes:

- [ ] Updated [agent/FUNCTIONS.md](agent/FUNCTIONS.md) with new/changed functions
- [ ] Updated [agent/DATASTRUCTURE.md](agent/DATASTRUCTURE.md) if data structures changed
- [ ] Updated [agent/DATAINSTANCES.md](agent/DATAINSTANCES.md) if instances changed
- [ ] Followed rules in [AGENT.md](AGENT.md)
- [ ] If changing file handling: followed [STATE_MACHINE_MIGRATION_GUIDE.md](STATE_MACHINE_MIGRATION_GUIDE.md)
- [ ] Added tests for new functionality
- [ ] Updated inline code comments
- [ ] Updated [ARCHITECTURE.md](ARCHITECTURE.md) if architecture changed

---

## 📞 Getting Help

If documentation is unclear or incomplete:

1. Check related documents in this index
2. Search for keywords across documentation files
3. Review code comments in relevant source files
4. Check git history for context on changes
5. Create an issue documenting what's unclear

---

## Version History

- **v6.0** (2025-11-02): State machine architecture, comprehensive documentation overhaul
- **v5.0**: Baseline capture implementation
- **v4.0**: Source code restructuring
- **v3.0**: UnifiedChangeHandler introduction
- **v2.0**: Include files system
- **v1.0**: Initial release

---

**Last Updated**: 2025-11-02
**Documentation Version**: 6.0
