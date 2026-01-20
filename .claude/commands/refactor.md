# Refactor

You are doing a focused refactoring session. This is a distinct phase, not continuous activity.

## Step 1: Run Quality Checks

First, check if jscpd and knip are installed. If not, install them:

```bash
npm install -D jscpd knip
npx knip init
```

Run both tools:

```bash
npx jscpd src/
npx knip
```

Report the results:
- **jscpd**: Number of duplicate code blocks and duplication percentage
- **knip**: Unused files, unused dependencies, unused exports, unused types

## Step 2: Fix Issues Found

For each issue:
- **Duplicate code**: Extract to shared utility or component
- **Unused files**: Delete them
- **Unused dependencies**: Remove from package.json
- **Unused exports**: Remove the export or delete if truly unused

## Step 3: Run Code Simplifier

After fixing quality issues, run the code-simplifier plugin:

```
/code-simplifier
```

This simplifies complex code patterns that accumulated during development.

## Step 4: Delete Obsolete Files

Look for files that are no longer needed after recent changes. Common culprits:
- Old implementations that were replaced
- Test files for deleted code
- Unused components or utilities
- Stale documentation

## Step 5: Commit Cleanup

Commit the refactoring changes as a distinct commit:

```bash
git add -A
git commit -m "refactor: code quality cleanup (jscpd, knip, simplification)"
```

## Guidelines

- Treat refactoring as a distinct phase, not continuous activity
- Do this when you feel pain from Claude making mistakes, or after large additions
- ~20% of dev time on focused code quality improvements is reasonable
- Don't over-optimize—ship working code, then clean up
