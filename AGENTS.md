# AGENTS.md

Rules for every agent and human working on AetherClash. Read this first, every session.

## The project
- Original strategy card game by Loomis (`jacksonloomis-commits`). Static browser game: no build step, no backend.
- `cards.js`: card data only. `engine.js`: pure rules engine (no DOM). `ai.js`: AI (no DOM). `app.js`: UI.
- Tests run the engine headlessly in Node: `npm test` must pass before every push to `main`. Do not push broken code.

## House rules
- Keep the engine pure: no `document`, `window` or `localStorage` in `engine.js`, `cards.js` or `ai.js`.
- Card effects are structured data interpreted by the engine — never hardcode a card's logic inside the engine.
- The AI must never read hidden information (opponent hand, face-down cards it did not place, either deck order).
- Bump `?v=` cache-bust strings in `index.html` whenever `cards.js`, `engine.js`, `ai.js`, `app.js` or `styles.css` change.
- Keep `README.md` and `AGENTS.md` current in the same commit as the change.
