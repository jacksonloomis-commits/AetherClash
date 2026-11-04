// AetherClash — pure rules engine. NO DOM here (see AGENTS.md).
// Structured card definitions in cards.js are interpreted by this engine.
// Deliberate simplifications (documented):
//  - Response windows open at every activation, attack declaration, and after
//    battle destruction / GY arrivals. Damage calculation itself is atomic.
//  - Effects spawned while a chain resolves queue as new windows after the
//    current chain finishes (no mid-resolution chaining).
//  - Mandatory monster triggers auto-chain with auto-picked targets; traps are
//    always their owner's choice.
//  - Auras only affect face-up monsters.
(function (root) {
  'use strict';
  const DATA = (typeof require !== 'undefined') ? require('./cards.js') : root.ACData;

  // ------------------------------ RNG ------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const cardOf = (inst) => DATA.CARD_BY_ID[inst.id];

  // ------------------------------ Duel setup ------------------------------
  function startDuel(deckA, deckB, opts = {}) {
    const seed = (opts.seed !== undefined) ? opts.seed : Math.floor(Math.random() * 2147483647);
    const rng = mulberry32(seed);
    const s = {
      seed, _rngState: seed,
      turn: 1, phase: 'main1', active: 0, firstTurn: true,
      players: [
        { lp: DATA.START_LP, deck: shuffle(deckA.slice(), rng), hand: [], gy: [], banished: [], normalUsed: false },
        { lp: DATA.START_LP, deck: shuffle(deckB.slice(), rng), hand: [], gy: [], banished: [], normalUsed: false },
      ],
      field: [{ monsters: [null, null, null, null, null], spells: [null, null, null, null, null] },
              { monsters: [null, null, null, null, null], spells: [null, null, null, null, null] }],
      insts: {}, nextUid: 1,
      chain: [], window: null,
      flags: { attacksPrevented: false, noBattleDamage: false, soulTribute: null, pendingBattle: null },
      chainCountResolved: 0, log: [], events: [],
      winner: null, winReason: null,
    };
    for (let p = 0; p < 2; p++) for (let i = 0; i < 5; i++) drawCard(s, p, true);
    log(s, `Duel begins — P0 acts first (seed ${seed}).`);
    pushEvent(s, { kind: 'duelStart' });
    return s;
  }

  function log(s, msg) { s.log.push(`T${s.turn} ${msg}`); if (s.log.length > 500) s.log.shift(); }
  function pushEvent(s, ev) { s.events.push(ev); if (s.events.length > 900) s.events.shift(); }

  // ------------------------------ Cards & zones ------------------------------
  function makeInst(s, cardId, owner) {
    const uid = `u${s.nextUid++}`;
    s.insts[uid] = {
      uid, id: cardId, owner, ctrl: owner, zone: 'deck', idx: -1,
      faceDown: false, pos: 'atk', turnSet: s.turn, summonTurn: s.turn,
      posChanged: false, attacked: false, negated: false,
      baseAtkDelta: 0, baseDefDelta: 0, tempBuffs: [], onceUsed: {},
    };
    return s.insts[uid];
  }

  function drawCard(s, p, silent) {
    const P = s.players[p];
    if (!P.deck.length) { win(s, 1 - p, 'deck-out'); return null; }
    const cardId = P.deck.shift();
    const inst = makeInst(s, cardId, p);
    inst.zone = 'hand';
    P.hand.push(inst.uid);
    if (!silent) { log(s, `P${p} draws a card.`); pushEvent(s, { kind: 'draw', player: p }); }
    return inst.uid;
  }

  function moveTo(s, uid, zone, opts = {}) {
    const inst = s.insts[uid];
    const P = s.players[inst.ctrl];
    if (inst.zone === 'hand') P.hand = P.hand.filter((u) => u !== uid);
    if (inst.zone === 'mon') s.field[inst.ctrl].monsters[inst.idx] = null;
    if (inst.zone === 'spell') s.field[inst.ctrl].spells[inst.idx] = null;
    inst.zone = '_moving'; inst.idx = -1;
    if (zone === 'gy') { P.gy.push(uid); inst.faceDown = false; inst.zone = 'gy'; }
    else if (zone === 'banish') { P.banished.push(uid); inst.faceDown = false; inst.zone = 'banish'; }
    else if (zone === 'hand') { P.hand.push(uid); inst.zone = 'hand'; }
    else if (zone === 'mon') {
      const ctl = opts.ctrl !== undefined ? opts.ctrl : inst.ctrl;
      inst.ctrl = ctl;
      const f = s.field[ctl];
      const slot = opts.idx !== undefined ? opts.idx : f.monsters.indexOf(null);
      f.monsters[slot] = uid;
      inst.idx = slot; inst.zone = 'mon';
      inst.attacked = false; inst.posChanged = false;
      if (opts.faceDown) { inst.faceDown = true; inst.pos = 'def'; }
      else if (opts.pos) { inst.faceDown = false; inst.pos = opts.pos; }
      if (opts.resetSummon) inst.summonTurn = s.turn;
    }
    else if (zone === 'spell') {
      const ctl = opts.ctrl !== undefined ? opts.ctrl : inst.ctrl;
      inst.ctrl = ctl;
      const f = s.field[ctl];
      const slot = opts.idx !== undefined ? opts.idx : f.spells.indexOf(null);
      f.spells[slot] = uid;
      inst.idx = slot; inst.zone = 'spell';
      inst.turnSet = s.turn;
      inst.faceDown = !!opts.faceDown;
    }
    return inst;
  }

  function monUids(s, p, opts = {}) {
    return s.field[p].monsters.filter(Boolean).filter((u) => !(opts.faceUp && s.insts[u].faceDown));
  }
  function spellUids(s, p) { return s.field[p].spells.filter(Boolean); }

  function win(s, p, reason) {
    if (s.winner !== null) return;
    s.winner = p; s.winReason = reason;
    log(s, `P${p} wins — ${reason}.`);
    pushEvent(s, { kind: 'win', player: p, reason });
  }
  function checkWin(s) {
    if (s.winner !== null) return true;
    if (s.players[0].lp <= 0 && s.players[1].lp <= 0) { win(s, -1, 'mutual destruction'); return true; }
    if (s.players[0].lp <= 0) { win(s, 1, 'life points depleted'); return true; }
    if (s.players[1].lp <= 0) { win(s, 0, 'life points depleted'); return true; }
    return false;
  }
  function lpEvent(s, p, delta) {
    pushEvent(s, { kind: 'lp', player: p, delta, lp: s.players[p].lp });
    checkWin(s);
  }

  // ------------------------------ Passives & stats ------------------------------
  function activeContinuous(s) {
    const out = [];
    for (let p = 0; p < 2; p++) {
      for (const uid of spellUids(s, p)) if (!s.insts[uid].faceDown) out.push(s.insts[uid]);
      for (const uid of monUids(s, p, { faceUp: true })) if (cardOf(s.insts[uid]).passive) out.push(s.insts[uid]);
    }
    return out;
  }

  function effStats(s, uid) {
    const inst = s.insts[uid];
    const c = cardOf(inst);
    let atk = c.atk + inst.baseAtkDelta;
    let def = c.def + inst.baseDefDelta;
    for (const b of inst.tempBuffs) { atk += b.atk || 0; def += b.def || 0; }
    if (!inst.faceDown) {
      for (const src of activeContinuous(s)) {
        const pc = cardOf(src).passive || {};
        if (pc.auraOwn && src.ctrl === inst.ctrl) {
          if (pc.auraOwn.onlyDefPosition && inst.pos !== 'def') continue;
          atk += pc.auraOwn.atk || 0; def += pc.auraOwn.def || 0;
        }
        if (pc.auraAll) {
          if (pc.auraAll.faceUpOnly && inst.faceDown) continue;
          atk += pc.auraAll.atk || 0; def += pc.auraAll.def || 0;
        }
      }
    }
    return { atk: Math.max(0, atk), def: Math.max(0, def) };
  }

  function passivesFor(s) {
    const acc = { taunt: [], lockAttack: [], ownNoBattleDestroy: [], banishBattle: [], calcCopy: [], tributeDraw: 0 };
    for (const src of activeContinuous(s)) {
      const pc = cardOf(src).passive || {};
      if (pc.taunt) acc.taunt.push(src.uid);
      if (pc.lockAttack) acc.lockAttack.push(src);
      if (pc.ownMonstersNoBattleDestroy) acc.ownNoBattleDestroy.push(src.ctrl);
      if (pc.banishInsteadOfGYBattle) acc.banishBattle.push(src.ctrl);
      if (pc.damageCalcCopyOpponentAtk) acc.calcCopy.push(src);
      if (pc.onTributeSummonDraw) acc.tributeDraw += pc.onTributeSummonDraw;
    }
    return acc;
  }

  // ------------------------------ Targeting pools ------------------------------
  function poolUids(s, pool, ctx = {}) {
    const own = ctx.ctrl !== undefined ? ctx.ctrl : 0, opp = 1 - own;
    switch (pool) {
      case 'oppFaceUpMonsters': return monUids(s, opp, { faceUp: true });
      case 'oppMonsters': return monUids(s, opp);
      case 'ownFaceUpMonsters': return monUids(s, own, { faceUp: true });
      case 'anyFaceUpMonsters': return monUids(s, own, { faceUp: true }).concat(monUids(s, opp, { faceUp: true }));
      case 'anyMonsters': return monUids(s, own).concat(monUids(s, opp));
      case 'anySpellTraps': return spellUids(s, own).concat(spellUids(s, opp));
      case 'theSummonedMonster': {
        const u = ctx.summonedUid;
        return (u && s.insts[u] && s.insts[u].zone === 'mon') ? [u] : [];
      }
      case 'ownGraveMonsters': return s.players[own].gy.filter((u) => cardOf(s.insts[u]).cat === 'monster');
      case 'oppGraveAny': return s.players[opp].gy.slice();
      case 'anyFacedown': {
        const fd = [];
        for (let p = 0; p < 2; p++) {
          for (const u of monUids(s, p)) if (s.insts[u].faceDown) fd.push(u);
          for (const u of spellUids(s, p)) if (s.insts[u].faceDown) fd.push(u);
        }
        return fd;
      }
      default: return [];
    }
  }

  function filterPool(s, uids, filter = {}) {
    return uids.filter((u) => {
      const c = cardOf(s.insts[u]);
      if (filter.cat && c.cat !== filter.cat) return false;
      if (filter.maxLv && (c.lv || 0) > filter.maxLv) return false;
      if (filter.maxAtk && (c.atk || 0) > filter.maxAtk) return false;
      if (filter.type && c.type !== filter.type) return false;
      return true;
    });
  }

  function poolForEffect(s, eff, player, ctxOverride) {
    const ctx = ctxOverride || (s.window && s.window.ctx) || {};
    const out = [];
    for (const t of (eff.targeting || [])) {
      out.push(filterPool(s, poolUids(s, t.pool, { ctrl: player, summonedUid: ctx.summonedUid, attackUid: ctx.attackUid }), t.filter));
    }
    return out;
  }

  // ------------------------------ Effect legality ------------------------------
  function effectDef(card, eid) { return (card.effects || []).find((e) => e.eid === eid); }

  function canActivateEffect(s, uid, eid, player) {
    const inst = s.insts[uid];
    const c = cardOf(inst);
    const eff = effectDef(c, eid);
    if (!eff) return { ok: false, why: 'no such effect' };
    if (inst.negated) return { ok: false, why: 'effect negated' };
    if (eff.kind === 'passive' || eff.kind === 'continuous') return { ok: false, why: 'static effect' };
    if (eff.oncePerTurn && inst.onceUsed[eid] === s.turn) return { ok: false, why: 'once per turn used' };
    if (eff.oncePerDuel && inst.onceUsed[eid] === 'duel') return { ok: false, why: 'once per duel used' };
    if (eff.condition) {
      if (eff.condition.lpAtMost !== undefined && s.players[player].lp > eff.condition.lpAtMost) return { ok: false, why: 'condition not met' };
      if (eff.condition.controlType && !monUids(s, player, { faceUp: true }).some((u) => cardOf(s.insts[u]).type === eff.condition.controlType)) return { ok: false, why: 'condition not met' };
    }
    const inWindow = !!s.window;
    if (eff.kind === 'trigger' || eff.kind === 'counter') {
      if (!inWindow) return { ok: false, why: 'no window' };
      if (!triggerMatches(s, eff, s.window.ctx, inst, player)) return { ok: false, why: 'no matching window' };
    }
    if (eff.kind === 'ignition' || eff.kind === 'flip') {
      if (inWindow) return { ok: false, why: 'cannot start a chain now' };
      if (s.phase !== 'main1' && s.phase !== 'main2') return { ok: false, why: 'main phase only' };
      if (player !== s.active) return { ok: false, why: 'not your turn' };
    }
    if (c.cat === 'trap' && inst.zone === 'hand') return { ok: false, why: 'traps must be set first' };
    if (c.cat === 'trap' && inst.zone === 'spell' && inst.turnSet === s.turn) return { ok: false, why: 'trap set this turn' };
    if (c.cat === 'trap' && !inst.faceDown) return { ok: false, why: 'already active' };
    if (c.cat === 'monster' && inst.zone !== 'mon') return { ok: false, why: 'not on field' };
    if (c.cat === 'monster' && inst.faceDown && eff.kind !== 'flip') return { ok: false, why: 'face-down' };
    if (eff.cost) {
      for (const cost of eff.cost) {
        if (cost.op === 'payLP' && s.players[player].lp <= cost.n) return { ok: false, why: 'cannot pay LP' };
        if (cost.op === 'banishGrave') {
          const avail = s.players[player].gy.filter((u) => cost.kind === 'any' || cardOf(s.insts[u]).cat === cost.kind);
          if (avail.length < (cost.count || 1)) return { ok: false, why: 'no cost targets' };
        }
        if (cost.op === 'tributeOwn') {
          const avail = monUids(s, player).filter((u) => !(cost.excludeSelf && u === uid));
          if (avail.length < (cost.count || 1)) return { ok: false, why: 'no tribute targets' };
        }
      }
    }
    if (eff.targeting) {
      const pools = poolForEffect(s, eff, player);
      for (let i = 0; i < eff.targeting.length; i++) {
        if (pools[i].length < eff.targeting[i].count) return { ok: false, why: 'no valid targets' };
      }
    }
    return { ok: true };
  }

  function costTargetPools(s, player, eff, srcUid) {
    const out = [];
    for (const cost of eff.cost || []) {
      if (cost.op === 'banishGrave') out.push({ op: cost.op, choices: s.players[player].gy.filter((u) => cost.kind === 'any' || cardOf(s.insts[u]).cat === cost.kind) });
      else if (cost.op === 'tributeOwn') out.push({ op: cost.op, choices: monUids(s, player).filter((u) => !(cost.excludeSelf && u === srcUid)) });
      else if (cost.op === 'payLP') out.push({ op: cost.op, choices: [] });
    }
    return out;
  }

  // ------------------------------ Chain machine ------------------------------
  function pushLink(s, spec) {
    const { uid, eid, ctrl, targets, costs, picks, speed, event } = spec;
    const inst = s.insts[uid];
    const c = cardOf(inst);
    const eff = effectDef(c, eid);
    const link = {
      idx: s.chain.length, uid, eid, ctrl,
      targets: targets || [], costs: costs || {}, picks: picks || {},
      speed, cardName: c.name, cardId: c.id, kind: eff.kind, text: c.text,
      summonedUid: event && event.summonedUid, attackUid: event && event.attackUid,
      destroyedUid: event && event.destroyedUid, destroyedAtk: event && event.destroyedAtk,
      battleDamage: event && event.battleDamage, negated: false,
    };
    s.chain.push(link);
    if (eff.oncePerTurn) inst.onceUsed[eid] = s.turn;
    if (eff.oncePerDuel) inst.onceUsed[eid] = 'duel';
    if (c.cat === 'spell' && inst.zone === 'hand') moveTo(s, uid, 'spell', { faceDown: false });
    if (inst.zone === 'spell' && inst.faceDown) inst.faceDown = false;
    log(s, `P${ctrl} activates [${c.name}]${s.chain.length > 1 ? ` — Chain Link ${s.chain.length}` : ''}.`);
    pushEvent(s, { kind: 'activate', uid, eid, ctrl, chainIdx: s.chain.length, name: c.name });
    return link;
  }

  function openResponses(s, ctx, opts = {}) {
    for (const m of collectMandatoryTriggers(s, ctx)) pushLink(s, m);
    const last = s.chain[s.chain.length - 1];
    let responder = (last && !opts.preferActor) ? 1 - last.ctrl : (ctx.actor !== undefined ? 1 - ctx.actor : 1 - s.active);
    s.window = { forPlayer: responder, ctx, passed: 0 };
    pushEvent(s, { kind: 'window', forPlayer: responder, chainLen: s.chain.length });
  }

  function collectMandatoryTriggers(s, ctx) {
    const candidates = [];
    const scanZones = (p) => monUids(s, p, { faceUp: true }).concat(s.players[p].gy.slice());
    for (let p = 0; p < 2; p++) {
      for (const uid of scanZones(p)) {
        const inst = s.insts[uid];
        const c = cardOf(inst);
        for (const eff of (c.effects || [])) {
          if (eff.kind !== 'trigger') continue;
          if (eff.trigger && eff.trigger.optional) continue;
          if (eff.oncePerTurn && inst.onceUsed[eff.eid] === s.turn) continue;
          if (!triggerMatches(s, eff, ctx, inst, p)) continue;
          // auto-pick targets for mandatory triggers
          let targets = [];
          if (eff.targeting) {
            targets = poolForEffect(s, eff, p, ctx).map((pool) => pool.slice(0, 1)).flat();
          }
          candidates.push({ order: p === s.active ? 0 : 1, uid, eid: eff.eid, ctrl: p, speed: eff.speed, targets, event: ctx });
        }
      }
    }
    candidates.sort((a, b) => a.order - b.order);
    return candidates;
  }

  // Trigger names vs the events the engine fires — many listen via alias.
  const TRIGGER_EVENT_ALIASES = {
    opponentSpellActivated: ['spellActivated'],
    opponentMonsterSummoned: ['monsterSummoned'],
    selfSummoned: ['monsterSummoned'],
    selfAttacked: ['attackDeclared'],
    selfDestroyedBattle: ['ownMonsterDestroyedByBattle'],
    spellTrapActivated: ['spellActivated', 'trapActivated'],
    anyEffectActivated: ['spellActivated', 'trapActivated', 'anyEffectActivated'],
  };
  function triggerEventMatches(on, ev) {
    if (on === ev) return true;
    return (TRIGGER_EVENT_ALIASES[on] || []).includes(ev);
  }

  function triggerMatches(s, eff, ctx, inst, p) {
    const t = eff.trigger;
    if (!t || !triggerEventMatches(t.on, ctx.event)) return false;
    switch (t.on) {
      case 'selfSummoned':
        if (ctx.summonedUid !== inst.uid) return false;
        if (t.tributeSummoned && !ctx.tributeSummoned) return false;
        if (t.specialSummoned && !ctx.specialSummoned) return false;
        if (t.normalSummoned && !ctx.normalSummoned) return false;
        return true;
      case 'selfSentToGrave':
        if (ctx.movedUid !== inst.uid) return false;
        if (t.fromField && !ctx.fromField) return false;
        if (t.fromHand && !ctx.fromHand) return false;
        return true;
      case 'selfDestroyedBattle': return ctx.destroyedUid === inst.uid;
      case 'selfAttacked': return ctx.attackTargetUid === inst.uid;
      case 'selfDestroyedOpponentByBattle': return ctx.killerUid === inst.uid;
      case 'selfBattleDamageToOpponent': return ctx.killerUid === inst.uid && (ctx.battleDamage || 0) > 0;
      case 'chainResolved': return inst.zone === 'mon' && s.chainCountResolved >= (t.minLinks || 3);
      case 'opponentMonsterSummoned': return !!(ctx.summonedUid && s.insts[ctx.summonedUid] && s.insts[ctx.summonedUid].owner !== p);
      case 'ownMonsterDestroyedByBattle': return !!(ctx.destroyedUid && s.insts[ctx.destroyedUid] && s.insts[ctx.destroyedUid].owner === p);
      case 'attackDeclared': return true;
      case 'opponentSpellActivated': return ctx.event === 'spellActivated' && ctx.activator !== p;
      case 'spellTrapActivated': return ['spellActivated', 'trapActivated'].includes(ctx.event);
      case 'trapActivated': return ctx.event === 'trapActivated';
      case 'anyEffectActivated': return ['spellActivated', 'trapActivated', 'anyEffectActivated'].includes(ctx.event);
      default: return false;
    }
  }

  function passWindow(s, player) {
    const w = s.window;
    if (!w || w.forPlayer !== player) return { ok: false, error: 'not your window' };
    w.passed += 1;
    pushEvent(s, { kind: 'pass', player });
    if (w.passed >= 2) resolveChain(s);
    else { w.forPlayer = 1 - player; pushEvent(s, { kind: 'window', forPlayer: w.forPlayer, chainLen: s.chain.length }); }
    return { ok: true };
  }

  function resolveChain(s) {
    s.window = null;
    const links = s.chain.splice(0);
    const len = links.length;
    for (let i = links.length - 1; i >= 0; i--) resolveLink(s, links[i], links, i);
    s.chainCountResolved = len;
    if (s.flags.pendingBattle) {
      const b = s.flags.pendingBattle;
      s.flags.pendingBattle = null;
      if (s.flags.attacksPrevented) {
        log(s, 'The attack is stopped by the response.');
      } else {
        resolveBattle(s, b.attackUid, b.targetUid);
      }
    } else if (len >= 3) {
      openResponses(s, { event: 'chainResolved' });
    }
  }

  function resolveLink(s, link, links, resIdx) {
    const inst = s.insts[link.uid];
    if (!inst) return;
    const c = cardOf(inst);
    const eff = effectDef(c, link.eid);
    pushEvent(s, { kind: 'resolve', uid: link.uid, eid: link.eid, name: c.name, chainIdx: link.idx + 1 });
    if (link.negated) {
      log(s, `[${c.name}]'s activation was negated — nothing happens.`);
      settleActivationCard(s, link);
      return;
    }
    let targets = (link.targets || []).filter((u) => s.insts[u] && targetStillValid(s, u));
    if (eff.targeting && eff.targeting.length && !targets.length) {
      log(s, `[${c.name}] fizzles — its targets are gone.`);
      pushEvent(s, { kind: 'fizzle', name: c.name });
      settleActivationCard(s, link);
      return;
    }
    const ctx = {
      ctrl: link.ctrl, link, targets,
      summonedUid: link.summonedUid, attackUid: link.attackUid,
      destroyedUid: link.destroyedUid, destroyedAtk: link.destroyedAtk,
      battleDamage: link.battleDamage, links, resIdx,
    };
    for (const op of (eff.ops || [])) runOp(s, op, ctx);
    settleActivationCard(s, link);
    checkWin(s);
  }

  function targetStillValid(s, uid) {
    const inst = s.insts[uid];
    if (!inst) return false;
    return ['mon', 'spell', 'gy'].includes(inst.zone);
  }

  function settleActivationCard(s, link) {
    const inst = s.insts[link.uid];
    if (!inst) return;
    const c = cardOf(inst);
    if (c.cat === 'monster') return;
    if (c.kind === 'continuous' || c.kind === 'field') return; // stays if still on field
    if (inst.zone === 'spell' || inst.zone === 'hand') moveTo(s, inst.uid, 'gy');
  }

  // ------------------------------ OPS interpreter ------------------------------
  function runOp(s, op, ctx) {
    const ctrl = ctx.ctrl, opp = 1 - ctrl;
    switch (op.op) {
      case 'draw': for (let i = 0; i < (op.n || 1); i++) drawCard(s, ctrl); break;
      case 'payLP': s.players[ctrl].lp -= op.n; lpEvent(s, ctrl, -op.n); break;
      case 'heal': {
        const n = op.fromBattleDamage ? (ctx.battleDamage || 0) : op.n;
        s.players[ctrl].lp += n; lpEvent(s, ctrl, n);
        break;
      }
      case 'damageDirect': {
        const n = op.fromDestroyedAtk ? (ctx.destroyedAtk || 0) : op.n;
        s.players[opp].lp -= n; lpEvent(s, opp, -n);
        log(s, `P${opp} takes ${n} effect damage.`);
        break;
      }
      case 'destroyChosen': for (const u of ctx.targets) destroyCard(s, u, 'effect', ctrl); break;
      case 'destroyAll': {
        const sides = op.side === 'both' ? [0, 1] : [opp];
        for (const p of sides) {
          for (const u of monUids(s, p, op.faceUpOnly ? { faceUp: true } : {}).slice()) {
            const st = effStats(s, u);
            if (op.maxAtk === undefined || st.atk <= op.maxAtk) destroyCard(s, u, 'effect', ctrl);
          }
        }
        break;
      }
      case 'banishChosen':
        for (const u of ctx.targets) {
          moveTo(s, u, 'banish');
          pushEvent(s, { kind: 'banish', uid: u });
          log(s, `${s.insts[u] ? cardOf(s.insts[u]).name : '?'} is banished.`);
        }
        break;
      case 'banishChosenFromGrave': {
        const u = ctx.targets[0];
        if (!u) break;
        const owner = s.insts[u].owner;
        s.players[owner].gy = s.players[owner].gy.filter((x) => x !== u);
        moveTo(s, u, 'banish');
        pushEvent(s, { kind: 'banish', uid: u });
        break;
      }
      case 'bounceChosen': for (const u of ctx.targets) { moveTo(s, u, 'hand'); pushEvent(s, { kind: 'bounce', uid: u }); } break;
      case 'gyToHand': {
        const u = ctx.targets[0];
        if (!u) break;
        const owner = s.insts[u].owner;
        s.players[owner].gy = s.players[owner].gy.filter((x) => x !== u);
        moveTo(s, u, 'hand');
        pushEvent(s, { kind: 'toHand', uid: u });
        break;
      }
      case 'searchDeck': {
        const P = s.players[ctrl];
        const matches = P.deck.map((id) => ({ id, c: DATA.CARD_BY_ID[id] })).filter(({ c }) => {
          if (op.filter.cat && c.cat !== op.filter.cat) return false;
          if (op.filter.maxLv && (c.lv || 0) > op.filter.maxLv) return false;
          if (op.filter.type && c.type !== op.filter.type) return false;
          return true;
        });
        if (!matches.length) { log(s, 'The search finds nothing.'); break; }
        const pickId = (ctx.link.picks && ctx.link.picks.search) || matches[matches.length - 1].id;
        P.deck.splice(P.deck.indexOf(pickId), 1);
        const inst = makeInst(s, pickId, ctrl);
        inst.zone = 'hand';
        P.hand.push(inst.uid);
        log(s, `P${ctrl} adds ${DATA.CARD_BY_ID[pickId].name} to their hand.`);
        pushEvent(s, { kind: 'search', player: ctrl, cardId: pickId, reveal: !!op.reveal });
        break;
      }
      case 'summonFromGrave': {
        const u = ctx.targets[0];
        if (!u || !s.insts[u] || s.insts[u].zone !== 'gy') { log(s, 'Special Summon fizzles — target left the Graveyard.'); break; }
        if (s.field[ctrl].monsters.indexOf(null) === -1) { log(s, 'No free monster zone — Summon fizzles.'); break; }
        const owner = s.insts[u].owner;
        s.players[owner].gy = s.players[owner].gy.filter((x) => x !== u);
        moveTo(s, u, 'mon', { pos: op.position || 'def', ctrl, resetSummon: true });
        log(s, `${cardOf(s.insts[u]).name} is Special Summoned.`);
        pushEvent(s, { kind: 'summon', uid: u, special: true, position: s.insts[u].pos });
        openResponses(s, { event: 'monsterSummoned', summonedUid: u, specialSummoned: true, actor: ctrl });
        break;
      }
      case 'mill': {
        const target = op.side === 'opponent' ? opp : ctrl;
        for (let i = 0; i < (op.n || 1); i++) {
          const P = s.players[target];
          if (!P.deck.length) { win(s, 1 - target, 'deck-out'); break; }
          const id = P.deck.shift();
          const inst = makeInst(s, id, target);
          inst.zone = 'gy';
          P.gy.push(inst.uid);
          pushEvent(s, { kind: 'mill', player: target });
          gyArrivalScan(s, inst.uid, false, true);
        }
        break;
      }
      case 'buffSelf': {
        const u = ctx.link.uid;
        const inst = s.insts[u];
        if (!inst || !['mon', 'spell'].includes(inst.zone)) { log(s, 'The buff fizzles — the source is gone.'); break; }
        const atk = op.fromTributedAtk ? (ctx.link.costs.tributeAtk || 0) : (op.atk || 0);
        applyBuff(s, u, { atk, def: op.def || 0, until: op.until });
        pushEvent(s, { kind: 'buff', uid: u, atk, until: op.until });
        break;
      }
      case 'buffChosen':
        for (const u of ctx.targets) { applyBuff(s, u, { atk: op.atk || 0, def: op.def || 0, until: op.until }); pushEvent(s, { kind: 'buff', uid: u, atk: op.atk, until: op.until }); }
        break;
      case 'changePosChosen':
        for (const u of ctx.targets) {
          const i = s.insts[u];
          if (op.to === 'facedown') { i.faceDown = true; i.pos = 'def'; } else { i.faceDown = false; i.pos = op.to; }
          pushEvent(s, { kind: 'position', uid: u, pos: i.pos });
        }
        break;
      case 'preventAttacksThisTurn': s.flags.attacksPrevented = true; log(s, 'No further attacks this turn.'); break;
      case 'noBattleDamageThisTurn': s.flags.noBattleDamage = true; break;
      case 'peekOpponentHand': {
        const hand = s.players[opp].hand.map((u) => s.insts[u].id);
        log(s, `P${ctrl} peeks at P${opp}'s hand.`);
        pushEvent(s, { kind: 'peek', viewer: ctrl, cards: hand });
        break;
      }
      case 'lookAtSetCard': {
        const u = ctx.targets[0];
        if (u) { pushEvent(s, { kind: 'reveal', uid: u, cardId: s.insts[u].id, viewer: ctrl }); log(s, `P${ctrl} looks at a set card.`); }
        break;
      }
      case 'grantTributeFromOpponent': {
        const u = ctx.targets[0];
        if (!u) break;
        s.flags.soulTribute = { uid: u, turn: s.turn };
        log(s, `P${ctrl} may use an opponent's monster as Tribute this turn.`);
        break;
      }
      case 'discardOpponent': {
        const hand = s.players[opp].hand.slice();
        if (!hand.length) break;
        const n = Math.min(op.n || 1, hand.length);
        const picks = [];
        if (op.random) {
          const rng = mulberry32(s._rngState);
          for (let i = 0; i < n; i++) {
            const idx = Math.floor(rng() * hand.length);
            picks.push(hand.splice(idx, 1)[0]);
          }
          s._rngState = (s._rngState * 16807 + 12345) & 0x7fffffff;
        } else picks.push(...hand.slice(0, n));
        for (const u of picks) {
          if (s.insts[u].zone !== 'hand') continue;
          moveTo(s, u, 'gy');
          pushEvent(s, { kind: 'discard', uid: u, player: opp });
          gyArrivalScan(s, u, false, true);
        }
        log(s, `P${opp} discards ${picks.length} card(s).`);
        break;
      }
      case 'negateLink': case 'negateLinkBanish': {
        // links[] is in original chain order; this link sits at resIdx, so the
        // link it is chaining to (offset below it) is at resIdx - offset.
        const ti = ctx.resIdx - (op.offset || 1);
        const target = ti >= 0 ? ctx.links[ti] : null;
        if (target) {
          target.negated = true;
          log(s, `[${target.cardName}]'s activation is NEGATED.`);
          pushEvent(s, { kind: 'negate', chainIdx: target.idx + 1, name: target.cardName });
          if (op.op === 'negateLinkBanish') {
            const ti = s.insts[target.uid];
            if (ti && ti.zone === 'spell') { moveTo(s, ti.uid, 'banish'); pushEvent(s, { kind: 'banish', uid: ti.uid }); }
          }
        }
        break;
      }
      default: break;
    }
  }

  function applyBuff(s, uid, buff) {
    const inst = s.insts[uid];
    if (!inst) return;
    if (buff.until === 'permanent') { inst.baseAtkDelta += buff.atk || 0; inst.baseDefDelta += buff.def || 0; }
    else inst.tempBuffs.push({ atk: buff.atk, def: buff.def, until: buff.until, turn: s.turn });
  }

  function gyArrivalScan(s, uid, fromField, fromHand) {
    if (s.winner !== null) return;
    const ctx = { event: 'selfSentToGrave', movedUid: uid, fromField: !!fromField, fromHand: !!fromHand };
    const mandatory = collectMandatoryTriggers(s, ctx);
    if (!mandatory.length) return;
    for (const m of mandatory) pushLink(s, m);
    const last = s.chain[s.chain.length - 1];
    s.window = { forPlayer: 1 - last.ctrl, ctx, passed: 0 };
  }

  function destroyCard(s, uid, cause, byPlayer) {
    const inst = s.insts[uid];
    if (!inst || (inst.zone !== 'mon' && inst.zone !== 'spell')) return;
    const c = cardOf(inst);
    const pv = passivesFor(s);
    if (cause === 'battle' && pv.ownNoBattleDestroy.includes(inst.ctrl)) {
      log(s, `${c.name} cannot be destroyed by battle.`);
      pushEvent(s, { kind: 'protected', uid });
      return;
    }
    const stats = effStats(s, uid);
    const strike = inst.pos === 'atk' ? stats.atk : stats.def;
    log(s, `${c.name} is destroyed${cause === 'battle' ? ' by battle' : ''}.`);
    pushEvent(s, { kind: 'destroy', uid, cause, strike, owner: inst.owner });
    if (cause === 'battle' && pv.banishBattle.length) {
      moveTo(s, uid, 'banish');
      pushEvent(s, { kind: 'banish', uid });
      log(s, `${c.name} is banished instead (Gravebind).`);
      gyArrivalScan(s, uid, false, false);
      return;
    }
    moveTo(s, uid, 'gy');
    gyArrivalScan(s, uid, inst.zone === 'mon' || true, false);
    if (cause === 'battle') {
      openResponses(s, { event: 'ownMonsterDestroyedByBattle', destroyedUid: uid, destroyedAtk: stats.atk, actor: byPlayer });
    }
  }

  // ------------------------------ Summons ------------------------------
  function tributeCountFor(lv) { return lv >= 7 ? 2 : (lv >= 5 ? 1 : 0); }

  function soulUid(s, player) {
    return (s.flags.soulTribute && s.flags.soulTribute.turn === s.turn && s.insts[s.flags.soulTribute.uid] && s.insts[s.flags.soulTribute.uid].ctrl !== player) ? s.flags.soulTribute.uid : null;
  }

  function legalTributeSets(s, player, lv) {
    const need = tributeCountFor(lv);
    if (!need) return [[]];
    const pool = monUids(s, player);
    const soul = soulUid(s, player);
    if (soul && !pool.includes(soul)) pool.push(soul);
    const sets = [];
    if (need === 1) { for (const u of pool) sets.push([u]); }
    else for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) sets.push([pool[i], pool[j]]);
    return sets;
  }

  function doTribute(s, uids, byPlayer) {
    const pv = passivesFor(s);
    let tributeAtk = 0;
    for (const u of uids) {
      tributeAtk += effStats(s, u).atk;
      const ownerCtrl = s.insts[u].ctrl;
      moveTo(s, u, 'gy');
      pushEvent(s, { kind: 'tribute', uid: u });
      gyArrivalScan(s, u, true, false);
      if (pv.tributeDraw) { drawCard(s, ownerCtrl); log(s, `Gate of Echoes: P${ownerCtrl} draws.`); }
    }
    if (s.flags.soulTribute && uids.includes(s.flags.soulTribute.uid)) s.flags.soulTribute = null;
    return tributeAtk;
  }

  function specialSummonFromHand(s, player, uid, opts = {}) {
    if (s.field[player].monsters.indexOf(null) === -1) return { ok: false, error: 'no free monster zone' };
    const inst = s.insts[uid];
    moveTo(s, uid, 'mon', { pos: opts.pos || 'atk', resetSummon: true });
    log(s, `P${player} Special Summons ${cardOf(inst).name}.`);
    pushEvent(s, { kind: 'summon', uid, special: true, position: inst.pos });
    openResponses(s, { event: 'monsterSummoned', summonedUid: uid, specialSummoned: true, actor: player });
    return { ok: true };
  }

  // ------------------------------ Battle ------------------------------
  function canAttack(s, uid) {
    const inst = s.insts[uid];
    if (!inst || inst.zone !== 'mon' || inst.faceDown || inst.pos !== 'atk') return false;
    if (inst.attacked || s.flags.attacksPrevented) return false;
    const st = effStats(s, uid);
    for (const src of passivesFor(s).lockAttack) {
      const pc = cardOf(src).passive.lockAttack;
      const targetSide = pc.side === 'opponent' ? 1 - src.ctrl : src.ctrl;
      if (inst.ctrl === targetSide) {
        if (pc.maxAtk !== undefined && st.atk <= pc.maxAtk) return false;
        if (pc.minAtk !== undefined && st.atk >= pc.minAtk) return false;
      }
    }
    return true;
  }

  function battleValidTargets(s, attackerUid) {
    const attacker = s.insts[attackerUid];
    const opp = 1 - attacker.ctrl;
    const pv = passivesFor(s);
    const enemyAll = monUids(s, opp);
    const enemyUp = enemyAll.filter((u) => !s.insts[u].faceDown);
    const taunts = enemyUp.filter((u) => pv.taunt.includes(u) && s.insts[u].pos === 'def');
    if (taunts.length) return { forced: true, targets: taunts, direct: false };
    if (!enemyAll.length) return { forced: false, targets: [], direct: true };
    return { forced: false, targets: enemyAll, direct: false };
  }

  function resolveBattle(s, attackerUid, targetUid) {
    const attacker = s.insts[attackerUid];
    if (!attacker || attacker.zone !== 'mon') return; // attacker removed mid-chain
    attacker.attacked = true;
    const opp = 1 - attacker.ctrl;
    let aAtk = effStats(s, attackerUid).atk;
    const pv = passivesFor(s);
    if (targetUid) {
      for (const src of pv.calcCopy) {
        if (src.uid === attackerUid && src.onceUsed.calc !== s.turn && !s.insts[targetUid].faceDown && s.insts[targetUid].pos === 'atk') {
          aAtk = effStats(s, targetUid).atk;
          src.onceUsed.calc = s.turn;
          log(s, `Mirrorshade Duelist mirrors the target's ATK (${aAtk}).`);
          pushEvent(s, { kind: 'mirror', uid: attackerUid });
        }
      }
    }
    let dAtk = null, dDef = null, targetInst = null;
    if (targetUid && s.insts[targetUid] && s.insts[targetUid].zone === 'mon') {
      targetInst = s.insts[targetUid];
      if (targetInst.faceDown) {
        targetInst.faceDown = false;
        pushEvent(s, { kind: 'flip', uid: targetUid });
        log(s, `${cardOf(targetInst).name} is flipped face-up by the attack.`);
        runFlipEffects(s, targetUid);
      }
      dAtk = effStats(s, targetUid).atk;
      dDef = effStats(s, targetUid).def;
    }
    let damage = 0, side = null;
    const destroyed = [];
    if (!targetUid) { damage = aAtk; side = opp; }
    else if (targetInst.pos === 'atk') {
      if (aAtk > dAtk) { damage = aAtk - dAtk; side = opp; destroyed.push(targetUid); }
      else if (aAtk < dAtk) { damage = dAtk - aAtk; side = attacker.ctrl; destroyed.push(attackerUid); }
      else { destroyed.push(attackerUid, targetUid); }
    } else {
      if (aAtk > dDef) destroyed.push(targetUid);
      else if (aAtk < dDef) { damage = dDef - aAtk; side = attacker.ctrl; }
    }
    if (damage > 0 && side !== null) {
      if (s.flags.noBattleDamage) log(s, 'Battle damage is prevented this turn.');
      else {
        s.players[side].lp -= damage;
        lpEvent(s, side, -damage);
        log(s, `P${side} takes ${damage} battle damage.`);
        pushEvent(s, { kind: 'battleDamage', player: side, amount: damage });
        const killer = side === opp ? attackerUid : targetUid;
        if (killer && s.insts[killer]) openResponses(s, { event: 'selfBattleDamageToOpponent', killerUid: killer, battleDamage: damage, actor: killer ? s.insts[killer].ctrl : undefined });
      }
    }
    for (const u of destroyed) {
      if (u === attackerUid) {
        destroyCard(s, u, 'battle', attacker.ctrl);
      } else {
        destroyCard(s, u, 'battle', attacker.ctrl);
        openResponses(s, { event: 'selfDestroyedOpponentByBattle', killerUid: attackerUid, destroyedUid: u, actor: attacker.ctrl });
      }
    }
    if (checkWin(s)) return;
  }

  function runFlipEffects(s, uid) {
    const inst = s.insts[uid];
    const c = cardOf(inst);
    let added = false;
    for (const eff of (c.effects || [])) {
      if (eff.kind === 'flip') {
        s.chain.push({ idx: s.chain.length, uid, eid: eff.eid, ctrl: inst.ctrl, targets: [], costs: {}, picks: {}, speed: 1, cardName: c.name, cardId: c.id, kind: 'flip', negated: false });
        added = true;
      }
    }
    if (added) resolveChain(s);
  }

  // ------------------------------ Turn flow ------------------------------
  function endTurn(s) {
    const p = s.active;
    for (const uid of Object.keys(s.insts)) {
      const inst = s.insts[uid];
      inst.tempBuffs = inst.tempBuffs.filter((b) => b.until !== 'endOfTurn');
    }
    s.flags.attacksPrevented = false;
    s.flags.noBattleDamage = false;
    s.flags.soulTribute = null;
    s.chainCountResolved = 0;
    log(s, `P${p} ends the turn.`);
    pushEvent(s, { kind: 'turnEnd', player: p });
    s.active = 1 - p;
    s.turn += 1;
    const np = s.active;
    s.players[np].normalUsed = false;
    for (const uid of monUids(s, np)) { s.insts[uid].attacked = false; s.insts[uid].posChanged = false; }
    s.phase = 'main1';
    pushEvent(s, { kind: 'turnStart', player: np, turn: s.turn });
    drawCard(s, np);
    checkWin(s);
  }

  // ------------------------------ legal actions ------------------------------
  function legalActions(s, player) {
    const acts = [];
    if (s.winner !== null) return acts;
    if (s.window) {
      if (s.window.forPlayer === player) {
        acts.push({ type: 'pass' });
        for (const a of legalChainables(s, player)) acts.push(a);
      }
      return acts;
    }
    if (player !== s.active) return acts;
    const P = s.players[player];
    if (s.phase === 'main1' || s.phase === 'main2') {
      if (!P.normalUsed) {
        for (const uid of P.hand) {
          const c = cardOf(s.insts[uid]);
          if (c.cat !== 'monster') continue;
          if (c.specialSummon && c.specialSummon.from === 'hand' && checkCondition(s, player, c)) {
            acts.push({ type: 'specialSummonHand', uid });
          }
          const tribSets = legalTributeSets(s, player, c.lv);
          const freeSlot = s.field[player].monsters.indexOf(null) !== -1;
          if (!freeSlot && !tribSets[0].length) continue;
          const tributes = tribSets[0];
          acts.push({ type: 'summon', uid, tributes, position: 'atk' });
          acts.push({ type: 'summon', uid, tributes, position: 'set' });
        }
      }
      for (const uid of P.hand) {
        const c = cardOf(s.insts[uid]);
        if ((c.cat === 'trap' || (c.cat === 'spell' && c.kind !== 'field')) && s.field[player].spells.indexOf(null) !== -1) {
          acts.push({ type: 'setSpell', uid });
        }
        if (c.cat === 'spell') {
          for (const eff of (c.effects || [])) {
            if (canActivateEffect(s, uid, eff.eid, player).ok) {
              acts.push({ type: 'activate', uid, eid: eff.eid, needsTargets: eff.targeting || [], needsCosts: costTargetPools(s, player, eff, uid) });
            }
          }
        }
      }
      for (const uid of monUids(s, player, { faceUp: true })) {
        const c = cardOf(s.insts[uid]);
        for (const eff of (c.effects || [])) {
          if (eff.kind !== 'ignition') continue;
          if (canActivateEffect(s, uid, eff.eid, player).ok) {
            acts.push({ type: 'activate', uid, eid: eff.eid, needsTargets: eff.targeting || [], needsCosts: costTargetPools(s, player, eff, uid) });
          }
        }
      }
      for (const uid of monUids(s, player)) {
        const inst = s.insts[uid];
        if (inst.summonTurn === s.turn || inst.posChanged) continue;
        if (inst.faceDown) acts.push({ type: 'flipSummon', uid });
        else acts.push({ type: 'changePosition', uid, to: inst.pos === 'atk' ? 'def' : 'atk' });
      }
      acts.push({ type: 'endPhase' });
    }
    if (s.phase === 'battle') {
      for (const uid of monUids(s, player, { faceUp: true })) {
        if (!canAttack(s, uid)) continue;
        const { targets, direct } = battleValidTargets(s, uid);
        if (direct) acts.push({ type: 'attack', uid, target: null });
        for (const t of targets) acts.push({ type: 'attack', uid, target: t });
      }
      acts.push({ type: 'endPhase' });
    }
    return acts;
  }

  function checkCondition(s, player, c) {
    if (!c.condition) return true;
    if (c.condition.lpAtMost !== undefined && s.players[player].lp > c.condition.lpAtMost) return false;
    if (c.condition.controlType && !monUids(s, player, { faceUp: true }).some((u) => cardOf(s.insts[u]).type === c.condition.controlType)) return false;
    return true;
  }

  function legalChainables(s, player) {
    const out = [];
    const w = s.window;
    if (!w) return out;
    const last = s.chain[s.chain.length - 1];
    const lastSpeed = last ? last.speed : 1;
    const zones = s.players[player].hand
      .concat(s.field[player].spells.filter(Boolean))
      .concat(monUids(s, player, { faceUp: true }));
    for (const uid of zones) {
      const inst = s.insts[uid];
      if (inst.ctrl !== player) continue;
      const c = cardOf(inst);
      if (c.cat !== 'trap' && c.cat !== 'spell' && c.cat !== 'monster') continue;
      if (inst.zone === 'spell' && c.cat === 'trap' && inst.turnSet === s.turn) continue;
      if (inst.zone === 'spell' && c.cat !== 'monster' && !inst.faceDown) continue;
      if (inst.zone === 'mon' && inst.negated) continue;
      for (const eff of (c.effects || [])) {
        if (!['trigger', 'counter', 'quick'].includes(eff.kind)) continue;
        if (last && eff.speed < lastSpeed) continue;
        if (eff.oncePerTurn && inst.onceUsed[eff.eid] === s.turn) continue;
        if (!triggerMatches(s, eff, w.ctx, inst, player)) continue;
        if (!canActivateEffect(s, uid, eff.eid, player).ok) continue;
        out.push({ type: 'chain', uid, eid: eff.eid, player, needsTargets: eff.targeting || [], needsCosts: costTargetPools(s, player, eff, uid) });
      }
    }
    return out;
  }

  // ------------------------------ applyAction ------------------------------
  function applyAction(state, action) {
    const s = clone(state);
    s.events = [];
    const res = applyRaw(s, action);
    if (!res.ok) return res;
    postAction(s);
    return { ok: true, state: s, events: s.events };
  }

  function applyRaw(s, action) {
    switch (action.type) {
      case 'pass': return passWindow(s, s.window ? s.window.forPlayer : -1);
      case 'endPhase': {
        if (s.window) return { ok: false, error: 'respond first' };
        if (s.phase === 'main1') { s.phase = 'battle'; pushEvent(s, { kind: 'phase', phase: 'battle' }); }
        else if (s.phase === 'battle') { s.phase = 'main2'; pushEvent(s, { kind: 'phase', phase: 'main2' }); }
        else endTurn(s);
        return { ok: true };
      }
      case 'endTurn':
        if (s.window) return { ok: false, error: 'respond first' };
        endTurn(s);
        return { ok: true };
      case 'surrender': win(s, 1 - action.player, 'surrender'); return { ok: true };
      case 'summon': {
        if (s.window) return { ok: false, error: 'respond first' };
        const player = s.active;
        if (s.players[player].normalUsed) return { ok: false, error: 'normal summon used' };
        const inst = s.insts[action.uid];
        if (!inst || inst.zone !== 'hand' || cardOf(inst).cat !== 'monster') return { ok: false, error: 'not a monster in hand' };
        const need = tributeCountFor(cardOf(inst).lv);
        const tributes = action.tributes || [];
        if (tributes.length !== need) return { ok: false, error: `needs ${need} tribute(s)` };
        const soul = soulUid(s, player);
        for (const u of tributes) {
          const t = s.insts[u];
          if (!t || t.zone !== 'mon') return { ok: false, error: 'bad tribute' };
          if (t.ctrl !== player && u !== soul) return { ok: false, error: 'cannot tribute that' };
        }
        if (!tributes.length && s.field[player].monsters.indexOf(null) === -1) return { ok: false, error: 'no free monster zone' };
        s.players[player].normalUsed = true;
        const tributeAtk = need ? doTribute(s, tributes, player) : 0;
        moveTo(s, action.uid, 'mon', { faceDown: action.position === 'set', pos: action.position === 'set' ? undefined : 'atk', resetSummon: true });
        const c = cardOf(s.insts[action.uid]);
        log(s, `P${player} ${action.position === 'set' ? 'sets' : 'Normal Summons'} ${c.name}${need ? ` (Tribute Summon)` : ''}.`);
        pushEvent(s, { kind: 'summon', uid: action.uid, special: false, tribute: need > 0, position: action.position });
        openResponses(s, { event: 'monsterSummoned', summonedUid: action.uid, normalSummoned: action.position !== 'set', tributeSummoned: need > 0, specialSummoned: false, actor: player });
        return { ok: true };
      }
      case 'specialSummonHand': {
        if (s.window) return { ok: false, error: 'respond first' };
        const player = s.active;
        const inst = s.insts[action.uid];
        const c = cardOf(inst);
        if (!c.specialSummon || c.specialSummon.from !== 'hand') return { ok: false, error: 'no special summon' };
        if (!checkCondition(s, player, c)) return { ok: false, error: 'condition not met' };
        return specialSummonFromHand(s, player, action.uid, { pos: 'atk' });
      }
      case 'setSpell': {
        if (s.window) return { ok: false, error: 'respond first' };
        const player = s.active;
        const inst = s.insts[action.uid];
        if (!inst || inst.zone !== 'hand') return { ok: false, error: 'not in hand' };
        if (s.field[player].spells.indexOf(null) === -1) return { ok: false, error: 'no free spell zone' };
        moveTo(s, action.uid, 'spell', { faceDown: true });
        log(s, `P${player} sets a card face-down.`);
        pushEvent(s, { kind: 'set', uid: action.uid, player });
        return { ok: true };
      }
      case 'activate': {
        if (s.window) return { ok: false, error: 'respond first' };
        return activateEffect(s, action, false);
      }
      case 'chain': {
        if (!s.window || s.window.forPlayer !== action.player) return { ok: false, error: 'not your window' };
        return activateEffect(s, action, true);
      }
      case 'attack': {
        if (s.window) return { ok: false, error: 'respond first' };
        if (s.phase !== 'battle') return { ok: false, error: 'not battle phase' };
        const player = s.active;
        const inst = s.insts[action.uid];
        if (!inst || inst.ctrl !== player) return { ok: false, error: 'not yours' };
        if (!canAttack(s, action.uid)) return { ok: false, error: 'cannot attack' };
        const { targets, direct } = battleValidTargets(s, action.uid);
        if (action.target) {
          if (!targets.includes(action.target)) return { ok: false, error: 'illegal target' };
        } else if (!direct) return { ok: false, error: 'opponent has monsters' };
        log(s, `P${player}'s ${cardOf(inst).name} attacks${action.target ? ` ${cardOf(s.insts[action.target]).name}` : ' directly'}.`);
        pushEvent(s, { kind: 'attack', uid: action.uid, target: action.target || null, direct: !action.target });
        s.flags.pendingBattle = { attackUid: action.uid, targetUid: action.target || null };
        openResponses(s, { event: 'attackDeclared', attackUid: action.uid, attackTargetUid: action.target || null, actor: player });
        return { ok: true };
      }
      case 'flipSummon': {
        if (s.window) return { ok: false, error: 'respond first' };
        const player = s.active;
        const inst = s.insts[action.uid];
        if (!inst || inst.ctrl !== player || !inst.faceDown) return { ok: false, error: 'cannot flip' };
        if (inst.summonTurn === s.turn) return { ok: false, error: 'summoned this turn' };
        inst.faceDown = false; inst.pos = 'atk'; inst.posChanged = true;
        pushEvent(s, { kind: 'flip', uid: action.uid });
        log(s, `P${player} Flip Summons ${cardOf(inst).name}.`);
        runFlipEffects(s, action.uid);
        return { ok: true };
      }
      case 'changePosition': {
        if (s.window) return { ok: false, error: 'respond first' };
        const player = s.active;
        const inst = s.insts[action.uid];
        if (!inst || inst.ctrl !== player || inst.faceDown) return { ok: false, error: 'bad position change' };
        if (inst.summonTurn === s.turn) return { ok: false, error: 'summoned this turn' };
        if (inst.posChanged) return { ok: false, error: 'already changed' };
        inst.pos = action.to === 'def' ? 'def' : 'atk';
        inst.posChanged = true;
        pushEvent(s, { kind: 'position', uid: action.uid, pos: inst.pos });
        return { ok: true };
      }
      default: return { ok: false, error: 'unknown action' };
    }
  }

  function activateEffect(s, action, isChain) {
    const player = isChain ? action.player : s.active;
    const inst = s.insts[action.uid];
    if (!inst) return { ok: false, error: 'no card' };
    const c = cardOf(inst);
    const eff = effectDef(c, action.eid);
    if (!eff) return { ok: false, error: 'no effect' };
    const legalZones = c.cat === 'monster' ? ['mon'] : ['hand', 'spell'];
    if (!legalZones.includes(inst.zone)) return { ok: false, error: 'wrong zone' };
    if (inst.ctrl !== player) return { ok: false, error: 'not yours' };
    const chk = canActivateEffect(s, action.uid, action.eid, player);
    if (!chk.ok) return { ok: false, error: chk.why };
    // validate targets
    const targets = action.targets || [];
    if (eff.targeting) {
      const pools = poolForEffect(s, eff, player);
      let idx = 0;
      for (let t = 0; t < eff.targeting.length; t++) {
        for (let k = 0; k < eff.targeting[t].count; k++) {
          const u = targets[idx++];
          if (!u || !pools[t].includes(u)) return { ok: false, error: 'illegal target' };
        }
      }
      if (idx !== targets.length) return { ok: false, error: 'wrong target count' };
    } else if (targets.length) return { ok: false, error: 'no targets needed' };
    // pay costs
    const costs = {};
    const costPools = costTargetPools(s, player, eff, action.uid);
    (eff.cost || []).forEach((cost, ci) => {
      if (cost.op === 'payLP') { s.players[player].lp -= cost.n; lpEvent(s, player, -cost.n); }
      else if (cost.op === 'banishGrave') {
        const u = (action.costChoices && action.costChoices[ci]) || costPools[ci].choices[0];
        s.players[player].gy = s.players[player].gy.filter((x) => x !== u);
        moveTo(s, u, 'banish');
        pushEvent(s, { kind: 'banish', uid: u });
      } else if (cost.op === 'tributeOwn') {
        const u = (action.costChoices && action.costChoices[ci]) || costPools[ci].choices[0];
        costs.tributeAtk = doTribute(s, [u], player);
      }
    });
    if (isChain) {
      pushLink(s, { uid: action.uid, eid: action.eid, ctrl: player, targets, costs, picks: action.picks, speed: eff.speed, event: s.window.ctx });
      s.window.passed = 0;
      s.window.forPlayer = 1 - player;
      pushEvent(s, { kind: 'window', forPlayer: s.window.forPlayer, chainLen: s.chain.length });
    } else {
      s.chain.length = 0;
      const ev = c.cat === 'spell' ? 'spellActivated' : c.cat === 'trap' ? 'trapActivated' : 'anyEffectActivated';
      const ctx = { event: ev, activator: player, actor: player };
      pushLink(s, { uid: action.uid, eid: action.eid, ctrl: player, targets, costs, picks: action.picks, speed: eff.speed, event: ctx });
      openResponses(s, ctx);
    }
    return { ok: true };
  }

  function postAction(s) {
    let guard = 0;
    while (s.window && s.winner === null && guard++ < 60) {
      const fp = s.window.forPlayer;
      const acts = legalActions(s, fp);
      if (acts.length <= 1) passWindow(s, fp);
      else break;
    }
    checkWin(s);
  }

  // ------------------------------ Debug hooks ------------------------------
  function debugGiveCard(s, player, cardId) {
    const inst = makeInst(s, cardId, player);
    inst.zone = 'hand';
    s.players[player].hand.push(inst.uid);
    return inst.uid;
  }
  function debugSetLP(s, player, lp) { s.players[player].lp = lp; checkWin(s); }

  // ------------------------------ Public view ------------------------------
  function publicView(s, player) {
    const v = clone(s);
    for (let p = 0; p < 2; p++) {
      if (p === player) continue;
      v.players[p].hand = v.players[p].hand.map(() => 'hidden');
    }
    v.players[player].deck = { count: s.players[player].deck.length };
    v.players[1 - player].deck = { count: s.players[1 - player].deck.length };
    for (const uid of Object.keys(v.insts)) {
      const inst = v.insts[uid];
      if (inst.owner === player) continue;
      if (inst.zone === 'hand') inst.id = 'hidden';
      else if (inst.faceDown) inst.id = 'hidden';
    }
    return v;
  }

  const AC = {
    startDuel, applyAction, legalActions, publicView, effStats, cardOf, clone,
    debugGiveCard, debugSetLP, canAttack, battleValidTargets, passivesFor,
    monUids, spellUids,
    _internal: { poolUids, filterPool, canActivateEffect, triggerMatches, costTargetPools, poolForEffect },
  };
  root.ACEngine = AC;
  if (typeof module !== 'undefined' && module.exports) module.exports = AC;
})(typeof globalThis !== 'undefined' ? globalThis : window);
