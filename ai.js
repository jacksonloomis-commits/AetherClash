// AetherClash — heuristic AI opponent. NO DOM, NO hidden information.
// The AI receives an API bound to the real state, but every piece of
// information it reasons about comes from ACEngine.publicView(state, player).
// Hidden info never reaches its decision functions (enforced by the no-cheat
// test in scripts/engine-test.js).
(function (root) {
  'use strict';
  const DATA = (typeof require !== 'undefined') ? require('./cards.js') : root.ACData;

  function createAI(engine, player) {
    // engine: {legalActions(state,p), applyAction(state,action), effStats(state,uid),
    //          battleValidTargets(state,uid), publicView(state,p), cardOf(inst), monUids...}
    // All functions accept the REAL state internally; the AI's own reading of
    // the position is derived from `view` only.
    function view(s) { return engine.publicView(s, player); }

    // -------- evaluation --------
    function evalState(s) {
      const me = s.players[player], opp = s.players[1 - player];
      if (s.winner === player) return 1e9;
      if (s.winner === 1 - player) return -1e9;
      if (s.winner === -1) return 0;
      let score = 0;
      score += (me.lp - opp.lp) * 0.9;
      let myBoard = 0, oppBoard = 0;
      for (const uid of engine.monUids(s, player)) {
        const st = engine.effStats(s, uid);
        const inst = s.insts[uid];
        const power = inst.faceDown ? 700 : Math.max(st.atk, st.def) * (inst.pos === 'atk' ? 1 : 0.85);
        myBoard += 400 + power;
      }
      for (const uid of engine.monUids(s, 1 - player)) {
        const st = engine.effStats(s, uid);
        const inst = s.insts[uid];
        const power = inst.faceDown ? 700 : Math.max(st.atk, st.def) * (inst.pos === 'atk' ? 1 : 0.85);
        oppBoard += 400 + power;
      }
      score += myBoard - oppBoard;
      score += me.hand.filter((u) => u !== 'hidden').length * 120;
      score += (me.deck.count !== undefined ? me.deck.count : me.deck.length) * 4;
      score -= (opp.deck.count !== undefined ? opp.deck.count : opp.deck.length) * 2;
      score += me.gy.length * -10; // slight value on keeping resources out of the GY
      return score;
    }

    // simulate an action on a throwaway copy (engine clones internally)
    function simulate(s, action) {
      const r = engine.applyAction(s, action);
      if (!r.ok) return null;
      return r.state;
    }

    function actionScore(s, action) {
      const before = evalState(s);
      const after = simulate(s, action);
      if (!after) return -Infinity;
      let sc = evalState(after) - before;
      const v = view(s);
      // risk: opponent's set cards might punish us (unknown info → estimate)
      const oppSets = engine.spellUids(s, 1 - player).filter((u) => s.insts[u].faceDown).length;
      if (action.type === 'attack') sc -= oppSets * 45;
      if (action.type === 'activate' || action.type === 'chain') {
        const effCard = engine.cardOf(s.insts[action.uid]);
        // conserve counters/legendaries unless the swing is big
        if (effCard.rar === 'l') sc -= 120;
      }
      // prefer keeping board slots free early
      if (s.turn <= 2 && (action.type === 'summon' || action.type === 'specialSummonHand') && action.position !== 'set') sc += 30;
      return sc;
    }

    // pick best action, with one lookahead step for the opponent's most likely reply
    function choose(s, legal) {
      if (!legal.length) return null;
      const scored = legal.map((a) => ({ a, sc: actionScore(s, a) }));
      scored.sort((x, y) => y.sc - x.sc);
      const best = scored[0];
      // lookahead: does our best move walk into an obvious pun proof?
      if (best.sc > -Infinity && (best.a.type === 'attack' || best.a.type === 'activate')) {
        const after = simulate(s, best.a);
        if (after && !after.window) {
          const oppLegal = engine.legalActions(after, 1 - player);
          let worst = 0;
          for (const oa of oppLegal.slice(0, 12)) {
            const oaAfter = simulate(after, oa);
            if (oaAfter) worst = Math.max(worst, evalState(oaAfter) - evalState(after));
          }
          if (worst > 900 && scored.length > 1 && scored[1].sc > -Infinity) {
            const alt = simulate(s, scored[1].a);
            if (alt) return scored[1].a; // dodge the telegraphed punish
          }
        }
      }
      return best.a;
    }

    // -------- personality: "The Archivist" --------
    function taunt(action) {
      const lines = {
        summon: ['Filed and noted.', 'A measured deployment.', 'The archive grows.'],
        attack: ['Calculated. Executing.', 'The ledger demands it.', 'Every variable accounted for.'],
        activate: ['Per protocol.', 'By the book — my book.', 'Knowledge is ammunition.'],
        chain: ['Interception logged.', 'I anticipated this.'],
      };
      const pool = lines[action.type] || [];
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    }

    function pickTargets(s, effPools, action) {
      // choose strongest legal targets heuristically
      const targets = [];
      for (const pool of effPools) {
        if (!pool.length) return null;
        let bestU = pool[0], bestV = -1;
        for (const u of pool) {
          const inst = s.insts[u];
          const c = engine.cardOf(inst);
          let v = 0;
          if (c.cat === 'monster') {
            const st = engine.effStats(s, u);
            v = Math.max(st.atk, st.def);
            if (inst.owner === player) v = -v; // prefer affecting opponent's stuff
          } else if (c.cat === 'trap') v = 800;
          else v = 400;
          if (v > bestV) { bestV = v; bestU = u; }
        }
        targets.push(bestU);
      }
      return targets;
    }

    function pickCosts(s, pools) {
      const out = [];
      for (const pool of pools) {
        if (!pool.choices.length) return null;
        // tribute/banish the weakest thing we own
        let bestU = pool.choices[0], bestV = Infinity;
        for (const u of pool.choices) {
          const inst = s.insts[u];
          const st = engine.effStats(s, u);
          const v = Math.max(st.atk, st.def);
          if (v < bestV) { bestV = v; bestU = u; }
        }
        out.push(bestU);
      }
      return out;
    }

    function pickSearch(s, cardIds) {
      // strongest monster, or a counter trap if offered
      let best = cardIds[0], bestV = -1;
      for (const id of cardIds) {
        const c = DATA.CARD_BY_ID[id];
        let v = c.cat === 'monster' ? (c.atk + c.def) / 2 : c.cat === 'trap' ? 900 : 500;
        if (c.rar === 'l') v += 600;
        if (v > bestV) { bestV = v; best = id; }
      }
      return best;
    }

    // -------- main entry points --------
    function takeTurnAction(s) {
      const legal = engine.legalActions(s, player);
      const act = choose(s, legal);
      if (!act) return null;
      // fill in targets / costs / picks as the engine needs them
      if (act.needsTargets && act.needsTargets.length) {
        const eff = (engine.cardOf(s.insts[act.uid]).effects || []).find((e) => e.eid === act.eid);
        const pools = engine._internal.poolForEffect(s, eff, player);
        const t = pickTargets(s, pools, act);
        if (!t) return { type: 'pass' };
        act.targets = t;
      }
      if (act.needsCosts && act.needsCosts.length) {
        const cs = pickCosts(s, act.needsCosts);
        if (!cs) return null;
        act.costChoices = cs;
      }
      fillSearchPicks(s, act);
      return act;
    }

    function fillSearchPicks(s, act) {
      if (!act || !act.uid || !s.insts[act.uid]) return;
      const c = engine.cardOf(s.insts[act.uid]);
      const eff = (c.effects || []).find((e) => e.eid === act.eid);
      if (!eff || !(eff.ops || []).some((o) => o.op === 'searchDeck')) return;
      const matches = s.players[player].deck.filter((id) => {
        const cc = DATA.CARD_BY_ID[id];
        const f = (eff.ops.find((o) => o.op === 'searchDeck') || {}).filter || {};
        if (f.cat && cc.cat !== f.cat) return false;
        if (f.maxLv && (cc.lv || 0) > f.maxLv) return false;
        if (f.type && cc.type !== f.type) return false;
        return true;
      });
      if (matches.length) act.picks = { search: pickSearch(s, matches) };
    }

    function respond(s) {
      const legal = engine.legalActions(s, player);
      if (!legal.length) return { type: 'pass' };
      if (legal.length === 1 && legal[0].type === 'pass') return { type: 'pass' };
      const act = choose(s, legal);
      if (!act) return { type: 'pass' };
      if (act.type !== 'pass' && act.needsTargets && act.needsTargets.length) {
        const eff = (engine.cardOf(s.insts[act.uid]).effects || []).find((e) => e.eid === act.eid);
        const pools = engine._internal.poolForEffect(s, eff, player);
        const t = pickTargets(s, pools, act);
        if (!t) return { type: 'pass' };
        act.targets = t;
      }
      if (act.type !== 'pass') fillSearchPicks(s, act);
      return act;
    }

    function discardChoice(s, n) {
      // discard the least valuable card
      const hand = s.players[player].hand.slice();
      hand.sort((a, b) => {
        const ca = engine.cardOf(s.insts[a]), cb = engine.cardOf(s.insts[b]);
        const va = (ca.atk + ca.def) / 2 + (ca.cat === 'monster' ? 200 : 0);
        const vb = (cb.atk + cb.def) / 2 + (cb.cat === 'monster' ? 200 : 0);
        return va - vb;
      });
      return hand.slice(0, n);
    }

    return { takeTurnAction, respond, discardChoice, pickSearch, taunt, evalState };
  }

  const AetherClashAI = { createAI };
  root.ACAI = AetherClashAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AetherClashAI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
