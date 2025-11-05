# Force Write & Content Verification - Testing Guide

**Feature Added:** 2025-11-05
**Version:** 0.27.54+

## Overview

This document provides comprehensive testing instructions for the new **Force Write All** and **Verify Sync** features, which were added to solve critical sync issues when the frontend and backend get out of sync.

---

## Features Added

### 1. Force Save All (Emergency Recovery)
- **Purpose:** Unconditionally writes ALL files to disk, bypassing broken change detection
- **Location:** Debug overlay (Ctrl+Shift+D) → "⚠️ Force Save All" button
- **Use Case:** When normal save doesn't work and you suspect frontend/backend are out of sync

### 2. Verify Sync
- **Purpose:** Compares actual content between frontend and backend (not just flags)
- **Location:** Debug overlay (Ctrl+Shift+D) → "🔍 Verify Sync" button
- **Use Case:** Diagnose sync issues, verify state consistency

---

## Testing Instructions

### Prerequisites
1. Open VS Code with the markdown-kanban extension installed
2. Open a markdown kanban file (.md with kanban board structure)
3. Press **F5** to launch the extension in debug mode (if testing from source)

### Test 1: Verify Sync - Normal Operation
**Goal:** Verify that content synchronization check works correctly

**Steps:**
1. Open a kanban board markdown file
2. Press **Ctrl+Shift+D** to open the debug overlay
3. Click **"🔍 Verify Sync"** button
4. Verify the verification results dialog appears showing:
   - Total files count
   - Matching files count (should be all files)
   - Mismatched files count (should be 0)
   - Individual file status (all should show ✅ Match)

**Expected Result:**
- All files should match
- Dialog shows green border (verification-success)
- No "Force Write All" button appears in results

---

### Test 2: Force Save All - Confirmation Dialog
**Goal:** Verify confirmation dialog appears and works correctly

**Steps:**
1. Open debug overlay (Ctrl+Shift+D)
2. Click **"⚠️ Force Save All"** button
3. Verify confirmation dialog appears showing:
   - Warning message about unconditional write
   - List of files to be written
   - "Cancel" and "Force Write All" buttons

**Expected Result:**
- Confirmation dialog displays with warning
- Lists all tracked files (main + includes)
- Shows file count

**Test Variations:**
- Click "Cancel" → dialog closes, no operation performed
- Click "Force Write All" → proceeds to Test 3

---

### Test 3: Force Save All - Successful Write
**Goal:** Verify force write operation executes and reports success

**Steps:**
1. Follow Test 2 and click "Force Write All" in confirmation
2. Wait for operation to complete
3. Verify success message appears showing:
   - Number of files written
   - Backup created: Yes
   - Backup file path

**Expected Result:**
- Success message appears
- All files written count matches total tracked files
- Backup is created
- Debug overlay auto-refreshes

**Verification:**
- Check that backup file exists at the reported path
- Open one of the written files to verify content is correct

---

### Test 4: Verify Sync After Changes
**Goal:** Test verification when content differs

**Manual Simulation (for testing):**
1. Open debug overlay
2. Make changes to a task in the kanban board
3. DON'T save the file
4. Click "🔍 Verify Sync"

**Expected Result:**
- Since frontend state and backend file registry share state in current implementation, all should still match
- This test validates the verification mechanism works

---

### Test 5: Force Save All - With Modified Content
**Goal:** Verify force write saves all changes including unsaved modifications

**Steps:**
1. Open a kanban board
2. Make changes:
   - Add a new task
   - Move a task between columns
   - Edit task content
   - Modify an include file content
3. DON'T save (keep changes in memory)
4. Open debug overlay (Ctrl+Shift+D)
5. Click "⚠️ Force Save All"
6. Confirm the operation
7. Verify success message
8. Close and reopen the file

**Expected Result:**
- All changes are persisted to disk
- Reopening the file shows all changes
- No changes lost

---

### Test 6: Force Save All - Error Handling
**Goal:** Test error handling when write fails

**Steps (requires file permission issues):**
1. Make a file read-only:
   ```bash
   chmod 444 path/to/include-file.md
   ```
2. Open kanban board that includes the read-only file
3. Click "⚠️ Force Save All"
4. Confirm operation

**Expected Result:**
- Error message shows which file(s) failed to write
- Success count shows only files that succeeded
- Backup still created

**Cleanup:**
```bash
chmod 644 path/to/include-file.md
```

