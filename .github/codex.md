# Codex handoff notes

This repository hosts Turfight Planner, a single-page GitHub Pages app for planning one-share horse investments.

## Current structure
- `index.html`: all HTML/CSS/JavaScript in one file
- `icon-512.png`: home screen icon

## Current workflow
Use the same lightweight workflow as Asset Vision where possible:

1. Create Issue
2. Create branch from `main`
3. Let Codex implement the issue
4. Open Pull Request
5. ChatGPT/user review
6. Merge
7. Delete branch

## Product principles
- Keep the app simple enough for iPhone/iPad use.
- Prioritize field usability during horse preview tours.
- Preserve local-only data storage unless explicitly changed.
- Avoid server/database/account requirements for now.
- Existing localStorage behavior must not be broken without migration consideration.

## Important current behavior
- Budget upper limit, voucher amount, bulk payment rate, display filter, units, and memos are saved in localStorage.
- Voucher is treated as a discount amount even if user inputs a negative value.
- Tour discount of 20,000 yen applies only when total selected units are 3 or more.
- Unit count must never go below 0.
- GitHub Pages is published from `main` root.

## Next known improvement
Improve unit input usability on mobile:
- selecting/focusing the unit input should select all text
- add +/- controls to increment/decrement units by 1
- decrement must not go below 0
- after changes, recalc and save state
