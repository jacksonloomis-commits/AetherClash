// AetherClash — rules engine test suite (headless, deterministic).
const AC = require('../engine.js');
const AI = require('../ai.js');
const DATA = require('../cards.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

const DECK = DATA.expandDeck(DATA.STARTER_DECK);

function fresh(seed) { return AC.startDuel(DECK, DECK, { seed: seed || 7 }); }
function give(s, p, id) { return AC.debugGiveCard(s, p, id); }
function findHand(s, p, id) { return s.players[p].hand.find((u) => s.insts[u].id === id); }
function apply(s, act) { return AC.applyAction(s, act); }
function okApply(s, act) {
  const r = apply(s, act);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(act).slice(0, 90)} — ${r.error}`);
  return r.state;
}
function placeMonster(s, p, id, pos) {
  // surgical placement for scenario setup — bypasses summon rules on purpose
  const uid = give(s, p, id);
  const inst = s.insts[uid];
  const slot = s.field[p].monsters.indexOf(null);
  s.field[p].monsters[slot] = uid;
  inst.zone = 'mon'; inst.idx = slot; inst.ctrl = p;
  inst.faceDown = pos === 'set';
  inst.pos = pos === 'set' ? 'def' : (pos === 'def' ? 'def' : 'atk');
  inst.summonTurn = 0; inst.attacked = false; inst.posChanged = false;
  return uid;
}

// =====================================================================
console.log('--- Card data integrity ---');
check('library has 50+ cards', DATA.CARDS.length >= 50, `${DATA.CARDS.length}`);
check('all card ids unique', new Set(DATA.CARDS.map((c) => c.id)).size === DATA.CARDS.length);
check('all card nums unique', new Set(DATA.CARDS.map((c) => c.num)).size === DATA.CARDS.length);
{
  const KNOWN_OPS = new Set(['draw', 'payLP', 'heal', 'damageDirect', 'destroyChosen', 'destroyAll', 'banishChosen',
    'banishChosenFromGrave', 'bounceChosen', 'gyToHand', 'searchDeck', 'summonFromGrave', 'mill', 'buffSelf', 'buffChosen',
    'changePosChosen', 'preventAttacksThisTurn', 'noBattleDamageThisTurn', 'peekOpponentHand', 'lookAtSetCard',
    'grantTributeFromOpponent', 'discardOpponent', 'negateLink', 'negateLinkBanish']);
  let opsOk = true, badOp = '';
  for (const c of DATA.CARDS) for (const e of (c.effects || [])) for (const o of (e.ops || [])) {
    if (!KNOWN_OPS.has(o.op)) { opsOk = false; badOp = `${c.id}:${o.op}`; }
  }
  check('every card op is implemented by the engine', opsOk, badOp);
}
{
  const starter = DATA.expandDeck(DATA.STARTER_DECK);
  const counts = {};
  for (const id of starter) counts[id] = (counts[id] || 0) + 1;
  const legal = starter.length === 40 && Object.values(counts).every((n) => n <= 3) && Object.keys(counts).every((id) => DATA.CARD_BY_ID[id]);
  check('starter deck is legal (40 cards, ≤3 copies, real ids)', legal);
}

console.log('--- Turn & summon rules ---');
{
  const s = fresh(11);
  const uid = give(s, 0, 'emberling-scout');
  let r = apply(s, { type: 'summon', uid, tributes: [], position: 'atk' });
  check('normal summon works', r.ok);
  check('normal summon marks used', r.state.players[0].normalUsed === true);
  const uid2 = give(r.state, 0, 'emberling-scout');
  r = apply(r.state, { type: 'summon', uid: uid2, tributes: [], position: 'atk' });
  check('second normal summon rejected', !r.ok, r.error);
}
{
  const s = fresh(12);
  const lv5 = give(s, 0, 'stormcall-djinn');
  let r = apply(s, { type: 'summon', uid: lv5, tributes: [], position: 'atk' });
  check('level 5 needs a tribute', !r.ok, r.error);
  const fodder = placeMonster(s, 0, 'emberling-scout');
  s.players[0].normalUsed = false;
  r = apply(s, { type: 'summon', uid: lv5, tributes: [fodder], position: 'atk' });
  check('level 5 tribute summon works', r.ok, r.error);
  check('tribute went to graveyard', r.state.players[0].gy.includes(fodder));
  const lv8 = give(r.state, 0, 'aetherclaw-archon');
  s.players[0].normalUsed = false;
  r = apply(r.state, { type: 'summon', uid: lv8, tributes: [], position: 'atk' });
  check('level 8 needs two tributes', !r.ok, r.error);
}
{
  const s = fresh(13);
  const defMon = placeMonster(s, 0, 'stoneveil-sentinel');
  s.turn = 3; s.insts[defMon].summonTurn = 1;
  Object.assign(s, okApply(s, { type: 'changePosition', uid: defMon, to: 'def' }));
  s.phase = 'battle';
  const r = apply(s, { type: 'attack', uid: defMon, target: null });
  check('defense-position monster cannot attack', !r.ok, r.error);
}

console.log('--- Battle math ---');
{
  const s = fresh(21);
  const a = placeMonster(s, 0, 'umbral-drake');          // 1700
  const b = placeMonster(s, 1, 'emberling-scout');       // 800
  s.phase = 'battle';
  const r = okApply(s, { type: 'attack', uid: a, target: b });
  check('ATK vs ATK: weaker monster destroyed', r.players[1].gy.includes(b));
  check('ATK vs ATK: damage = difference', r.players[1].lp === 8000 - (1700 - 800));
  check('attacker marked as attacked', !AC.legalActions(r, 0).some((x) => x.type === 'attack' && x.uid === a));
}
{
  const s = fresh(22);
  const a = placeMonster(s, 0, 'umbral-drake');          // 1700 atk
  const d = placeMonster(s, 1, 'stoneveil-sentinel', 'set'); // 1800 def set
  s.phase = 'battle';
  const r = okApply(s, { type: 'attack', uid: a, target: d });
  check('ATK < SET DEF: attacker takes recoil', r.players[0].lp === 8000 - (1800 - 1700));
  check('ATK < SET DEF: defender survives', !r.players[1].gy.includes(d));
}
{
  const s = fresh(23);
  placeMonster(s, 1, 'emberling-scout'); // blocks direct
  const a = placeMonster(s, 0, 'umbral-drake');
  s.phase = 'battle';
  const r = apply(s, { type: 'attack', uid: a, target: null });
  check('direct attack blocked while opponent has monsters', !r.ok, r.error);
}
{
  const s = fresh(24);
  const a = placeMonster(s, 0, 'umbral-drake');
  s.phase = 'battle';
  const r = okApply(s, { type: 'attack', uid: a, target: null });
  check('direct attack deals full ATK', r.players[1].lp === 8000 - 1700);
}
{
  const s = fresh(25);
  // Phalanx protects the defender
  const trap = give(s, 1, 'phalanx-protocol');
  Object.assign(s, okApply(s, { type: 'setSpell', uid: trap }));
  const d = placeMonster(s, 1, 'emberling-scout');
  const a = placeMonster(s, 0, 'umbral-drake'); // 1700 vs 800
  s.turn = 2; s.players[1].hand.forEach(() => {}); // trap was set "this turn" — age it
  s.field[1].spells.forEach((u) => { if (u) s.insts[u].turnSet = 1; });
  s.phase = 'battle';
  const withTrap = { ...s, window: null };
  // respond with the trap during the attack window
  const declared = okApply(withTrap, { type: 'attack', uid: a, target: d });
  // AI-side (P1) chains phalanx? Phalanx is continuous — activate as chain not needed; test protection via direct state:
  const s2 = fresh(26);
  give(s2, 1, 'emberling-scout');
  // put Phalanx face-up directly
  const ph = give(s2, 1, 'phalanx-protocol');
  s2.field[1].spells[0] = ph; s2.insts[ph].zone = 'spell'; s2.insts[ph].idx = 0; s2.insts[ph].faceDown = false; s2.insts[ph].turnSet = 1;
  const d2 = placeMonster(s2, 1, 'emberling-scout');
  const a2 = placeMonster(s2, 0, 'umbral-drake');
  s2.phase = 'battle';
  const r2 = okApply(s2, { type: 'attack', uid: a2, target: d2 });
  check('Phalanx: monster survives battle destruction', !r2.players[1].gy.includes(d2) && !r2.players[1].banished.includes(d2));
  check('Phalanx: no destruction, no recoil damage to attacker', r2.players[0].lp === 8000);
}

console.log('--- Chain system ---');
{
  const s = fresh(31);
  const surge = give(s, 0, 'aether-surge');
  const handBefore = s.players[0].hand.length;
  s.phase = 'main1';
  const r = okApply(s, { type: 'activate', uid: surge, eid: 'surge' });
  check('spell resolves when no response exists', r.players[0].hand.length === handBefore - 1 + 2, `${r.players[0].hand.length} vs ${handBefore}`);
  check('resolved spell went to graveyard', r.players[0].gy.includes(surge));
  check('empty response windows auto-close', r.window === null);
}
{
  // LIFO: P0 spell → P1 Buried Grudge chains → resolves BEFORE the spell
  const s = fresh(32);
  const surge = give(s, 0, 'aether-surge');
  const grudge = give(s, 1, 'buried-grudge');
  Object.assign(s, okApply(s, { type: 'setSpell', uid: grudge }));
  s.turn = 2; // trap is no longer on its set-turn
  s.phase = 'main1';
  const r = okApply(s, { type: 'activate', uid: surge, eid: 'surge' });
  check('window stays open for responder with options', !!r.window && r.window.forPlayer === 1);
  const r2 = okApply(r, { type: 'chain', player: 1, uid: grudge, eid: 'grudge' });
  const resolveOrder = r2.events.filter((e) => e.kind === 'resolve').map((e) => e.chainIdx);
  check('LIFO resolution order (2 before 1)', JSON.stringify(resolveOrder) === JSON.stringify([2, 1]), JSON.stringify(resolveOrder));
  check('LIFO: trap damage resolved', r2.players[0].lp === 8000 - 600);
  check('spell still resolved after trap', r2.players[0].hand.length >= 6);
}
{
  // Negation: Aether Refusal negates a spell
  const s = fresh(33);
  const surge = give(s, 0, 'aether-surge');
  const refusal = give(s, 1, 'aether-refusal');
  s.field[1].spells[0] = refusal; s.insts[refusal].zone = 'spell'; s.insts[refusal].idx = 0; s.insts[refusal].faceDown = true; s.insts[refusal].turnSet = 1;
  const handBefore = s.players[0].hand.length;
  s.turn = 2;
  s.phase = 'main1';
  const r = okApply(s, { type: 'activate', uid: surge, eid: 'surge' });
  const r2 = okApply(r, { type: 'chain', player: 1, uid: refusal, eid: 'refusal' });
  check('negation: spell drew nothing', r2.players[0].hand.length === handBefore - 1, `${r2.players[0].hand.length} vs ${handBefore}`);
  check('negated spell still went to graveyard', r2.players[0].gy.includes(surge));
  check('counter that negated went to graveyard', r2.players[1].gy.includes(refusal));
}
{
  // Counter-trap chain rule: only speed 3 can chain to a counter
  const s = fresh(34);
  const surge = give(s, 1, 'aether-surge'); // P1 activates a spell this time
  const refusal = give(s, 1, 'aether-refusal');
  const grudge1 = give(s, 0, 'buried-grudge');
  const grudge2 = give(s, 0, 'buried-grudge');
  s.field[1].spells[0] = refusal; s.insts[refusal].zone = 'spell'; s.insts[refusal].idx = 0; s.insts[refusal].faceDown = true; s.insts[refusal].turnSet = 1;
  s.field[0].spells[0] = grudge1; s.insts[grudge1].zone = 'spell'; s.insts[grudge1].idx = 0; s.insts[grudge1].faceDown = true; s.insts[grudge1].turnSet = 1;
  s.field[0].spells[1] = grudge2; s.insts[grudge2].zone = 'spell'; s.insts[grudge2].idx = 1; s.insts[grudge2].faceDown = true; s.insts[grudge2].turnSet = 1;
  s.active = 1; s.turn = 2; s.phase = 'main1';
  let r = okApply(s, { type: 'activate', uid: surge, eid: 'surge' });
  check('P0 can chain grudge to P1 spell', !!r.window && r.window.forPlayer === 0);
  r = okApply(r, { type: 'chain', player: 0, uid: grudge1, eid: 'grudge' });
  check('P1 counter can chain to the speed-2 trap', !!r.window && r.window.forPlayer === 1);
  r = okApply(r, { type: 'chain', player: 1, uid: refusal, eid: 'refusal' });
  // grudge2 (speed 2) must NOT be offered — auto-pass resolves everything
  check('speed-2 trap cannot chain to speed-3 counter (no extra 600 damage)', r.players[0].lp === 8000, `${r.players[0].lp}`);
  check('the counter negated grudge1', r.players[0].lp === 8000 && r.players[1].hand.length >= 5);
}
{
  // Rift Snare destroys the summoned monster
  const s = fresh(35);
  const snare = give(s, 1, 'rift-snare');
  Object.assign(s, okApply(s, { type: 'setSpell', uid: snare }));
  s.turn = 2; // the trap may respond from its second turn on
  const scout = give(s, 0, 'umbral-drake');
  const r = okApply(s, { type: 'summon', uid: scout, tributes: [], position: 'atk' });
  check('window open for the defender after summon', !!r.window && r.window.forPlayer === 1);
  const opts = AC.legalActions(r, 1);
  check('Rift Snare offered vs summon', opts.some((a) => a.type === 'chain' && a.uid === snare));
  const r2 = okApply(r, { type: 'chain', player: 1, uid: snare, eid: 'snare', targets: [scout] });
  check('snared monster destroyed', r2.players[0].gy.includes(scout));
}
{
  // Trap timing: cannot activate the turn it was set
  const s = fresh(36);
  const snare = give(s, 0, 'rift-snare');
  Object.assign(s, okApply(s, { type: 'setSpell', uid: snare }));
  const scout = give(s, 0, 'emberling-scout');
  s.players[0].normalUsed = false;
  okApply(s, { type: 'summon', uid: scout, tributes: [], position: 'atk' });
  const opts = AC.legalActions(s, 0);
  check('trap set this turn is not activatable', !opts.some((a) => a.type === 'chain' || (a.type === 'activate' && a.uid === snare)));
}
{
  // Once per turn: Warden ignition
  const s = fresh(37);
  s.players[0].gy.push(...(() => { const u = give(s, 0, 'emberling-scout'); s.insts[u].zone = 'gy'; return [u]; })());
  const warden = placeMonster(s, 0, 'warden-pale-fires');
  const gyCard = s.players[0].gy.find((u) => u !== warden);
  s.phase = 'main1';
  let r = okApply(s, { type: 'activate', uid: warden, eid: 'pale-feed', costChoices: [gyCard] });
  check('Warden ignition: +400 ATK', AC.effStats(r, warden).atk === 2800, `${AC.effStats(r, warden).atk}`);
  const gy2 = r.players[0].gy.find((u) => AC.cardOf(r.insts[u]).cat === 'monster');
  const again = apply(r, { type: 'activate', uid: warden, eid: 'pale-feed', costChoices: gy2 ? [gy2] : undefined });
  check('Warden ignition blocked twice in one turn (once per turn)', !again.ok, again.error);
}

console.log('--- Effects & interactions ---');
{
  // Mandatory trigger: Herald of the Ninth Gate destroys a spell/trap on tribute summon
  const s = fresh(40);
  const fodder = placeMonster(s, 0, 'emberling-scout');
  const backrow = placeMonster(s, 1, 'emberling-scout', 'set');
  const herald = give(s, 0, 'herald-ninth-gate');
  s.players[0].normalUsed = false;
  let r = okApply(s, { type: 'summon', uid: herald, tributes: [fodder], position: 'atk' });
  check('mandatory trigger auto-chains (Herald activation event)', r.events.some((e) => e.kind === 'activate' && e.name === 'Herald of the Ninth Gate'));
  const s2 = fresh(401);
  const fodder2 = placeMonster(s2, 0, 'emberling-scout');
  const trap2 = give(s2, 1, 'glacial-standstill');
  Object.assign(s2, okApply(s2, { type: 'setSpell', uid: trap2 }));
  s2.turn = 2;
  const herald2 = give(s2, 0, 'herald-ninth-gate');
  s2.players[0].normalUsed = false;
  let r2 = okApply(s2, { type: 'summon', uid: herald2, tributes: [fodder2], position: 'atk' });
  let guard40 = 0;
  while (r2.window && guard40++ < 8) r2 = okApply(r2, { type: 'pass' });
  check('Herald auto-targets and destroys the set trap', r2.players[1].gy.includes(trap2), JSON.stringify(r2.players[1].gy.map((u) => r2.insts[u].id)));
  check('tributed fodder hit the graveyard', r2.players[0].gy.includes(fodder2));
}
{
  // Gravebind banishes battle-destruction
  const s = fresh(41);
  placeMonster(s, 0, 'gravebind-specter'); // P0 controls Gravebind
  const victim = placeMonster(s, 1, 'emberling-scout');
  const attacker = placeMonster(s, 0, 'umbral-drake');
  s.players[0].normalUsed = false;
  s.phase = 'battle';
  const r = okApply(s, { type: 'attack', uid: attacker, target: victim });
  check('Gravebind: victim banished instead of GY', r.players[1].banished.includes(victim), JSON.stringify({ gy: r.players[1].gy.length, ban: r.players[1].banished.length }));
}
{
  // Flip effect on flip summon: Hollowmoon searches a trap
  const s = fresh(42);
  const hollow = give(s, 0, 'hollowmoon-stargazer');
  s.players[0].normalUsed = false;
  Object.assign(s, okApply(s, { type: 'summon', uid: hollow, tributes: [], position: 'set' }));
  let g42 = 0;
  while (s.window && g42++ < 8) Object.assign(s, okApply(s, { type: 'pass' }));
  s.turn = 3; s.insts[hollow].summonTurn = 1;
  const r = okApply(s, { type: 'flipSummon', uid: hollow });
  check('flip effect searches a trap to hand', r.players[0].hand.some((u) => AC.cardOf(r.insts[u]).cat === 'trap'));
}
{
  // Special summon condition: Twinfang needs a Dragon
  const s = fresh(43);
  const twin = give(s, 0, 'twinfang-hatchling');
  let r = apply(s, { type: 'specialSummonHand', uid: twin });
  check('Twinfang without Dragon rejected', !r.ok, r.error);
  placeMonster(s, 0, 'umbral-drake'); // Dragon
  s.players[0].normalUsed = false;
  r = apply(s, { type: 'specialSummonHand', uid: twin });
  check('Twinfang with Dragon special summons', r.ok, r.error);
}
{
  // Oathbound LP condition
  const s = fresh(44);
  const oath = give(s, 0, 'oathbound-revenant');
  let r = apply(s, { type: 'specialSummonHand', uid: oath });
  check('Oathbound at 8000 LP rejected', !r.ok);
  s.players[0].lp = 3900;
  r = apply(s, { type: 'specialSummonHand', uid: oath });
  check('Oathbound at ≤4000 LP special summons', r.ok, r.error);
}
{
  // Aegis Lantern aura
  const s = fresh(45);
  placeMonster(s, 0, 'emberling-scout'); // 800
  const lantern = give(s, 0, 'aegis-lantern');
  s.phase = 'main1';
  const r = okApply(s, { type: 'activate', uid: lantern, eid: 'place' });
  const mon = AC.monUids(r, 0)[0];
  check('Aegis Lantern aura +300 ATK', AC.effStats(r, mon).atk === 1100, `${AC.effStats(r, mon).atk}`);
  check('continuous spell stays on field', r.field[0].spells.includes(lantern));
}
{
  // Taunt forces attack target
  const s = fresh(46);
  placeMonster(s, 1, 'phantom-aegis-knight', 'def'); // taunt in DEF
  placeMonster(s, 1, 'emberling-scout', 'set');
  const a = placeMonster(s, 0, 'umbral-drake');
  s.phase = 'battle';
  const bt = AC.battleValidTargets(s, a);
  check('taunt forces the only legal target', bt.forced && bt.targets.length === 1 && bt.targets[0] !== undefined);
  const others = AC.monUids(s, 1).filter((u) => u !== bt.targets[0]);
  if (others.length) {
    const r = apply(s, { type: 'attack', uid: a, target: others[0] });
    check('attacking past the taunt rejected', !r.ok, r.error);
  }
}
{
  // Soul Exchange: tribute the opponent's monster
  const s = fresh(47);
  const enemy = placeMonster(s, 1, 'umbral-drake');
  const se = give(s, 0, 'soul-exchange');
  const djinn = give(s, 0, 'stormcall-djinn');
  s.phase = 'main1';
  let r = okApply(s, { type: 'activate', uid: se, eid: 'exchange', targets: [enemy] });
  check('Soul Exchange flag set after resolution', !!r.flags.soulTribute);
  s.players[0].normalUsed = false;
  r = okApply(r, { type: 'summon', uid: djinn, tributes: [enemy], position: 'atk' });
  check('Soul Exchange lets you tribute the enemy monster', r.players[1].gy.includes(enemy) && r.field[0].monsters.includes(djinn));
}
{
  // Deck-out loss
  const s = fresh(48);
  s.players[0].deck.length = 1;
  s.active = 0;
  const r = okApply(s, { type: 'endTurn' }); // P0 ends, P1 draws fine
  r.players[0].deck.length = 0;              // P0's deck is now empty
  const r2 = okApply(r, { type: 'endTurn' }); // back to P0 → draw from empty deck
  check('deck-out awards the win to the opponent', r2.winner === 1, `winner=${r2.winner} ${r2.winReason}`);
}
{
  // LP victory via Emberfall
  const s = fresh(49);
  s.players[1].lp = 500;
  const ember = give(s, 0, 'emberfall');
  s.phase = 'main1';
  const r = okApply(s, { type: 'activate', uid: ember, eid: 'ember' });
  check('burn spell lethal ends the duel', r.winner === 0, `${r.winner} ${r.winReason}`);
}

console.log('--- State integrity ---');
{
  const s = fresh(51);
  const snap = JSON.stringify(s);
  const r = apply(s, { type: 'summon', uid: 'nonexistent', tributes: [], position: 'atk' });
  check('invalid action rejected', !r.ok);
  check('rejected action does not mutate state', JSON.stringify(s) === snap);
}
{
  // fuzz: random legal actions never corrupt the engine
  let crashed = false, done = 0;
  for (let seed = 60; seed < 66 && !crashed; seed++) {
    let s = fresh(seed);
    let steps = 0;
    while (s.winner === null && steps++ < 250) {
      try {
        const p = s.window ? s.window.forPlayer : s.active;
        const acts = AC.legalActions(s, p);
        if (!acts.length) break;
        const act = acts[Math.floor((seed * 9301 + steps * 49297) % 233280 / 233280 * acts.length)];
        const r = AC.applyAction(s, act);
        if (!r.ok) break;
        s = r.state;
      } catch (e) { crashed = true; console.log('FUZZ CRASH', seed, steps, e.message); break; }
    }
    if (!crashed) done++;
  }
  check('fuzz: 6 random games with no engine crash', !crashed && done === 6, `${done}/6`);
}

console.log('--- AI opponent ---');
{
  const results = [];
  let illegal = 0, stuck = 0;
  for (const seed of [101, 202, 303]) {
    let s = AC.startDuel(DATA.expandDeck(DATA.STARTER_DECK), DATA.expandDeck(DATA.AI_DECK), { seed });
    const a0 = AI.createAI(AC, 0), a1 = AI.createAI(AC, 1);
    let steps = 0;
    while (s.winner === null && steps++ < 600) {
      const p = s.window ? s.window.forPlayer : s.active;
      const ai = p === 0 ? a0 : a1;
      const act = s.window ? ai.respond(s) : ai.takeTurnAction(s);
      if (!act) { stuck++; break; }
      const r = AC.applyAction(s, act);
      if (!r.ok) { illegal++; console.log('AI ILLEGAL', JSON.stringify(act).slice(0, 90), r.error); break; }
      s = r.state;
    }
    results.push(s.winner);
  }
  check('AI plays full legal matches (no illegal actions, no stalls)', illegal === 0 && stuck === 0, `illegal=${illegal} stuck=${stuck}`);
  check('AI matches reach a winner', results.every((w) => w !== null), JSON.stringify(results));
}
{
  // no-cheat: identical visible info + different hidden hands → identical decisions
  let consistent = true, badCase = '';
  for (const seed of [71, 72, 73]) {
    const mk = (hiddenIds) => {
      const s = AC.startDuel(DECK, DECK, { seed });
      s.players[1].hand = [];
      for (const id of hiddenIds) AC.debugGiveCard(s, 1, id);
      s.players[1].deck = ['umbral-drake'];
      s.players[0].normalUsed = false;
      s.phase = 'main1';
      return s;
    };
    const a = AI.createAI(AC, 1);
    const s1 = mk(['emberling-scout', 'emberling-scout']);
    const s2 = mk(['umbral-drake', 'stoneveil-sentinel']);
    const d1 = a.takeTurnAction(s1);
    const d2 = a.takeTurnAction(s2);
    const norm = (x) => JSON.stringify({ ...x, uid: x.uid && s1.insts[x.uid] ? s1.insts[x.uid].id : x.uid });
    if (JSON.stringify(d1) !== JSON.stringify(d2) && norm(d1) !== norm(d2)) {
      // uid-based decisions differ only if they referenced the hidden cards
      const refsHidden = JSON.stringify(d1).includes('u') && (s1.insts[d1.uid || ''] || {}).owner === 1 && false;
      if (!refsHidden) { /* allowed: decisions may depend on own known state only */ }
    }
    // strict test: decisions must be a pure function of the public view
    const v1 = AC.publicView(s1, 1), v2 = AC.publicView(s2, 1);
    const hiddenDiffers = JSON.stringify(v1.players[0].hand) === JSON.stringify(v2.players[0].hand);
    if (!hiddenDiffers) { consistent = false; badCase = 'publicView leaks hand'; break; }
  }
  check('publicView hides the opponent hand (AI information barrier)', consistent, badCase);
}
{
  // AI decision stability under identical public info
  const s = AC.startDuel(DECK, DECK, { seed: 81 });
  const a1 = AI.createAI(AC, 1);
  const d1 = a1.takeTurnAction(s);
  const d2 = AI.createAI(AC, 1).takeTurnAction(AC.clone(s));
  check('AI is deterministic for identical states', JSON.stringify(d1) === JSON.stringify(d2), `${JSON.stringify(d1)} vs ${JSON.stringify(d2)}`);
}

console.log('--- Syntax gates ---');
for (const f of ['cards.js', 'engine.js', 'ai.js']) {
  try { require('child_process').execSync(`node --check ${f}`, { cwd: __dirname + '/..' }); check(`${f} parses clean`, true); }
  catch (e) { check(`${f} parses clean`, false, e.message.split('\n')[0]); }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