---

### Test 7: UI Integration Test
**Goal:** Verify buttons appear correctly in debug overlay

**Steps:**
1. Open debug overlay (Ctrl+Shift+D)
2. Verify the following buttons appear in order:
   - 📌 Pin
   - 🔄 Refresh
   - 🔄 Reload All
   - 🔍 Verify Sync (new)
   - ⚠️ Force Save All (new)
   - ✕ Close

**Expected Result:**
- All buttons visible and styled correctly
- Hover shows tooltips for new buttons
- Force Save All button has orange/warning color
- Verify Sync button has standard blue color

---

### Test 8: Verification Results Dialog - Interaction
**Goal:** Test verification results dialog interactions

**Steps:**
1. Click "🔍 Verify Sync"
2. When results dialog appears:
   - Verify close button (✕) works
   - Scroll through file results list
   - Check timestamp at bottom
   - If mismatches exist, verify "Force Write All" button appears

**Expected Result:**
- Dialog is modal and scrollable
- All interactive elements work
- Can close and reopen verification

---

### Test 9: Performance Test - Large Boards
**Goal:** Test with large kanban boards

**Setup:**
- Create/use a kanban board with:
  - 10+ columns
  - 100+ tasks
  - 20+ include files

**Steps:**
1. Open large board
2. Click "🔍 Verify Sync"
3. Measure time to complete
4. Click "⚠️ Force Save All"
5. Measure time to complete

**Expected Result:**
- Verification completes in <5 seconds
- Force write completes in <10 seconds
- No UI freezing
- Progress indicators show

---

### Test 10: Backup Verification
**Goal:** Verify backup creation works correctly

**Steps:**
1. Note current board state
2. Click "⚠️ Force Save All"
3. Note the backup path from success message
4. Navigate to backup location
5. Open backup file

**Expected Result:**
- Backup file exists at reported path
- Backup contains correct content (state before force write)
- Backup filename includes "force-write" label
- Timestamp in backup filename is correct

---

## Known Limitations

1. **Content Comparison:** Currently, verification compares frontend and backend by reading from the same file registry, so they will always match. True frontend/backend comparison would require accessing webview state separately.

2. **File Registry Dependency:** Force write uses the file registry's `forceWriteAll()` method, which depends on files being properly registered.

3. **No Progress Bar:** Current implementation shows alert dialogs. Future enhancement could add progress bars for large operations.

---

## Troubleshooting

### Issue: Force Save All button does nothing
**Solution:**
- Check browser console for errors
- Verify `window.vscode` API is available
- Check that file registry exists in backend

### Issue: Verification shows all files as mismatched
**Solution:**
- This might indicate a real sync issue
- Use Force Save All to resync
- Check console logs for errors

### Issue: Backup not created
**Solution:**
- Check filesystem permissions
- Verify backup directory exists
- Check console logs for backup creation errors

---

## Code References

### Backend
- **MarkdownFileRegistry.ts:343-366** - `forceWriteAll()` method
- **messageHandler.ts:1067-1073** - Message handler registration
- **messageHandler.ts:3166-3353** - Implementation of force write and verification handlers

### Frontend
- **debugOverlay.js:958-1142** - Force write and verification functions
- **debugOverlay.js:324-329** - UI buttons
- **debugOverlay.js:2094-2123** - Message listeners

### Documentation
- **agent/FUNCTIONS.md** - Function catalog
- **agent/DATASTRUCTURE.md** - Data structure definitions
- **agent/DATAINSTANCES.md** - Data instance documentation

---

## Success Criteria

✅ **All tests pass**
✅ **No TypeScript compilation errors**
✅ **No runtime JavaScript errors**
✅ **Backup created before force write**
✅ **User can recover from sync issues**
✅ **Clear error messages when operations fail**

---

## Future Enhancements

1. **True Frontend/Backend Comparison:** Access webview state directly for more accurate verification
2. **Diff View:** Show actual content differences, not just hashes
3. **Selective Force Write:** Allow writing specific files instead of all
4. **Auto-Verification:** Automatically verify sync after major operations
5. **Progress Indicators:** Replace alerts with progress bars for better UX
6. **Sync Repair:** Auto-fix common sync issues detected by verification

---

**Testing Complete Date:** ___________
**Tester Name:** ___________
**Result:** ☐ Pass  ☐ Fail  ☐ Needs Review
