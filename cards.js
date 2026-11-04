// AetherClash — card library (DATA ONLY, no logic).
// Every effect is a structured definition interpreted by engine.js.
// Ops the engine implements: see engine.js OPS registry.
(function (root) {
  'use strict';

  const RARITIES = {
    c: { name: 'Common', color: '#9aa7b0', packWeight: 700, shards: 5, craft: 40 },
    r: { name: 'Rare', color: '#57c7ff', packWeight: 220, shards: 20, craft: 150 },
    e: { name: 'Epic', color: '#c98bff', packWeight: 65, shards: 100, craft: 750 },
    l: { name: 'Legendary', color: '#ffc94d', packWeight: 15, shards: 400, craft: 3000 },
  };

  // effect kinds: ignition (speed1, own turn main phase), quick (speed2), trigger
  // (auto-offered window when its event fires), counter (speed3), flip, passive
  // (static while face-up), continuous (occupies zone, static).
  const C = (def) => def;

  const CARDS = [
    // ============================== MONSTERS ==============================
    // --- Vanilla frame (tribute/beatdown skeleton) ---
    C({ id: 'emberling-scout', num: 1, name: 'Emberling Scout', cat: 'monster', attr: 'FIRE', type: 'Pyro', lv: 2, atk: 800, def: 600, rar: 'c', text: 'A cinder-sprite that skims across the rift, scouting for sparks of power.' }),
    C({ id: 'tidecaller-acolyte', num: 2, name: 'Tidecaller Acolyte', cat: 'monster', attr: 'WATER', type: 'Aqua', lv: 3, atk: 1200, def: 900, rar: 'c', text: 'It learns the first word of the deep and the rift listens.' }),
    C({ id: 'galewing-dart', num: 3, name: 'Galewing Dart', cat: 'monster', attr: 'WIND', type: 'Winged Beast', lv: 3, atk: 1500, def: 700, rar: 'c', text: 'Feathers hardened into blades by centuries of storm-flight.' }),
    C({ id: 'stoneveil-sentinel', num: 4, name: 'Stoneveil Sentinel', cat: 'monster', attr: 'EARTH', type: 'Rock', lv: 4, atk: 1600, def: 1800, rar: 'c', text: 'It has never moved in living memory. That is precisely its power.' }),
    C({ id: 'umbral-drake', num: 5, name: 'Umbral Drake', cat: 'monster', attr: 'DARK', type: 'Dragon', lv: 4, atk: 1700, def: 1100, rar: 'r', text: 'A hatchling of the space between stars.' }),
    C({ id: 'lumen-squire', num: 6, name: 'Lumen Squire', cat: 'monster', attr: 'LIGHT', type: 'Warrior', lv: 3, atk: 1400, def: 1200, rar: 'c', text: 'Sworn to a knight it has never met, to a cause no one remembers.' }),

    // --- Effect monsters ---
    C({ id: 'aetherflux-familiar', num: 7, name: 'Aetherflux Familiar', cat: 'monster', attr: 'LIGHT', type: 'Spellcaster', lv: 1, atk: 300, def: 200, rar: 'r',
      text: 'When this card is sent from the field to the Graveyard: draw 1 card.',
      effects: [{ eid: 'flux', kind: 'trigger', speed: 1, trigger: { on: 'selfSentToGrave', fromField: true }, ops: [{ op: 'draw', n: 1 }] }] }),

    C({ id: 'voidling-informant', num: 8, name: 'Voidling Informant', cat: 'monster', attr: 'DARK', type: 'Fiend', lv: 1, atk: 500, def: 0, rar: 'r',
      text: 'FLIP: Peek at your opponent\'s hand.',
      effects: [{ eid: 'peek', kind: 'flip', speed: 1, ops: [{ op: 'peekOpponentHand' }] }] }),

    C({ id: 'cinderfang-prowler', num: 9, name: 'Cinderfang Prowler', cat: 'monster', attr: 'FIRE', type: 'Beast', lv: 3, atk: 1800, def: 400, rar: 'r',
      text: 'When this card is targeted for an attack (Quick Effect): it gains 700 ATK until the end of this turn.',
      effects: [{ eid: 'ember-anger', kind: 'trigger', speed: 2, oncePerTurn: true, trigger: { on: 'selfAttacked' }, ops: [{ op: 'buffSelf', atk: 700, until: 'endOfTurn' }] }] }),

    C({ id: 'gravebind-specter', num: 10, name: 'Gravebind Specter', cat: 'monster', attr: 'DARK', type: 'Zombie', lv: 4, atk: 1300, def: 1300, rar: 'r',
      text: 'Any monster destroyed by battle is banished instead of being sent to the Graveyard.',
      passive: { banishInsteadOfGYBattle: true } }),

    C({ id: 'mirrorshade-duelist', num: 11, name: 'Mirrorshade Duelist', cat: 'monster', attr: 'LIGHT', type: 'Warrior', lv: 4, atk: 1500, def: 1500, rar: 'r',
      text: 'Once per turn, during damage calculation against a face-up attack position monster: this card\'s ATK becomes equal to the attacking target\'s current ATK.',
      passive: { damageCalcCopyOpponentAtk: true, oncePerTurn: true } }),

    C({ id: 'herald-ninth-gate', num: 12, name: 'Herald of the Ninth Gate', cat: 'monster', attr: 'DARK', type: 'Fiend', lv: 5, atk: 2100, def: 1200, rar: 'r',
      text: 'If this card is Tribute Summoned: destroy 1 Spell/Trap on the field.',
      effects: [{ eid: 'gate-open', kind: 'trigger', speed: 1, trigger: { on: 'selfSummoned', tributeSummoned: true }, targeting: [{ count: 1, pool: 'anySpellTraps' }], ops: [{ op: 'destroyChosen' }] }] }),

    C({ id: 'stormcall-djinn', num: 13, name: 'Stormcall Djinn', cat: 'monster', attr: 'WIND', type: 'Thunder', lv: 5, atk: 2300, def: 1400, rar: 'r',
      text: 'If this card is Special Summoned: return 1 Spell/Trap on the field to its owner\'s hand.',
      effects: [{ eid: 'gust-back', kind: 'trigger', speed: 1, trigger: { on: 'selfSummoned', specialSummoned: true }, targeting: [{ count: 1, pool: 'anySpellTraps' }], ops: [{ op: 'bounceChosen' }] }] }),

    C({ id: 'tectonic-colossus', num: 14, name: 'Tectonic Colossus', cat: 'monster', attr: 'EARTH', type: 'Rock', lv: 7, atk: 2800, def: 2200, rar: 'e',
      text: 'Monsters your opponent controls with 1500 or less ATK cannot declare attacks.',
      passive: { lockAttack: { side: 'opponent', maxAtk: 1500 } } }),

    C({ id: 'warden-pale-fires', num: 15, name: 'Warden of Pale Fires', cat: 'monster', attr: 'LIGHT', type: 'Warrior', lv: 6, atk: 2400, def: 1500, rar: 'e',
      text: 'Once per turn: you can banish 1 monster from your Graveyard; this card permanently gains 400 ATK.',
      effects: [{ eid: 'pale-feed', kind: 'ignition', speed: 1, oncePerTurn: true, cost: [{ op: 'banishGrave', side: 'own', kind: 'monster', count: 1, chosen: true }], ops: [{ op: 'buffSelf', atk: 400, until: 'permanent' }] }] }),

    C({ id: 'aetherclaw-archon', num: 16, name: 'Aetherclaw Archon', cat: 'monster', attr: 'LIGHT', type: 'Dragon', lv: 8, atk: 3000, def: 2500, rar: 'l',
      text: 'If this card is Tribute Summoned: banish 1 monster your opponent controls.',
      effects: [{ eid: 'archon-claw', kind: 'trigger', speed: 1, trigger: { on: 'selfSummoned', tributeSummoned: true }, targeting: [{ count: 1, pool: 'oppFaceUpMonsters' }], ops: [{ op: 'banishChosen' }] }] }),

    C({ id: 'phantom-aegis-knight', num: 17, name: 'Phantom Aegis Knight', cat: 'monster', attr: 'LIGHT', type: 'Warrior', lv: 4, atk: 0, def: 2200, rar: 'r',
      text: 'While this card is in face-up Defense Position, your opponent can only select this card as an attack target.',
      passive: { taunt: true } }),

    C({ id: 'duskmire-leech', num: 18, name: 'Duskmire Leech', cat: 'monster', attr: 'WATER', type: 'Aqua', lv: 2, atk: 1000, def: 600, rar: 'c',
      text: 'When this card inflicts battle damage to your opponent: gain Life Points equal to the damage inflicted.',
      effects: [{ eid: 'leech', kind: 'trigger', speed: 1, trigger: { on: 'selfBattleDamageToOpponent' }, ops: [{ op: 'heal', fromBattleDamage: true }] }] }),

    C({ id: 'chained-wraith', num: 19, name: 'Chained Wraith', cat: 'monster', attr: 'DARK', type: 'Fiend', lv: 3, atk: 1200, def: 800, rar: 'c',
      text: 'When this card is destroyed by battle: your opponent discards 1 card at random.',
      effects: [{ eid: 'chain-guilt', kind: 'trigger', speed: 1, trigger: { on: 'selfDestroyedBattle' }, ops: [{ op: 'discardOpponent', n: 1, random: true }] }] }),

    C({ id: 'skyfarer-balloonist', num: 20, name: 'Skyfarer Balloonist', cat: 'monster', attr: 'WIND', type: 'Machine', lv: 3, atk: 700, def: 1700, rar: 'r',
      text: 'When this card destroys a monster by battle: draw 1 card.',
      effects: [{ eid: 'loot', kind: 'trigger', speed: 1, oncePerTurn: true, trigger: { on: 'selfDestroyedOpponentByBattle' }, ops: [{ op: 'draw', n: 1 }] }] }),

    C({ id: 'ironveil-bastion', num: 21, name: 'Ironveil Bastion', cat: 'monster', attr: 'EARTH', type: 'Machine', lv: 4, atk: 500, def: 2400, rar: 'r',
      text: 'Other monsters you control in Defense Position gain 400 DEF.',
      passive: { auraOwn: { def: 400, onlyDefPosition: true, excludeSelf: true } } }),

    C({ id: 'rift-pioneer', num: 22, name: 'Rift Pioneer', cat: 'monster', attr: 'LIGHT', type: 'Spellcaster', lv: 3, atk: 1400, def: 1000, rar: 'r',
      text: 'If this card is Normal Summoned: add 1 Level 3 or lower monster from your Deck to your hand.',
      effects: [{ eid: 'chart', kind: 'trigger', speed: 1, trigger: { on: 'selfSummoned', normalSummoned: true }, ops: [{ op: 'searchDeck', filter: { cat: 'monster', maxLv: 3 }, count: 1, reveal: true }] }] }),

    C({ id: 'essence-thief', num: 23, name: 'Essence Thief', cat: 'monster', attr: 'DARK', type: 'Spellcaster', lv: 4, atk: 1600, def: 1000, rar: 'e',
      text: 'Once per turn: pay 800 Life Points, then banish 1 card from your opponent\'s Graveyard.',
      effects: [{ eid: 'steal', kind: 'ignition', speed: 1, oncePerTurn: true, cost: [{ op: 'payLP', n: 800 }], targeting: [{ count: 1, pool: 'oppGraveAny' }], ops: [{ op: 'banishChosenFromGrave' }] }] }),

    C({ id: 'chronowing-oracle', num: 24, name: 'Chronowing Oracle', cat: 'monster', attr: 'LIGHT', type: 'Spellcaster', lv: 5, atk: 1900, def: 1700, rar: 'e',
      text: 'Once per turn, if a Chain of 3 or more cards resolved while this card was face-up: draw 1 card.',
      effects: [{ eid: 'echo-sight', kind: 'trigger', speed: 1, oncePerTurn: true, trigger: { on: 'chainResolved', minLinks: 3, whileFaceUp: true }, ops: [{ op: 'draw', n: 1 }] }] }),

    C({ id: 'glimmerdust-pixie', num: 25, name: 'Glimmerdust Pixie', cat: 'monster', attr: 'LIGHT', type: 'Fairy', lv: 1, atk: 0, def: 800, rar: 'c',
      text: 'When this card is sent from the field or hand to the Graveyard: add 1 Level 1 monster from your Deck to your hand.',
      effects: [{ eid: 'dust', kind: 'trigger', speed: 1, trigger: { on: 'selfSentToGrave', fromField: true, fromHand: true }, ops: [{ op: 'searchDeck', filter: { cat: 'monster', maxLv: 1 }, count: 1, reveal: true }] }] }),

    C({ id: 'battleworn-vanguard', num: 26, name: 'Battleworn Vanguard', cat: 'monster', attr: 'EARTH', type: 'Warrior', lv: 4, atk: 1900, def: 100, rar: 'c',
      text: 'When this card destroys a monster by battle: it permanently gains 200 ATK.',
      effects: [{ eid: 'scar-up', kind: 'trigger', speed: 1, trigger: { on: 'selfDestroyedOpponentByBattle' }, ops: [{ op: 'buffSelf', atk: 200, until: 'permanent' }] }] }),

    C({ id: 'hollowmoon-stargazer', num: 27, name: 'Hollowmoon Stargazer', cat: 'monster', attr: 'LIGHT', type: 'Spellcaster', lv: 2, atk: 600, def: 1500, rar: 'r',
      text: 'FLIP: Add 1 Trap Card from your Deck to your hand.',
      effects: [{ eid: 'starchart', kind: 'flip', speed: 1, ops: [{ op: 'searchDeck', filter: { cat: 'trap' }, count: 1, reveal: true }] }] }),

    C({ id: 'riftmaw-glutton', num: 28, name: 'Riftmaw Glutton', cat: 'monster', attr: 'DARK', type: 'Dragon', lv: 5, atk: 2200, def: 1800, rar: 'r',
      text: 'Once per turn: you can Tribute 1 monster (except this card); this card gains ATK equal to the Tributed monster\'s ATK until the end of this turn.',
      effects: [{ eid: 'devour', kind: 'ignition', speed: 1, oncePerTurn: true, cost: [{ op: 'tributeOwn', n: 1, chosen: true, excludeSelf: true }], ops: [{ op: 'buffSelf', fromTributedAtk: true, until: 'endOfTurn' }] }] }),

    C({ id: 'aegis-first-light', num: 29, name: 'Aegis of the First Light', cat: 'monster', attr: 'LIGHT', type: 'Fairy', lv: 4, atk: 800, def: 2100, rar: 'c',
      text: 'FLIP: You take no battle damage this turn.',
      effects: [{ eid: 'aegis-glow', kind: 'flip', speed: 1, ops: [{ op: 'noBattleDamageThisTurn' }] }] }),

    C({ id: 'twinfang-hatchling', num: 30, name: 'Twinfang Hatchling', cat: 'monster', attr: 'FIRE', type: 'Dragon', lv: 3, atk: 1500, def: 1000, rar: 'r',
      text: 'If you control a Dragon monster, you can Special Summon this card (from your hand).',
      condition: { controlType: 'Dragon' },
      specialSummon: { from: 'hand' } }),

    C({ id: 'oathbound-revenant', num: 31, name: 'Oathbound Revenant', cat: 'monster', attr: 'DARK', type: 'Warrior', lv: 5, atk: 2000, def: 1500, rar: 'r',
      text: 'If your Life Points are 4000 or less, you can Special Summon this card (from your hand) without Tributing.',
      condition: { lpAtMost: 4000 },
      specialSummon: { from: 'hand', noTribute: true } }),

    // ============================== SPELLS ==============================
    C({ id: 'aether-surge', num: 32, name: 'Aether Surge', cat: 'spell', kind: 'normal', rar: 'r',
      text: 'Draw 2 cards.',
      effects: [{ eid: 'surge', kind: 'ignition', speed: 1, ops: [{ op: 'draw', n: 2 }] }] }),

    C({ id: 'rift-cataclysm', num: 33, name: 'Rift Cataclysm', cat: 'spell', kind: 'normal', rar: 'e',
      text: 'Destroy all face-up monsters with 2000 or less ATK.',
      effects: [{ eid: 'cataclysm', kind: 'ignition', speed: 1, ops: [{ op: 'destroyAll', side: 'both', maxAtk: 2000, faceUpOnly: true }] }] }),

    C({ id: 'unmaking-sigil', num: 34, name: 'Unmaking Sigil', cat: 'spell', kind: 'normal', rar: 'r',
      text: 'Target 1 face-up monster on the field: banish it.',
      effects: [{ eid: 'unmake', kind: 'ignition', speed: 1, targeting: [{ count: 1, pool: 'anyFaceUpMonsters' }], ops: [{ op: 'banishChosen' }] }] }),

    C({ id: 'soul-exchange', num: 35, name: 'Soul Exchange', cat: 'spell', kind: 'normal', rar: 'r',
      text: 'Target 1 monster your opponent controls: this turn, you can use it as 1 Tribute for a Tribute Summon.',
      effects: [{ eid: 'exchange', kind: 'ignition', speed: 1, targeting: [{ count: 1, pool: 'oppMonsters' }], ops: [{ op: 'grantTributeFromOpponent', n: 1 }] }] }),

    C({ id: 'mend-the-veil', num: 36, name: 'Mend the Veil', cat: 'spell', kind: 'normal', rar: 'c',
      text: 'Gain 1500 Life Points.',
      effects: [{ eid: 'mend', kind: 'ignition', speed: 1, ops: [{ op: 'heal', n: 1500 }] }] }),

    C({ id: 'scouting-the-rift', num: 37, name: 'Scouting the Rift', cat: 'spell', kind: 'normal', rar: 'c',
      text: 'Add 1 Level 4 or lower monster from your Deck to your hand.',
      effects: [{ eid: 'scout', kind: 'ignition', speed: 1, ops: [{ op: 'searchDeck', filter: { cat: 'monster', maxLv: 4 }, count: 1, reveal: true }] }] }),

    C({ id: 'emberfall', num: 38, name: 'Emberfall', cat: 'spell', kind: 'normal', rar: 'c',
      text: 'Inflict 800 damage to your opponent.',
      effects: [{ eid: 'ember', kind: 'ignition', speed: 1, ops: [{ op: 'damageDirect', n: 800 }] }] }),

    C({ id: 'aegis-lantern', num: 39, name: 'Aegis Lantern', cat: 'spell', kind: 'continuous', rar: 'c',
      text: 'All monsters you control gain 300 ATK and DEF.',
      effects: [{ eid: 'place', kind: 'ignition', speed: 1, ops: [] }],
      passive: { auraOwn: { atk: 300, def: 300 } } }),

    C({ id: 'weight-of-the-deep', num: 40, name: 'Weight of the Deep', cat: 'spell', kind: 'continuous', rar: 'r',
      text: 'All face-up monsters on the field lose 500 ATK.',
      effects: [{ eid: 'place', kind: 'ignition', speed: 1, ops: [] }],
      passive: { auraAll: { atk: -500, faceUpOnly: true } } }),

    C({ id: 'recall-from-ruin', num: 41, name: 'Recall from Ruin', cat: 'spell', kind: 'normal', rar: 'r',
      text: 'Add 1 monster from your Graveyard to your hand.',
      effects: [{ eid: 'recall', kind: 'ignition', speed: 1, targeting: [{ count: 1, pool: 'ownGraveMonsters' }], ops: [{ op: 'gyToHand' }] }] }),

    C({ id: 'gate-of-echoes', num: 42, name: 'Gate of Echoes', cat: 'spell', kind: 'field', rar: 'r',
      text: 'Each time a player Tribute Summons a monster, that player draws 1 card.',
      effects: [{ eid: 'place', kind: 'ignition', speed: 1, ops: [] }],
      passive: { onTributeSummonDraw: 1 } }),

    C({ id: 'flash-of-foresight', num: 43, name: 'Flash of Foresight', cat: 'spell', kind: 'normal', rar: 'c',
      text: 'Look at 1 face-down card on the field.',
      effects: [{ eid: 'foresight', kind: 'ignition', speed: 1, targeting: [{ count: 1, pool: 'anyFacedown' }], ops: [{ op: 'lookAtSetCard' }] }] }),

    // ============================== TRAPS ==============================
    C({ id: 'rift-snare', num: 44, name: 'Rift Snare', cat: 'trap', kind: 'normal', rar: 'r',
      text: 'When your opponent Normal or Special Summons a monster: destroy that monster.',
      effects: [{ eid: 'snare', kind: 'trigger', speed: 2, trigger: { on: 'opponentMonsterSummoned' }, targeting: [{ count: 1, pool: 'theSummonedMonster' }], ops: [{ op: 'destroyChosen' }] }] }),

    C({ id: 'negation-wards', num: 45, name: 'Negation Wards', cat: 'trap', kind: 'counter', rar: 'l',
      text: 'When a Spell/Trap Card is activated: negate the activation, and banish that card.',
      effects: [{ eid: 'wards', kind: 'counter', speed: 3, trigger: { on: 'spellTrapActivated' }, ops: [{ op: 'negateLinkBanish', offset: 1 }] }] }),

    C({ id: 'aether-refusal', num: 46, name: 'Aether Refusal', cat: 'trap', kind: 'counter', rar: 'l',
      text: 'When a card or effect is activated: negate the activation.',
      effects: [{ eid: 'refusal', kind: 'counter', speed: 3, trigger: { on: 'anyEffectActivated' }, ops: [{ op: 'negateLink', offset: 1 }] }] }),

    C({ id: 'vengeful-rebound', num: 47, name: 'Vengeful Rebound', cat: 'trap', kind: 'normal', rar: 'r',
      text: 'When a monster you control is destroyed by battle: inflict damage to your opponent equal to its ATK.',
      effects: [{ eid: 'rebound', kind: 'trigger', speed: 2, trigger: { on: 'ownMonsterDestroyedByBattle' }, ops: [{ op: 'damageDirect', fromDestroyedAtk: true }] }] }),

    C({ id: 'phalanx-protocol', num: 48, name: 'Phalanx Protocol', cat: 'trap', kind: 'continuous', rar: 'e',
      text: 'Monsters you control cannot be destroyed by battle.',
      effects: [{ eid: 'place', kind: 'ignition', speed: 1, ops: [] }],
      passive: { ownMonstersNoBattleDestroy: true } }),

    C({ id: 'glacial-standstill', num: 49, name: 'Glacial Standstill', cat: 'trap', kind: 'normal', rar: 'r',
      text: 'When a monster declares an attack: monsters cannot attack for the rest of this turn.',
      effects: [{ eid: 'standstill', kind: 'trigger', speed: 2, trigger: { on: 'attackDeclared' }, ops: [{ op: 'preventAttacksThisTurn' }] }] }),

    C({ id: 'buried-grudge', num: 50, name: 'Buried Grudge', cat: 'trap', kind: 'normal', rar: 'c',
      text: 'When your opponent activates a Spell Card: inflict 600 damage.',
      effects: [{ eid: 'grudge', kind: 'trigger', speed: 2, trigger: { on: 'opponentSpellActivated' }, ops: [{ op: 'damageDirect', n: 600 }] }] }),

    C({ id: 'second-wind', num: 51, name: 'Second Wind', cat: 'trap', kind: 'normal', rar: 'r',
      text: 'Target 1 monster in your Graveyard with 1500 or less ATK: Special Summon it in face-up Defense Position.',
      effects: [{ eid: 'second-wind', kind: 'trigger', speed: 2, trigger: { on: 'ownMonsterDestroyedByBattle', optional: true }, targeting: [{ count: 1, pool: 'ownGraveMonsters', filter: { maxAtk: 1500 } }], ops: [{ op: 'summonFromGrave', position: 'def' }] }] }),

    C({ id: 'aetherback-clutch', num: 52, name: 'Aetherback Clutch', cat: 'trap', kind: 'counter', rar: 'e',
      text: 'When a Trap Card is activated: negate the activation, and draw 1 card.',
      effects: [{ eid: 'clutch', kind: 'counter', speed: 3, trigger: { on: 'trapActivated' }, ops: [{ op: 'negateLink', offset: 1 }, { op: 'draw', n: 1 }] }] }),

    C({ id: 'void-lock', num: 53, name: 'Void Lock', cat: 'trap', kind: 'continuous', rar: 'e',
      text: 'Monsters your opponent controls with 2400 or more ATK cannot declare attacks.',
      effects: [{ eid: 'place', kind: 'ignition', speed: 1, ops: [] }],
      passive: { lockAttack: { side: 'opponent', minAtk: 2400 } } }),
  ];

  // ---------------- Deck / pack tables ----------------
  const STARTER_DECK = [
    ['emberling-scout', 3], ['tidecaller-acolyte', 3], ['galewing-dart', 2], ['stoneveil-sentinel', 2],
    ['umbral-drake', 2],
    ['aetherflux-familiar', 2], ['cinderfang-prowler', 2], ['gravebind-specter', 1], ['mirrorshade-duelist', 1],
    ['herald-ninth-gate', 1], ['stormcall-djinn', 2], ['rift-pioneer', 2], ['twinfang-hatchling', 1],
    ['battleworn-vanguard', 2], ['hollowmoon-stargazer', 1], ['phantom-aegis-knight', 1], ['aegis-first-light', 1],
    ['scouting-the-rift', 2], ['aether-surge', 2], ['mend-the-veil', 1], ['emberfall', 1], ['aegis-lantern', 1],
    ['unmaking-sigil', 1], ['rift-snare', 2], ['glacial-standstill', 1],
  ];

  const AI_DECK = [
    ['galewing-dart', 3], ['tidecaller-acolyte', 2], ['stoneveil-sentinel', 3], ['umbral-drake', 2],
    ['lumen-squire', 2], ['battleworn-vanguard', 2], ['cinderfang-prowler', 2], ['gravebind-specter', 1],
    ['skyfarer-balloonist', 1], ['ironveil-bastion', 1], ['herald-ninth-gate', 1], ['stormcall-djinn', 2],
    ['tectonic-colossus', 1], ['riftmaw-glutton', 1], ['aetherflux-familiar', 1], ['duskmire-leech', 2],
    ['chained-wraith', 2], ['aether-surge', 2], ['scouting-the-rift', 2], ['emberfall', 2], ['mend-the-veil', 1],
    ['rift-snare', 1], ['buried-grudge', 1], ['second-wind', 1],
  ];

  const PACK_SIZE = 5;
  const PACK_ODDS = { c: 0.70, r: 0.22, e: 0.065, l: 0.015 };
  const MAX_COPIES = 3;
  const DECK_SIZE = 40;
  const START_LP = 8000;

  function expandDeck(list) {
    const out = [];
    for (const [id, n] of list) for (let i = 0; i < n; i++) out.push(id);
    return out;
  }

  const CARD_BY_ID = {};
  for (const card of CARDS) CARD_BY_ID[card.id] = card;

  const AetherClashData = { CARDS, CARD_BY_ID, RARITIES, STARTER_DECK, AI_DECK, PACK_SIZE, PACK_ODDS, MAX_COPIES, DECK_SIZE, START_LP, expandDeck };
  root.ACData = AetherClashData;
  if (typeof module !== 'undefined' && module.exports) module.exports = AetherClashData;
})(typeof globalThis !== 'undefined' ? globalThis : window);
