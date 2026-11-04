// Scratch smoke test: AI vs AI full duels. Finds engine flow bugs early.
const AC = require('../engine.js');
const AI = require('../ai.js');
const DATA = require('../cards.js');

function playGame(seed, maxTurns = 120) {
  let s = AC.startDuel(DATA.expandDeck(DATA.STARTER_DECK), DATA.expandDeck(DATA.AI_DECK), { seed });
  const ai0 = AI.createAI(AC, 0);
  const ai1 = AI.createAI(AC, 1);
  let turns = 0, actions = 0;
  while (s.winner === null && turns < maxTurns && actions < 600) {
    const p = s.active;
    const ai = p === 0 ? ai0 : ai1;
    let act = s.window ? ai.respond(s) : ai.takeTurnAction(s);
    if (!act) { console.log(`seed ${seed}: AI p${p} returned null — stuck. phase=${s.phase} window=${!!s.window} log tail:`, s.log.slice(-4)); return { seed, stuck: true, turn: s.turn }; }
    // fill discard choices when the engine asks the AI to choose discards
    if (act.type === 'chain' || act.type === 'activate') { /* picks handled inside ai */ }
    const r = AC.applyAction(s, act);
    if (!r.ok) { console.log(`seed ${seed}: AI p${p} illegal action ${JSON.stringify(act).slice(0, 120)} — ${r.error}`); return { seed, illegal: true, turn: s.turn }; }
    s = r.state;
    actions++;
    if (act.type === 'endTurn' || act.type === 'endPhase') turns += 0;
    if (s.turn > turns) turns = s.turn;
  }
  return { seed, winner: s.winner, reason: s.winReason, turns: s.turn, actions };
}

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
let bad = 0;
for (const seed of seeds) {
  const r = playGame(seed);
  console.log(JSON.stringify(r));
  if (r.stuck || r.illegal) bad++;
}
console.log(bad ? `${bad} problem games` : 'all smoke games completed');
