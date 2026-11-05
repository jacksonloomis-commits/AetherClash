// AetherClash — browser UI. Screens: home, duel, deck builder, collection, packs.
(function () {
  'use strict';
  const BUILD = '2026.11.01';
  const UPDATE_LOG = [
    { version: '2026.11.01', tag: 'AETHERCLASH BETA', items: [
      'Playable beta: rules engine with a real chain system (spell speeds 1/2/3, alternating response windows, LIFO resolution, negation, target fizzling, once-per-turn locks)',
      '53 original cards with structured effect definitions: auras, triggers, quick effects, counter traps, graveyard/banish effects, tribute economy, taunts, ATK copy',
      'AI opponent with lookahead that plays by identical rules and never touches hidden information (no-cheat tested)',
      'Deck builder (3 slots, legality validation), collection, pack opening with published odds, duplicate-to-shard crafting, XP/levels, practice card-tester'
    ] }
  ];
  const AC = window.ACEngine, DATA = window.ACData, AIC = window.ACAI;
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  // ================= profile / persistence =================
  const PKEY = 'aetherclash-profile-v1';
  function defaultProfile() {
    const owned = {};
    for (const [id, n] of DATA.STARTER_DECK) owned[id] = n;
    return { xp: 0, level: 1, shards: 100, owned, packs: 3, decks: [{ name: 'Starter Rift', cards: DATA.expandDeck(DATA.STARTER_DECK) }], activeDeck: 0, wins: 0, losses: 0, fastMode: false, seenPack: false };
  }
  let P = load();
  function load() { try { return { ...defaultProfile(), ...JSON.parse(localStorage.getItem(PKEY)) }; } catch { return defaultProfile(); } }
  function save() { localStorage.setItem(PKEY, JSON.stringify(P)); }
  function xpToNext(level) { return 120 + (level - 1) * 60; }
  function addXP(n) {
    P.xp += n; let ups = 0;
    while (P.xp >= xpToNext(P.level)) { P.xp -= xpToNext(P.level); P.level++; P.packs++; ups++; }
    if (ups) toast(`Level ${P.level}! ${ups} pack${ups > 1 ? 's' : ''} earned`);
    save();
  }

  // ================= sigils (procedural art) =================
  const ATTR_COLORS = { FIRE: '#ff7a45', WATER: '#4fc3f7', WIND: '#9ae66e', EARTH: '#c98f4d', LIGHT: '#ffe08a', DARK: '#9b7aff' };
  function sigil(card, size) {
    const col = ATTR_COLORS[card.attr] || '#aaa';
    const n = card.num;
    const spokes = 5 + (n % 4), rings = 1 + (n % 3);
    let svg = `<svg viewBox="0 0 60 60" width="${size || 46}" height="${size || 46}">`;
    for (let r = 0; r < rings; r++) {
      const rad = 12 + r * 9;
      svg += `<circle cx="30" cy="30" r="${rad}" fill="none" stroke="${col}" stroke-width="1" opacity="${0.9 - r * 0.25}"/>`;
    }
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + n;
      const x1 = 30 + Math.cos(a) * 10, y1 = 30 + Math.sin(a) * 10;
      const x2 = 30 + Math.cos(a) * 26, y2 = 30 + Math.sin(a) * 26;
      svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="1.4"/>`;
      svg += `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="2.2" fill="${col}"/>`;
    }
    const inner = n % 3;
    if (inner === 0) svg += `<polygon points="30,20 39,36 21,36" fill="none" stroke="${col}" stroke-width="1.6"/>`;
    else if (inner === 1) svg += `<rect x="22" y="22" width="16" height="16" fill="none" stroke="${col}" stroke-width="1.6" transform="rotate(45 30 30)"/>`;
    else svg += `<circle cx="30" cy="30" r="6" fill="${col}" opacity="0.85"/>`;
    svg += '</svg>';
    return svg;
  }

  // ================= card renderer =================
  function cardEl(cardId, opts = {}) {
    const c = DATA.CARD_BY_ID[cardId];
    if (!c) return el('div', 'card');
    const d = el('div', `card rar-${c.rar} cat-${c.cat}${opts.cls ? ' ' + opts.cls : ''}`);
    d.dataset.cardId = cardId;
    let lv = '';
    if (c.cat === 'monster' && c.lv) lv = `<span class="lvstrip">${'<i></i>'.repeat(Math.min(c.lv, 8))}</span>`;
    const stats = c.cat === 'monster' ? `<div class="cstats"><span>${c.atk}/${c.def}</span><span>${c.attr}</span></div>` : `<div class="cstats"><span style="letter-spacing:.14em">${(c.kind || 'spell').toUpperCase()}</span></div>`;
    d.innerHTML = `${lv}<span class="rar-gem"></span><div class="art">${sigil(c)}</div><div class="cname">${c.name}</div><div class="ctext">${c.text}</div>${stats}`;
    if (opts.count !== undefined) {
      const badge = el('span', 'owned-count' + (opts.count >= 3 ? ' maxed' : ''), `×${opts.count}`);
      d.appendChild(badge);
    }
    if (opts.onclick) d.addEventListener('click', (e) => { e.stopPropagation(); opts.onclick(c, d); });
    return d;
  }

  function showCardModal(cardId) {
    const c = DATA.CARD_BY_ID[cardId];
    const m = $('#card-modal');
    m.innerHTML = '';
    const box = el('div', 'modal-box');
    box.innerHTML = `<button class="close-x">✕</button><h3>${c.name}</h3>`;
    const grid = el('div', 'detail-grid');
    grid.appendChild(cardEl(cardId, { cls: 'big-card' }));
    const info = el('div', 'detail-info');
    const rows = [];
    rows.push(`<span class="dk">Card</span> #${String(c.num).padStart(3, '0')} · ${c.cat.toUpperCase()}${c.cat === 'monster' ? ` · Level ${c.lv} · ${c.attr} ${c.type}` : ` · ${c.kind || ''}`}`);
    rows.push(`<span class="dk">Rarity</span> ${DATA.RARITIES[c.rar].name}`);
    rows.push(`<span class="dk">Flavor / Effect</span><div class="effect-line">${c.text}</div>`);
    if (c.effects) for (const e of c.effects) {
      rows.push(`<span class="dk">Effect — ${e.kind}${e.speed ? ` (speed ${e.speed})` : ''}${e.oncePerTurn ? ' · once per turn' : ''}</span><div class="effect-line">Trigger: ${e.trigger ? e.trigger.on : '—'}${e.cost ? ' · Has cost' : ''}${e.targeting ? ' · Requires target' : ''}</div>`);
    }
    if (c.condition) rows.push(`<span class="dk">Special Summon condition</span><div class="effect-line">${JSON.stringify(c.condition)}</div>`);
    info.innerHTML = rows.join('<br>');
    grid.appendChild(info);
    box.appendChild(grid);
    m.appendChild(box);
    m.hidden = false;
    box.querySelector('.close-x').onclick = () => { m.hidden = true; };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }

  // ================= navigation =================
  let duel = null; // {s, ai, practice, busy, revealHands}
  function nav(where) {
    for (const sc of document.querySelectorAll('.screen')) sc.hidden = true;
    $('#screen-' + where).hidden = false;
    if (where === 'home') renderHome();
    if (where === 'deck') renderDeckBuilder();
    if (where === 'collection') renderCollection();
    if (where === 'packs') renderPacks();
  }
  document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const w = b.dataset.nav;
    if (w === 'duel') startDuel(false);
    else if (w === 'practice') startDuel(true);
    else nav(w);
  }));

  // ================= home =================
  function renderHome() {
    const owned = Object.keys(P.owned).length;
    $('#profile-bar').innerHTML = `
      <div class="stat"><b>${P.level}</b><span>Level</span><div class="xp-track"><div class="xp-fill" style="width:${Math.min(100, (P.xp / xpToNext(P.level)) * 100)}%"></div></div></div>
      <div class="stat"><b>${owned}/${DATA.CARDS.length}</b><span>Cards</span></div>
      <div class="stat"><b>${P.packs}</b><span>Packs</span></div>
      <div class="stat"><b>${P.shards}</b><span>Shards</span></div>
      <div class="stat"><b>${P.wins}–${P.losses}</b><span>Record</span></div>`;
    $('#home-sigil').innerHTML = sigil({ num: 17, attr: 'LIGHT' }, 92);
    $('#fast-mode').checked = P.fastMode;
  }
  $('#fast-mode').addEventListener('change', (e) => { P.fastMode = e.target.checked; save(); });

  function toast(msg, ms = 2400) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._tm); t._tm = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ================= duel =================
  function activeDeckCards() {
    const deck = P.decks[P.activeDeck] || P.decks[0];
    const counts = {};
    for (const id of deck.cards) counts[id] = (counts[id] || 0) + 1;
    for (const [id, n] of Object.entries(counts)) if (n > 3 || (P.owned[id] || 0) < n) return null;
    return deck.cards.length === DATA.DECK_SIZE ? deck.cards : null;
  }

  function startDuel(practice) {
    const cards = activeDeckCards();
    if (!cards) { toast('Your active deck is invalid — fix it in the Deck Builder.'); nav('deck'); return; }
    duel = { s: AC.startDuel(cards, DATA.expandDeck(DATA.AI_DECK)), ai: AIC.createAI(AC, 1), practice, busy: false, revealHands: false };
    nav('duel');
    $('#debug-bar').hidden = !practice;
    $('#win-overlay').hidden = true;
    buildDebugBar();
    renderDuel();
    aiDrive();
  }
  $('#btn-concede').addEventListener('click', () => {
    if (!duel) return;
    const r = AC.applyAction(duel.s, { type: 'surrender', player: 0 });
    if (r.ok) { duel.s = r.state; renderDuel(); }
  });
  $('#btn-log').addEventListener('click', () => showLog());

  const delay = (ms) => new Promise((res) => setTimeout(res, duel && duel.s && P.fastMode ? Math.min(ms, 60) : ms));

  async function aiDrive() {
    if (!duel) return;
    let guard = 0;
    while (duel && duel.s.winner === null && guard++ < 200) {
      const s = duel.s;
      if (s.window) {
        if (s.window.forPlayer === 0) { renderDuel(); return; } // player must respond
        const act = duel.ai.respond(s);
        await step(act, 1);
      } else {
        if (s.active !== 1) { renderDuel(); return; } // player's turn
        const act = duel.ai.takeTurnAction(s);
        if (!act) { renderDuel(); return; }
        if (act.type === 'endTurn' || act.type === 'endPhase') await delay(500);
        else if (act.taunt) {}
        await step(act, 1);
      }
      if (duel && duel.s.winner !== null) { finishDuel(); return; }
      await delay(340);
    }
    renderDuel();
  }

  async function step(act, actor) {
    if (!duel) return;
    const r = AC.applyAction(duel.s, act);
    if (!r.ok) { console.warn('illegal', act, r.error); return; }
    duel.s = r.state;
    if (actor === 1 && act.type && ['summon', 'specialSummonHand', 'attack', 'activate', 'chain'].includes(act.type)) {
      const t = duel.ai.taunt(act);
      if (t && !P.fastMode) $('#phase-hint') && ($('#phase-hint').textContent = `The Archivist: “${t}”`);
    }
    renderDuel(r.events);
    if (!P.fastMode) await delay(380);
  }

  // ---------- targeting flow ----------
  let flow = null; // {kind:'activate'|'summon'|'chain'|'attack', act, stage, targets:[], pools, label}
  function beginFlow(kind, act, label) {
    flow = { kind, act, targets: [], stage: 0, label };
    try { flow.pools = flowTargetPools(); } catch (e) { flow.pools = []; }
    if (!flow.pools.length || flow.pools.every((p) => !p.pool.length)) { commitFlow(); return; } // direct attack / no-target action
    renderDuel();
  }

  function flowTargetPools() {
    const { s } = duel;
    const act = flow.act;
    if (flow.kind === 'summon') return [{ pool: AC.monUids(s, 0), count: act.tributeNeed, label: 'Choose Tributes' }];
    if (flow.kind === 'attack') {
      const bt = AC.battleValidTargets(s, act.uid);
      return [{ pool: bt.targets, count: 1, label: 'Choose Attack Target' }];
    }
    const c = AC.cardOf(s.insts[act.uid]);
    const eff = (c.effects || []).find((e) => e.eid === act.eid);
    const pools = AC._internal.poolForEffect(s, eff, 0).map((p, i) => ({ pool: p, count: eff.targeting[i].count, label: `Choose Target (${eff.targeting[i].count})` }));
    return pools;
  }

  function costFlowFor(act) {
    const s = duel.s;
    const c = AC.cardOf(s.insts[act.uid]);
    const eff = (c.effects || []).find((e) => e.eid === act.eid);
    return AC._internal.costTargetPools(s, 0, eff, act.uid);
  }

  function zoneClick(uid, zoneKind) {
    if (!flow) return;
    const spec = flow.pools[flow.stage];
    if (!spec.pool.includes(uid)) { toast('Not a legal target.'); return; }
    flow.targets.push(uid);
    flow.stage++;
    if (flow.stage >= flow.pools.length) commitFlow();
    else renderDuel();
  }

  function commitFlow() {
    const f = flow; flow = null;
    const act = { ...f.act, targets: f.targets };
    if (f.costChoices) act.costChoices = f.costChoices;
    if (f.picks) act.picks = f.picks;
    if (f.act.player !== undefined) act.player = f.act.player;
    submit(act);
  }

  async function submit(act) {
    const r = AC.applyAction(duel.s, act);
    if (!r.ok) { toast(r.error || 'Illegal action.'); renderDuel(); return; }
    duel.s = r.state;
    renderDuel(r.events);
    if (duel.s.winner !== null) { finishDuel(); return; }
    if (!P.fastMode) await delay(300);
    aiDrive();
  }

  // ---------- hand interactions ----------
  function handMenu(cardId, dom) {
    const s = duel.s;
    const inst = s.insts[s.players[0].hand.find((u) => s.insts[u].id === cardId)];
    if (!inst) return;
    const c = AC.cardOf(inst);
    const bar = $('#action-bar');
    bar.innerHTML = `<span class="phase-hint">${c.name} —</span>`;
    const mk = (label, fn, cls) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; bar.appendChild(b); };
    if (c.cat === 'monster') {
      const need = c.lv >= 7 ? 2 : (c.lv >= 5 ? 1 : 0);
      if (!s.players[0].normalUsed) {
        mk(need ? `Tribute Summon (${need})` : 'Summon', () => {
          const act = { type: 'summon', uid: inst.uid, tributes: [], position: 'atk', tributeNeed: need };
          if (need) beginFlow('summon', act, 'tributes');
          else submit(act);
        });
        mk('Set', () => {
          const act = { type: 'summon', uid: inst.uid, tributes: [], position: 'set', tributeNeed: need };
          if (need) beginFlow('summon', act, 'tributes');
          else submit(act);
        });
      }
      if (c.specialSummon && c.specialSummon.from === 'hand') {
        mk('Special Summon', () => submit({ type: 'specialSummonHand', uid: inst.uid }), 'respond');
      }
    } else {
      for (const eff of (c.effects || [])) {
        if (AC.legalActions(s, 0).some((a) => a.type === 'activate' && a.uid === inst.uid && a.eid === eff.eid)) {
          mk(`Activate${(c.effects.length > 1) ? ` (${eff.eid})` : ''}`, () => beginEffectFlow(inst.uid, eff.eid, false), 'respond');
        }
      }
      if (c.cat !== 'field') mk('Set', () => submit({ type: 'setSpell', uid: inst.uid }));
    }
    mk('Details', () => showCardModal(cardId), 'ghost');
    mk('Cancel', () => renderDuel(), 'ghost');
  }

  function beginEffectFlow(uid, eid, isChain) {
    const s = duel.s;
    const c = AC.cardOf(s.insts[uid]);
    const eff = (c.effects || []).find((e) => e.eid === eid);
    const act = { type: isChain ? 'chain' : 'activate', uid, eid, player: 0 };
    const costs = AC._internal.costTargetPools(s, 0, eff, uid);
    const goTargets = () => {
      if (eff.targeting && eff.targeting.length) {
        beginFlow(isChain ? 'chain' : 'activate', act, 'targets');
      } else commitEffectAction(act, null);
    };
    if (costs.length) {
      // simple auto-pick for single-choice costs, else ask
      const pools = costs.map((cp) => cp.choices);
      if (pools.every((p) => p.length === 1) || true) {
        act.costChoices = pools.map((p) => p[0]);
      }
      goTargets();
    } else goTargets();
  }

  function commitEffectAction(act, picks) {
    if (picks) act.picks = picks;
    submit(act);
  }

  // ---------- field interactions ----------
  function fieldMenu(uid, dom) {
    const s = duel.s;
    const inst = s.insts[uid];
    const c = AC.cardOf(inst);
    const bar = $('#action-bar');
    bar.innerHTML = `<span class="phase-hint">${inst.faceDown ? 'Set card' : c.name} —</span>`;
    const mk = (label, fn, cls) => { const b = el('button', 'btn ' + (cls || ''), label); b.onclick = fn; bar.appendChild(b); };
    if (inst.ctrl === 0) {
      if (!inst.faceDown && s.phase === 'battle' && AC.canAttack(s, uid)) {
        mk('Attack', () => beginFlow('attack', { type: 'attack', uid }, 'target'), 'respond');
      }
      if (!inst.faceDown && (s.phase === 'main1' || s.phase === 'main2')) {
        for (const eff of (c.effects || [])) {
          if (eff.kind === 'ignition' && AC.legalActions(s, 0).some((a) => a.type === 'activate' && a.uid === uid && a.eid === eff.eid)) {
            mk(`Effect: ${eff.eid}`, () => beginEffectFlow(uid, eff.eid, false), 'respond');
          }
        }
      }
      if (inst.faceDown && s.phase === 'main1' && inst.summonTurn < s.turn) mk('Flip Summon', () => submit({ type: 'flipSummon', uid }));
      if (!inst.faceDown && inst.summonTurn < s.turn && !inst.posChanged) {
        mk(`→ ${inst.pos === 'atk' ? 'DEF' : 'ATK'}`, () => submit({ type: 'changePosition', uid, to: inst.pos === 'atk' ? 'def' : 'atk' }));
      }
      if (inst.faceDown && s.window && s.window.forPlayer === 0) {
        for (const eff of (c.effects || [])) {
          const legal = AC.legalActions(s, 0).find((a) => a.type === 'chain' && a.uid === uid && a.eid === eff.eid);
          if (legal) mk(`Activate: ${c.name}`, () => beginEffectFlow(uid, eff.eid, true), 'respond');
        }
      }
    }
    if (!inst.faceDown || inst.ctrl === 0 || duel.revealHands) mk('Details', () => showCardModal(inst.id), 'ghost');
    mk('Cancel', () => renderDuel(), 'ghost');
  }

  // ---------- response panel ----------
  function responsePanel() {
    const s = duel.s;
    const bar = $('#action-bar');
    bar.innerHTML = `<span class="phase-hint" style="color:var(--gold-bright)">⚔ Chain response — opponent waits.</span>`;
    const options = AC.legalActions(s, 0).filter((a) => a.type === 'chain');
    for (const opt of options) {
      const c = AC.cardOf(s.insts[opt.uid]);
      const b = el('button', 'btn respond', `Chain: ${c.name}`);
      b.onclick = () => beginEffectFlow(opt.uid, opt.eid, true);
      bar.appendChild(b);
    }
    const pass = el('button', 'btn ghost', 'PASS');
    pass.onclick = () => submit({ type: 'pass' });
    bar.appendChild(pass);
  }

  // ---------- main duel render ----------
  function renderDuel(events) {
    if (!duel) return;
    const s = duel.s;
    $('#turn-banner').textContent = `TURN ${s.turn} — ${s.active === 0 ? 'YOUR' : 'ARCHIVIST'} TURN`;
    renderStrips(s);
    renderRow(s, 1, 'monsters');
    renderRow(s, 1, 'spells');
    renderRow(s, 0, 'monsters');
    renderRow(s, 0, 'spells');
    renderPiles(s);
    renderPhase(s);
    renderHand(s);
    renderChain(s);
    // actions
    const bar = $('#action-bar');
    if (flow) {
      renderFlowBar(s);
    } else if (s.window && s.window.forPlayer === 0) {
      responsePanel();
    } else if (s.active === 0 && s.winner === null) {
      bar.innerHTML = '';
      if (s.phase === 'battle') {
        const b = el('button', 'btn gold', 'END BATTLE PHASE');
        b.onclick = () => submit({ type: 'endPhase' });
        bar.appendChild(b);
      } else if (s.phase === 'main2') {
        const b = el('button', 'btn gold', 'END TURN');
        b.onclick = () => submit({ type: 'endTurn' });
        bar.appendChild(b);
      } else {
        const b1 = el('button', 'btn', 'TO BATTLE');
        b1.onclick = () => submit({ type: 'endPhase' });
        const b2 = el('button', 'btn gold', 'END TURN');
        b2.onclick = () => submit({ type: 'endTurn' });
        bar.appendChild(b1); bar.appendChild(b2);
      }
    } else bar.innerHTML = `<span class="phase-hint">The Archivist is thinking…</span>`;
    animateEvents(events);
  }

  function renderFlowBar(s) {
    const bar = $('#action-bar');
    const spec = flow.pools[flow.stage];
    bar.innerHTML = `<span class="phase-hint" style="color:var(--gold-bright)">${spec.label} — pick ${spec.pool.length ? `${flow.stage + 1}/${flow.pools.reduce((a, p) => a + p.count, 0)}` : '—'}</span>`;
    const cancel = el('button', 'btn ghost', 'Cancel');
    cancel.onclick = () => { flow = null; renderDuel(); };
    bar.appendChild(cancel);
  }

  function renderStrips(s) {
    for (const p of [0, 1]) {
      const strip = $(`#strip-p${p}`);
      const lp = s.players[p].lp;
      strip.innerHTML = `<span class="pname">${p === 0 ? 'COMMANDER (YOU)' : 'THE ARCHIVIST'}</span>
        <span class="lp ${lp._flash ? 'damaged' : ''}" style="color:${lp <= 2000 ? 'var(--danger)' : 'var(--hp)'}">${lp}</span><span class="lp-tag">LIFE</span>
        <span class="lp-tag">hand ${s.players[p].hand.length}</span>`;
    }
  }

  function renderRow(s, p, kind) {
    const row = $(`#row-p${p}-${kind}`);
    row.innerHTML = '';
    const arr = kind === 'monsters' ? s.field[p].monsters : s.field[p].spells;
    for (let i = 0; i < 5; i++) {
      const slot = el('div', 'zone-slot');
      const uid = arr[i];
      if (uid) {
        const inst = s.insts[uid];
        const known = p === 0 || !inst.faceDown || duel.revealHands;
        if (!known) {
          slot.appendChild(el('div', 'set-veil', kind === 'monsters' ? '◆' : '▼'));
          slot.dataset.uid = uid;
          slot.addEventListener('click', () => (flow ? zoneClick(uid) : fieldMenu(uid, slot)));
        } else {
          const c = AC.cardOf(inst);
          const posBadge = kind === 'monsters' ? `<span class="pos-badge">${inst.faceDown ? 'SET' : inst.pos.toUpperCase()}</span>` : (inst.faceDown ? '<span class="pos-badge">SET</span>' : '');
          const ce = cardEl(inst.id, { cls: 'in-hand', onclick: () => (flow ? zoneClick(uid) : fieldMenu(uid, null)) });
          ce.insertAdjacentHTML('beforeend', posBadge);
          if (inst.negated) ce.style.opacity = 0.5;
          const st = AC.effStats(s, uid);
          if (kind === 'monsters' && !inst.faceDown) {
            ce.querySelector('.cstats').innerHTML = `<span>${st.atk}/${st.def}</span><span>${c.attr}</span>`;
          }
          slot.appendChild(ce);
        }
      }
      if (flow && flow.pools && flow.pools[flow.stage]) {
        const spec = flow.pools[flow.stage];
        if (spec && spec.pool.includes(uid || '___')) slot.classList.add('targetable');
        if (spec && !uid && spec.allowEmpty === undefined) { /* zone slots for field targets */ }
        if (flow.kind === 'summon' && !uid && spec) { /* tribute flow targets monsters only */ }
      }
      row.appendChild(slot);
    }
  }

  function renderPiles(s) {
    for (const p of [0, 1]) {
      const box = $(`#piles-p${p}`);
      box.innerHTML = '';
      const deck = el('div', 'pile', `<b>${s.players[p].deck.count !== undefined ? s.players[p].deck.count : s.players[p].deck.length}</b><span>deck</span>`);
      const gy = el('div', 'pile', `<b>${s.players[p].gy.length}</b><span>graveyard</span>`);
      gy.onclick = () => showPile(s.players[p].gy, 'Graveyard');
      const bn = el('div', 'pile', `<b>${s.players[p].banished.length}</b><span>banished</span>`);
      bn.onclick = () => showPile(s.players[p].banished, 'Banished');
      box.appendChild(deck); box.appendChild(gy); box.appendChild(bn);
    }
  }

  function showPile(uids, title) {
    const m = $('#chain-modal');
    m.innerHTML = '';
    const box = el('div', 'modal-box');
    box.innerHTML = `<button class="close-x">✕</button><h3>${title} (${uids.length})</h3>`;
    const grid = el('div', 'card-grid');
    for (const u of uids) grid.appendChild(cardEl(duel.s.insts[u].id, { onclick: (c) => showCardModal(c.id) }));
    box.appendChild(grid);
    m.appendChild(box);
    m.hidden = false;
    box.querySelector('.close-x').onclick = () => { m.hidden = true; };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }

  function renderPhase(s) {
    const hints = { main1: 'Main Phase 1 — summon, set, activate', battle: 'Battle Phase — declare attacks', main2: 'Main Phase 2 — finish your turn', end: 'Ending…' };
    $('#phase-box').innerHTML = `<div class="phase-name">${(s.phase || '').toUpperCase()}</div><div class="phase-hint" id="phase-hint">${hints[s.phase] || ''}</div>`;
  }

  function renderHand(s) {
    const hand = $('#hand');
    hand.innerHTML = '';
    for (const uid of s.players[0].hand) {
      const c = AC.cardOf(s.insts[uid]);
      const ce = cardEl(uid && s.insts[uid].id, { cls: 'in-hand', onclick: (cc, dom) => (flow ? null : handMenu(cc.id, dom)) });
      hand.appendChild(ce);
    }
  }

  function renderChain(s) {
    const strip = $('#chain-strip');
    strip.innerHTML = '';
    if (!s.chain.length) { strip.innerHTML = '<span class="phase-hint" style="color:#3d4459">chain: idle</span>'; return; }
    s.chain.forEach((link, i) => {
      const chip = el('span', 'chain-chip' + (link.negated ? ' negated' : ''), `<span class="cl-num">${i + 1}</span> ${link.cardName} <span style="color:var(--dim)">P${link.ctrl}</span>`);
      chip.onclick = () => showChainLink(link);
      strip.appendChild(chip);
    });
    if (s.window) strip.appendChild(el('span', 'phase-hint', ` — awaiting P${s.window.forPlayer}`));
  }

  function showChainLink(link) {
    const m = $('#chain-modal');
    m.innerHTML = '';
    const box = el('div', 'modal-box');
    box.innerHTML = `<button class="close-x">✕</button><h3>Chain Link ${link.idx + 1} — ${link.cardName}</h3>
      <div class="detail-info">
        <div class="effect-line">${link.text}</div>
        <p style="color:var(--dim);font-size:13px">Controller: P${link.ctrl} · kind: ${link.kind} · speed: ${link.speed}${link.negated ? ' · <b style="color:var(--danger)">NEGATED</b>' : ''}<br>
        ${link.targets && link.targets.length ? 'Targets: ' + link.targets.map((u) => (duel.s.insts[u] ? AC.cardOf(duel.s.insts[u]).name : 'removed')).join(', ') : 'No targets'}</p>
      </div>`;
    m.appendChild(box);
    m.hidden = false;
    box.querySelector('.close-x').onclick = () => { m.hidden = true; };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }

  function showLog() {
    const m = $('#log-modal');
    m.innerHTML = '';
    const box = el('div', 'modal-box');
    box.innerHTML = `<button class="close-x">✕</button><h3>EFFECT HISTORY</h3><div class="log-lines">${duel.s.log.slice(-120).join('\n')}</div>`;
    m.appendChild(box);
    m.hidden = false;
    box.querySelector('.close-x').onclick = () => { m.hidden = true; };
    m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  }

  function animateEvents(events) {
    if (!events || !events.length) return;
    const getEl = (uid) => document.querySelector(`.zone-slot[data-uid="${uid}"] .card, .zone-slot .card`) ;
    for (const ev of events) {
      if (ev.kind === 'lp') {
        const strip = $(`#strip-p${ev.player} .lp`);
        if (strip) { strip.classList.add('damaged'); setTimeout(() => strip.classList.remove('damaged'), 600); }
      }
    }
  }

  function finishDuel() {
    const s = duel.s;
    const won = s.winner === 0;
    const ov = $('#win-overlay');
    if (won) { P.wins++; addXP(100 + P.level * 10); P.packs += 1; P.shards += 25; }
    else { P.losses++; addXP(30); }
    save();
    ov.innerHTML = `<h2>${won ? 'VICTORY' : 'DEFEAT'}</h2>
      <p class="sub">${s.winReason} · ${s.turn} turns</p>
      <p class="sub">${won ? '+1 Card Pack · +25 Shards · XP earned' : 'XP earned — the rift remembers.'}</p>
      <div><button class="btn gold" id="ov-rematch">REMATCH</button> <button class="btn" id="ov-home">HOME</button></div>`;
    ov.hidden = false;
    $('#ov-rematch').onclick = () => startDuel(duel.practice);
    $('#ov-home').onclick = () => { duel = null; nav('home'); };
  }

  // ---------- debug bar (practice) ----------
  function buildDebugBar() {
    const bar = $('#debug-bar');
    bar.innerHTML = '';
    const sel = el('select');
    for (const c of DATA.CARDS) sel.appendChild(new Option(c.name, c.id));
    const give = el('button', 'btn', 'Add to hand');
    give.onclick = () => {
      AC.debugGiveCard(duel.s, 0, sel.value);
      renderDuel();
      toast(`${DATA.CARD_BY_ID[sel.value].name} added to your hand.`);
    };
    const giveOpp = el('button', 'btn', 'Add to Archivist');
    giveOpp.onclick = () => { AC.debugGiveCard(duel.s, 1, sel.value); renderDuel(); };
    const lp = el('input'); lp.type = 'number'; lp.value = 8000; lp.style.width = '90px';
    const setlp = el('button', 'btn', 'Set my LP');
    setlp.onclick = () => { AC.debugSetLP(duel.s, 0, Number(lp.value)); renderDuel(); };
    const reveal = el('button', 'btn ghost', duel.revealHands ? 'Hide enemy hand' : 'Reveal enemy hand');
    reveal.onclick = () => { duel.revealHands = !duel.revealHands; buildDebugBar(); renderDuel(); };
    bar.append(el('span', 'phase-hint', 'TESTER:'), sel, give, giveOpp, lp, setlp, reveal);
  }

  // ================= deck builder =================
  let deckFilter = { cat: 'all', q: '' };
  let workingDeck = null;
  function renderDeckBuilder() {
    if (!workingDeck) workingDeck = JSON.parse(JSON.stringify(P.decks[P.activeDeck] || P.decks[0]));
    const fl = $('#deck-filters');
    fl.innerHTML = '';
    const search = el('input'); search.type = 'text'; search.placeholder = 'Search cards…'; search.value = deckFilter.q;
    search.oninput = () => { deckFilter.q = search.value.toLowerCase(); renderDeckCollection(); };
    fl.appendChild(search);
    for (const cat of ['all', 'monster', 'spell', 'trap']) {
      const b = el('button', 'fchip' + (deckFilter.cat === cat ? ' on' : ''), cat.toUpperCase());
      b.onclick = () => { deckFilter.cat = cat; renderDeckBuilder(); };
      fl.appendChild(b);
    }
    // slots
    const slots = $('#deck-slots');
    slots.innerHTML = '';
    P.decks.forEach((d, i) => {
      const b = el('button', 'fchip' + (P.activeDeck === i ? ' on' : ''), `${d.name} ▾`);
      b.onclick = () => { P.activeDeck = i; workingDeck = JSON.parse(JSON.stringify(d)); save(); renderDeckBuilder(); };
      slots.appendChild(b);
    });
    if (P.decks.length < 3) {
      const nb = el('button', 'fchip', '+ New deck');
      nb.onclick = () => { P.decks.push({ name: `Deck ${P.decks.length + 1}`, cards: [] }); P.activeDeck = P.decks.length - 1; workingDeck = { name: `Deck ${P.decks.length}`, cards: [] }; save(); renderDeckBuilder(); };
      slots.appendChild(nb);
    }
    const saveBtn = el('button', 'fchip on', 'SAVE');
    saveBtn.onclick = () => {
      P.decks[P.activeDeck] = JSON.parse(JSON.stringify(workingDeck));
      save(); toast('Deck saved.');
      renderDeckStatus();
    };
    slots.appendChild(saveBtn);
    renderDeckCollection();
    renderDeckList();
    renderDeckStatus();
  }
  function renderDeckCollection() {
    const grid = $('#deck-collection');
    grid.innerHTML = '';
    const deckCounts = {};
    for (const id of workingDeck.cards) deckCounts[id] = (deckCounts[id] || 0) + 1;
    for (const c of DATA.CARDS) {
      if (deckFilter.cat !== 'all' && c.cat !== deckFilter.cat) continue;
      if (deckFilter.q && !c.name.toLowerCase().includes(deckFilter.q)) continue;
      const owned = P.owned[c.id] || 0;
      const ce = cardEl(c.id, { count: owned, onclick: () => {
        if (!owned) { toast('You do not own this card yet.'); return; }
        if (workingDeck.cards.length >= DATA.DECK_SIZE) { toast(`Deck is full (40).`); return; }
        if (deckCounts[c.id] >= 3) { toast('Maximum 3 copies.'); return; }
        if (deckCounts[c.id] >= owned) { toast('Not enough copies owned.'); return; }
        workingDeck.cards.push(c.id);
        renderDeckList(); renderDeckStatus(); renderDeckCollection();
      } });
      if (!owned) ce.classList.add('locked');
      grid.appendChild(ce);
    }
  }
  function renderDeckList() {
    const list = $('#deck-list');
    list.innerHTML = '';
    const counts = {};
    for (const id of workingDeck.cards) counts[id] = (counts[id] || 0) + 1;
    const ids = Object.keys(counts).sort((a, b) => {
      const ca = DATA.CARD_BY_ID[a], cb = DATA.CARD_BY_ID[b];
      return (ca.cat === cb.cat ? cb.atk - ca.atk : ca.cat.localeCompare(cb.cat));
    });
    for (const id of ids) {
      const c = DATA.CARD_BY_ID[id];
      const line = el('div', 'deckline', `<span class="dn">${c.name}</span><span class="dx">×${counts[id]} ${c.cat === 'monster' ? `${c.atk}/${c.def}` : ''}</span>`);
      line.onclick = () => {
        workingDeck.cards.splice(workingDeck.cards.indexOf(id), 1);
        renderDeckList(); renderDeckStatus(); renderDeckCollection();
      };
      list.appendChild(line);
    }
    if (!ids.length) list.innerHTML = '<p class="phase-hint" style="padding:20px">Empty — click cards on the left to add them.</p>';
  }
  function renderDeckStatus() {
    const st = $('#deck-status');
    const n = workingDeck.cards.length;
    const ok = n === DATA.DECK_SIZE;
    st.className = 'deck-status ' + (ok ? 'valid' : 'invalid');
    st.textContent = ok ? `✔ ${n}/40 — deck legal. You can duel with this deck (remember to SAVE).` : `${n}/40 cards — decks must be exactly 40.`;
  }

  // ================= collection =================
  let colFilter = { cat: 'all', rar: 'all', q: '' };
  function renderCollection() {
    const fl = $('#col-filters');
    fl.innerHTML = '';
    const search = el('input'); search.type = 'text'; search.placeholder = 'Search cards…'; search.value = colFilter.q;
    search.oninput = () => { colFilter.q = search.value.toLowerCase(); renderColGrid(); };
    fl.appendChild(search);
    for (const cat of ['all', 'monster', 'spell', 'trap']) {
      const b = el('button', 'fchip' + (colFilter.cat === cat ? ' on' : ''), cat.toUpperCase());
      b.onclick = () => { colFilter.cat = cat; renderCollection(); };
      fl.appendChild(b);
    }
    for (const rar of ['all', 'c', 'r', 'e', 'l']) {
      const b = el('button', 'fchip' + (colFilter.rar === rar ? ' on' : ''), rar === 'all' ? 'ANY RARITY' : DATA.RARITIES[rar].name.toUpperCase());
      b.onclick = () => { colFilter.rar = rar; renderCollection(); };
      fl.appendChild(b);
    }
    const ownedCount = DATA.CARDS.filter((c) => P.owned[c.id]).length;
    $('#completion').innerHTML = `Collection: <b>${ownedCount}/${DATA.CARDS.length}</b> (${Math.round((ownedCount / DATA.CARDS.length) * 100)}%)`;
    renderColGrid();
  }
  function renderColGrid() {
    const grid = $('#col-grid');
    grid.innerHTML = '';
    for (const c of DATA.CARDS) {
      if (colFilter.cat !== 'all' && c.cat !== colFilter.cat) continue;
      if (colFilter.rar !== 'all' && c.rar !== colFilter.rar) continue;
      if (colFilter.q && !c.name.toLowerCase().includes(colFilter.q)) continue;
      const owned = P.owned[c.id] || 0;
      const ce = cardEl(c.id, { count: owned, onclick: () => showCardModal(c.id) });
      if (!owned) ce.classList.add('locked');
      grid.appendChild(ce);
    }
  }

  // ================= packs =================
  function renderPacks() {
    $('#pack-currency').innerHTML = `<span style="color:var(--gold-bright)">${P.packs} pack${P.packs === 1 ? '' : 's'}</span> · ${P.shards} shards`;
    $('#btn-open-pack').disabled = P.packs <= 0;
    $('#pack-note').textContent = P.packs > 0 ? 'Click to tear the seal.' : 'Win duels and level up to earn packs.';
    const odds = $('#odds-box');
    odds.innerHTML = '<b style="letter-spacing:.14em">PACK ODDS</b>' + Object.entries(DATA.PACK_ODDS).map(([k, v]) => `<div class="odds-row"><span style="color:${{ c: 'var(--c)', r: 'var(--r)', e: 'var(--e)', l: 'var(--l)' }[k]}">${DATA.RARITIES[k].name}</span><span>${(v * 100).toFixed(1)}%</span></div>`).join('');
    $('#shard-balance').textContent = `${P.shards} shards`;
    const grid = $('#craft-grid');
    grid.innerHTML = '';
    for (const c of DATA.CARDS) {
      const owned = P.owned[c.id] || 0;
      if (owned >= 1) continue;
      const cost = DATA.RARITIES[c.rar].craft;
      const line = el('div', 'craft-line');
      line.innerHTML = `<span class="cn" style="color:${DATA.RARITIES[c.rar].color}">${c.name}</span><span class="cost">${cost} ◈</span>`;
      const b = el('button', 'btn', 'Craft');
      b.disabled = P.shards < cost;
      b.onclick = () => { P.shards -= cost; P.owned[c.id] = (P.owned[c.id] || 0) + 1; save(); toast(`${c.name} crafted!`); renderPacks(); };
      line.appendChild(b);
      grid.appendChild(line);
    }
    if (!grid.children.length) grid.innerHTML = '<p class="phase-hint">Collection complete. The rift bows to you.</p>';
  }
  $('#btn-open-pack').addEventListener('click', () => {
    if (P.packs <= 0) return;
    P.packs--;
    const results = [];
    for (let i = 0; i < DATA.PACK_SIZE; i++) {
      let roll = Math.random(), rar = 'c';
      for (const [k, w] of Object.entries(DATA.PACK_ODDS)) { if (roll < w) { rar = k; break; } roll -= w; }
      const pool = DATA.CARDS.filter((c) => c.rar === rar);
      const card = pool[Math.floor(Math.random() * pool.length)];
      if ((P.owned[card.id] || 0) < 3) P.owned[card.id] = (P.owned[card.id] || 0) + 1;
      else P.shards += DATA.RARITIES[card.rar].shards;
      results.push(card.id);
    }
    save();
    const rev = $('#pack-reveal');
    rev.innerHTML = '';
    for (const id of results) rev.appendChild(cardEl(id, { onclick: (c) => showCardModal(c.id) }));
    const done = el('button', 'btn gold', 'COLLECT');
    done.style.cssText = 'position:absolute;bottom:30px;left:50%;transform:translateX(-50%)';
    done.onclick = () => { rev.hidden = true; renderPacks(); renderHome(); };
    rev.appendChild(done);
    rev.hidden = false;
  });

  // ================= boot =================
  renderHome();
})();
