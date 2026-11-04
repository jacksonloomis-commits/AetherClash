# AetherClash

An original **strategic collectible card game** — playable browser prototype (beta preview).

Command the rift: summon monsters, cast spells, spring traps, and build **response chains** against the Archivist, a heuristic AI opponent that plays by exactly the same rules you do — and never peeks at your hand.

## Play

Open the site (GitHub Pages) and press **DUEL**. Everything unlocks through play: wins earn XP (levels grant packs), wins also grant packs + shards, and duplicates convert into shards for crafting. No purchases, no accounts, no server — progress saves to your browser.

## The game

- 8,000 Life Points · 40-card decks · 5 monster + 5 spell/trap zones per player
- One Normal Summon per turn; Tribute Summons for level 5+ monsters; Special Summons via card effects
- Draw → Main 1 → Battle → Main 2 → End phases; ATK/DEF positions, set monsters, flip effects
- **Real chain system**: spell speeds (1/2/3), alternating response windows, LIFO resolution, negation, counter traps, fizzling when targets vanish, once-per-turn / once-per-duel limits
- **53 original cards** — every effect is implemented game logic (structured effect definitions interpreted by the engine), not flavor text: auras, triggers, quick effects, counters, graveyard and banish effects, taunt redirection, ATK copying, tribute economy, attack locks
- Deck builder (3 save slots, legality validation), collection with search/filters, pack opening with published odds, crafting
- Practice mode with a card-tester debug bar (free card access, LP control, hand reveal)

## Engineering

```
npm install   # zero dependencies — tests run on plain Node
npm start     # local play at http://localhost:8080
npm test      # rules-engine suite + AI smoke games (must pass before every push)
```

- `cards.js` — card data only · `engine.js` — pure rules engine (no DOM) · `ai.js` — AI (no hidden information) · `app.js` — UI
- The test suite verifies battle math, chain order, negation, targeting legality, once-per-turn locks, win conditions, state immutability on rejection, a no-cheat check on the AI's information barrier, and full AI-vs-AI matches.

See `AGENTS.md` for the development rules.
