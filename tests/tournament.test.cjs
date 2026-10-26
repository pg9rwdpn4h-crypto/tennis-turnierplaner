const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Load the planner without the DOM event wiring; keep the production algorithms intact.
function planner(saved = null) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const startup = source.lastIndexOf("\n  $$('.tab').forEach");
  assert.ok(startup > 0);
  const storage = new Map(saved ? [['courtpilot-tournament-v1', JSON.stringify(saved)]] : []);
  const sandbox = { structuredClone, crypto: webcrypto, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  } };
  vm.runInNewContext(source.slice(0, startup) + '\n function activateTournament(id) { activeTournamentId = id; library.activeId = id; saveLibrary(); } globalThis.planner = { suggestThreeKingsGames, generateThreeKings, courtLabel, state, library, activeTournamentId, appendTournamentRound, additionalRoundError, removeTournamentRound, loadState, removeLocalTournament, generateSingles, generateRoundRobin, limitRounds, generatePartnerMix, partnerMixValidation, scheduleMatches, calculateStandings, calculatePlayerStandings, rememberParticipants, restoreParticipants, formatCountdown, countdownRemaining }; })();', sandbox);
  sandbox.planner.storage = storage;
  return sandbox.planner;
}

test('three kings suggests the smallest valid games in the court ratio', () => {
  const p = planner();
  const settings = counts => Object.fromEntries(['tennis', 'badminton', 'tableTennis'].map((s, i) => [s, { courts: counts[i] }]));
  assert.deepEqual({ ...p.suggestThreeKingsGames(12, settings([1, 2, 3])) }, { tennis: 1, badminton: 2, tableTennis: 3 });
  assert.deepEqual({ ...p.suggestThreeKingsGames(9, settings([1, 2, 3])) }, { tennis: 4, badminton: 8, tableTennis: 12 });
  assert.deepEqual({ ...p.suggestThreeKingsGames(6, settings([2, 4, 6])) }, { tennis: 2, badminton: 4, tableTennis: 6 });
  assert.equal(p.suggestThreeKingsGames(3, settings([1, 2, 3])), null);
  assert.equal(p.suggestThreeKingsGames(8, settings([0, 2, 3])), null);
  for (let count = 4; count <= 12; count++) for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) {
    const games = Object.values(p.suggestThreeKingsGames(count, settings([a, b, c])));
    for (const g of games) { assert.ok(Number.isInteger(g) && g >= 1 && g <= 48); assert.equal(count * g % 4, 0); }
    assert.equal(games[0] * b, games[1] * a);
    assert.equal(games[0] * c, games[2] * a);
    // No smaller first component can yield another valid proportional combination.
    for (let first = 1; first < games[0]; first++) {
      const candidate = [first, first * b / a, first * c / a];
      assert.ok(!candidate.every(g => Number.isInteger(g) && count * g % 4 === 0));
    }
  }
});

test('large three kings suggestions are accepted and remain intact after reload', () => {
  const p = planner();
  const players = ['A', 'B', 'C', 'D', 'E'];
  const settings = { tennis: { courts: 12 }, badminton: { courts: 11 }, tableTennis: { courts: 1 } };
  const suggestion = p.suggestThreeKingsGames(players.length, settings);
  assert.equal(suggestion.tennis, 48);
  for (const key of Object.keys(settings)) settings[key].games = suggestion[key];
  p.state.disciplineSettings = settings; p.state.participants = players;
  const matches = p.generateThreeKings(players);
  for (const sport of Object.keys(settings)) for (const name of players) {
    assert.equal(matches.filter(m => m.discipline === sport && [...m.playersA, ...m.playersB].includes(name)).length, suggestion[sport]);
  }
  const loaded = planner({ format: 'threeKings', participants: players, disciplineSettings: settings });
  assert.equal(loaded.state.disciplineSettings.tennis.games, 48);
});

test('optional table tennis singles and triples preserve exact quotas and court reservations', () => {
  let singles = 0, triples = 0;
  for (const size of [4, 5, 6, 7, 8, 9, 12, 16]) for (const courtCounts of [[1, 1, 1], [2, 1, 3]]) for (const target of [1, 2, 3, 4]) for (let attempt = 0; attempt < 3; attempt++) {
    if (size * target % 2) continue;
    const p = planner();
    const names = Array.from({ length: size }, (_, i) => `P${i}`);
    const unit = size % 2 ? 4 : size % 4 ? 2 : 1;
    p.state.participants = names;
    p.state.disciplineSettings = {
      tennis: { courts: courtCounts[0], games: unit },
      badminton: { courts: courtCounts[1], games: unit },
      tableTennis: { courts: courtCounts[2], games: target, flexible: true }
    };
    const matches = p.generateThreeKings(names);
    for (const sport of ['tennis', 'badminton', 'tableTennis']) for (const name of names) {
      assert.equal(matches.filter(m => m.discipline === sport && [...m.playersA, ...m.playersB].includes(name)).length, p.state.disciplineSettings[sport].games);
    }
    const reservations = new Map();
    for (const m of matches) {
      if (m.matchKind) assert.equal(m.discipline, 'tableTennis');
      singles += m.matchKind === 'singles'; triples += m.matchKind === 'triple';
      const key = m.reservationId || m.id;
      reservations.set(key, [...(reservations.get(key) || []), m]);
    }
    const slots = new Map();
    for (const reservation of reservations.values()) {
      const m = reservation[0];
      const slot = slots.get(m.slot) || { names: new Set(), courts: new Set() };
      assert.ok(!slot.courts.has(m.court)); slot.courts.add(m.court);
      const active = new Set(reservation.flatMap(m => [...m.playersA, ...m.playersB]));
      for (const name of active) { assert.ok(!slot.names.has(name)); slot.names.add(name); }
      if (m.matchKind === 'triple') {
        assert.equal(reservation.length, 3); assert.equal(active.size, 3);
        assert.equal(new Set(reservation.map(m => m.sequence)).size, 3);
        for (const name of active) assert.equal(reservation.filter(m => [...m.playersA, ...m.playersB].includes(name)).length, 2);
      }
      slots.set(m.slot, slot);
    }
  }
  assert.ok(singles > 0); assert.ok(triples > 0);
});

test('table tennis flexibility is opt-in, changes recommendations, and survives reload', () => {
  const settings = { tennis: { courts: 2, games: 2 }, badminton: { courts: 2, games: 2 }, tableTennis: { courts: 1, games: 1 } };
  const p = planner();
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  p.state.disciplineSettings = settings;
  assert.equal(p.suggestThreeKingsGames(6, settings).tableTennis, 2);
  assert.throws(() => p.generateThreeKings(names), /Tischtennis/);
  settings.tableTennis.flexible = true;
  assert.equal(p.suggestThreeKingsGames(6, settings).tableTennis, 1);
  assert.ok(p.generateThreeKings(names).some(m => m.matchKind === 'singles'));
  assert.throws(() => p.generateThreeKings(names.slice(0, 5)), /Tennis/);
  settings.tennis.games = 4; settings.badminton.games = 4;
  assert.throws(() => p.generateThreeKings(names.slice(0, 5)), /Tischtennis/);
  const loaded = planner({ format: 'threeKings', participants: names, disciplineSettings: settings });
  assert.equal(loaded.state.disciplineSettings.tableTennis.flexible, true);
  assert.equal(planner().state.disciplineSettings.tableTennis.flexible, false);
});

test('triple round results count as two singles per person', () => {
  const p = planner();
  const matches = [
    { teamA: 'Anna', teamB: 'Ben', playersA: ['Anna'], playersB: ['Ben'], scoreA: 11, scoreB: 5, sequence: 1 },
    { teamA: 'Anna', teamB: 'Cem', playersA: ['Anna'], playersB: ['Cem'], scoreA: 11, scoreB: 8, sequence: 2 },
    { teamA: 'Ben', teamB: 'Cem', playersA: ['Ben'], playersB: ['Cem'], scoreA: 3, scoreB: 11, sequence: 3 }
  ].map(m => ({ ...m, discipline: 'tableTennis', disciplineCourt: 1, court: 3, slot: 0, round: 1, roundLabel: 'Zeitblock 1', matchKind: 'triple', reservationId: 'triple1' }));
  const rows = p.calculatePlayerStandings(['Anna', 'Ben', 'Cem'], matches);
  assert.ok(rows.every(row => row.played === 2));
  assert.equal(rows[0].name, 'Anna'); assert.equal(rows[0].wins, 2);
});

test('every discipline independently supports optional singles and triples', () => {
  const sports = ['tennis', 'badminton', 'tableTennis'];
  const observed = new Set();
  for (let mask = 0; mask < 8; mask++) for (const size of [5, 6, 7, 8, 9, 12]) for (let repeat = 0; repeat < 4; repeat++) {
    const p = planner();
    const names = Array.from({ length: size }, (_, i) => `P${i}`);
    p.state.participants = names;
    p.state.disciplineSettings = Object.fromEntries(sports.map((sport, index) => [sport, {
      courts: index + 1, flexible: !!(mask & (1 << index)),
      games: mask & (1 << index) ? (size % 2 ? 2 : 1) : (size % 2 ? 4 : size % 4 ? 2 : 1)
    }]));
    const matches = p.generateThreeKings(names);
    const slots = new Map();
    const reservations = new Map();
    for (const m of matches) {
      if (m.matchKind) { assert.ok(p.state.disciplineSettings[m.discipline].flexible); observed.add(`${m.discipline}:${m.matchKind}`); }
      const key = m.reservationId || m.id;
      reservations.set(key, [...(reservations.get(key) || []), m]);
    }
    for (const group of reservations.values()) {
      const first = group[0];
      const slot = slots.get(first.slot) || { courts: new Set(), names: new Set() };
      assert.ok(!slot.courts.has(first.court)); slot.courts.add(first.court);
      for (const name of new Set(group.flatMap(m => [...m.playersA, ...m.playersB]))) { assert.ok(!slot.names.has(name)); slot.names.add(name); }
      slots.set(first.slot, slot);
    }
    for (const sport of sports) for (const name of names) assert.equal(matches.filter(m => m.discipline === sport && [...m.playersA, ...m.playersB].includes(name)).length, p.state.disciplineSettings[sport].games);
    const loaded = planner({ format: 'threeKings', participants: names, disciplineSettings: p.state.disciplineSettings });
    for (const sport of sports) assert.equal(loaded.state.disciplineSettings[sport].flexible, p.state.disciplineSettings[sport].flexible);
    const suggestion = p.suggestThreeKingsGames(size, p.state.disciplineSettings);
    for (const sport of sports) assert.equal(size * suggestion[sport] % (p.state.disciplineSettings[sport].flexible ? 2 : 4), 0);
  }
  for (const sport of sports) {
    const p = planner();
    const names = Array.from({ length: 7 }, (_, i) => `P${i}`);
    p.state.participants = names;
    p.state.disciplineSettings = Object.fromEntries(sports.map(s => [s, { courts: 1, games: s === sport ? 2 : 4, flexible: s === sport }]));
    const matches = p.generateThreeKings(names);
    assert.ok(matches.some(m => m.discipline === sport && m.matchKind === 'triple'));
    assert.ok(observed.has(`${sport}:singles`));
  }
});

test('three kings gives exact per-sport quotas without player or court conflicts', () => {
  for (const size of [4, 5, 6, 8, 9, 12, 16, 24, 40]) for (const capacities of [[1, 1, 1], [1, 3, 2], [4, 1, 12]]) for (let repeat = 0; repeat < 6; repeat++) {
    const p = planner();
    const players = Array.from({ length: size }, (_, i) => `P${i}`);
    const unit = size % 2 ? 4 : size % 4 ? 2 : 1;
    p.state.format = 'threeKings'; p.state.mode = 'partnerMix';
    p.state.participants = players;
    const sports = ['tennis', 'badminton', 'tableTennis'];
    p.state.disciplineSettings = Object.fromEntries(sports.map((s, i) => [s, { courts: capacities[i], games: unit * (i + 1) }]));
    const matches = p.generateThreeKings(players);
    const counts = Object.fromEntries(sports.map(s => [s, Object.fromEntries(players.map(n => [n, 0]))]));
    const slots = new Map();
    for (const m of matches) {
      const block = slots.get(m.slot) || { players: new Set(), courts: new Set() };
      assert.ok(!block.courts.has(m.court)); block.courts.add(m.court);
      const index = sports.indexOf(m.discipline);
      const offset = capacities.slice(0, index).reduce((a, b) => a + b, 0);
      assert.ok(m.court > offset && m.court <= offset + capacities[index]);
      assert.equal(m.disciplineCourt, m.court - offset);
      for (const name of [...m.playersA, ...m.playersB]) {
        assert.ok(!block.players.has(name)); block.players.add(name); counts[m.discipline][name]++;
      }
      slots.set(m.slot, block);
    }
    for (const s of sports) for (const n of players) assert.equal(counts[s][n], p.state.disciplineSettings[s].games);
    p.state.matches = matches; p.state.teams = players; p.state.courts = capacities.reduce((a, b) => a + b, 0);
  }
});

test('three kings rejects impossible quotas and restores saved settings and results', () => {
  const p = planner();
  assert.throws(() => p.generateThreeKings(['A', 'B', 'C']), /mindestens vier/);
  assert.throws(() => p.generateThreeKings(['A', 'B', 'C', 'D', 'E']), /Tennis/);
  assert.throws(() => p.generateThreeKings(['A', 'B', 'C', 'A']), /eindeutig/);
  const loaded = planner({ format: 'threeKings', participants: ['A', 'B', 'C', 'D'], disciplineSettings: { tennis: { courts: 3, games: 4 } }, matches: [{ scoreA: 5, scoreB: 3 }] });
  assert.equal(loaded.state.format, 'threeKings');
  assert.equal(loaded.state.mode, 'partnerMix');
  assert.equal(loaded.state.disciplineSettings.tennis.courts, 3);
  assert.equal(loaded.state.disciplineSettings.badminton.games, 3);
  assert.equal(loaded.state.matches[0].scoreA, 5);
  assert.equal(loaded.state.matches[0].scoringMode, undefined);
  const empty = planner({ format: 'threeKings', matches: [{ scoreA: '', scoreB: '' }] });
  assert.equal(empty.state.matches[0].scoringMode, 'sets7');
  assert.equal(empty.state.matches[0].finished, false);
  const savedSets = planner({ format: 'threeKings', matches: [{ scoringMode: 'sets7', sets: [{ a: 7, b: 6 }], currentSetA: 3, currentSetB: 1, scoreA: '', scoreB: '', finished: false }] });
  assert.equal(savedSets.state.matches[0].sets.length, 1); assert.equal(savedSets.state.matches[0].currentSetA, 3);
});

test('existing single tournament is migrated into a separate saved tournament', () => {
  const p = planner({ name: 'Sommer-Cup', date: '2026-08-01', matches: [{ scoreA: 6, scoreB: 4 }], participants: ['A', 'B'] });
  assert.equal(p.library.items.length, 1);
  assert.equal(p.library.items[0].name, 'Sommer-Cup');
  assert.equal(p.library.items[0].hasSchedule, true);
  assert.equal(p.loadState(p.activeTournamentId).matches[0].scoreA, 6);
});

test('additional rounds preserve existing games and give every scheduled participant exactly one game', () => {
  for (const mode of ['singles', 'fixed', 'partnerMix']) {
    for (const courts of [1, 3, 12]) {
      const p = planner();
      p.state.format = mode === 'singles' ? 'singles' : 'doubles';
      p.state.mode = mode === 'partnerMix' ? 'partnerMix' : 'limited';
      p.state.courts = courts;
      p.state.teams = Array.from({ length: 12 }, (_, i) => `P${i}`);
      p.state.matches = p.scheduleMatches(mode === 'partnerMix'
        ? p.generatePartnerMix(p.state.teams, 1)
        : p.generateRoundRobin(p.state.teams));
      p.state.matches[0].scoreA = 6; p.state.matches[0].scoreB = 3;
      p.state.liveId = 'existing-link';
      p.state.participants = ['Changed preparation roster'];
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = JSON.stringify(p.state.matches);
        const length = p.state.matches.length;
        const lastSlot = Math.max(...p.state.matches.map(m => m.slot));
        const lastRound = Math.max(...p.state.matches.map(m => m.round));
        const added = p.appendTournamentRound();
        assert.equal(JSON.stringify(p.state.matches.slice(0, length)), before);
        assert.equal(p.state.liveId, 'existing-link');
        const counts = new Map(p.state.teams.map(name => [name, 0]));
        const slots = new Map();
        for (const match of added) {
          assert.ok(match.slot > lastSlot);
          assert.equal(match.round, lastRound + 1);
          assert.equal(match.roundLabel, `Runde ${lastRound + 1}`);
          assert.equal(match.scoreA, ''); assert.equal(match.scoreB, '');
          const occupied = slots.get(match.slot) || new Set();
          assert.ok(!occupied.has(match.court)); occupied.add(match.court); slots.set(match.slot, occupied);
          assert.ok(match.court >= 1 && match.court <= courts);
          const players = mode === 'partnerMix' ? [...match.playersA, ...match.playersB] : [match.teamA, match.teamB];
          players.forEach(name => counts.set(name, counts.get(name) + 1));
        }
        assert.ok([...counts.values()].every(count => count === 1));
        assert.equal(new Set(p.state.matches.map(m => m.id)).size, p.state.matches.length);
      }
    }
  }
});

test('removing a round deletes every time block and preserves other games in all formats', async () => {
  for (const mode of ['singles', 'fixed', 'partnerMix']) {
    const p = planner();
    p.state.format = mode === 'singles' ? 'singles' : 'doubles';
    p.state.mode = mode === 'partnerMix' ? 'partnerMix' : 'limited';
    p.state.courts = 1;
    p.state.teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    p.state.matches = p.scheduleMatches(mode === 'partnerMix'
      ? p.generatePartnerMix(p.state.teams, 1) : p.generateRoundRobin(p.state.teams));
    const added = p.appendTournamentRound();
    added.at(-1).scoreA = 6; added.at(-1).scoreB = 2;
    const number = added[0].round;
    const later = p.appendTournamentRound();
    const kept = JSON.stringify(p.state.matches.filter(match => match.round !== number));
    p.state.liveId = 'keep-live-link';
    const counts = p.state.matches.length;
    assert.equal(await p.removeTournamentRound(number, async (message, title) => {
      assert.match(message, /Zeitblöcken/);
      assert.match(message, /bereits Ergebnisse/);
      assert.equal(title, 'Rotation entfernen?');
      assert.equal(p.state.matches.length, counts);
      return true;
    }), true);
    assert.equal(JSON.stringify(p.state.matches), kept);
    assert.equal(p.state.liveId, 'keep-live-link');
    assert.ok(p.state.matches.includes(later[0]));
    const next = p.appendTournamentRound();
    assert.equal(next[0].round, later[0].round + 1);
    const standings = mode === 'partnerMix'
      ? p.calculatePlayerStandings(p.state.teams, p.state.matches)
      : p.calculateStandings(p.state.teams, p.state.matches);
    assert.ok(standings.every(row => row.played === 0));
  }
});

test('removal warns for partial and zero scores; cancelling preserves all data', async () => {
  for (const [scoreA, scoreB] of [[0, ''], ['', '0'], [6, 3], ['', '']]) {
    const p = planner();
    p.state.teams = ['A', 'B'];
    p.state.matches = [{ id: 'keep', teamA: 'A', teamB: 'B', round: 1, slot: 0, scoreA, scoreB }];
    const before = JSON.stringify(p.state);
    assert.equal(await p.removeTournamentRound(1, async message => {
      assert.equal(message.includes('bereits Ergebnisse'), scoreA !== '' || scoreB !== '');
      return false;
    }), false);
    assert.equal(JSON.stringify(p.state), before);
  }
});

test('last round can be removed; missing rounds and changed schedules are left alone', async () => {
  const p = planner();
  p.state.teams = ['A', 'B'];
  p.state.matches = [{ id: 'last', teamA: 'A', teamB: 'B', round: 1, slot: 0, scoreA: '', scoreB: '' }];
  assert.equal(await p.removeTournamentRound(99, async () => assert.fail('No dialog for missing round')), false);
  assert.equal(await p.removeTournamentRound(1, async () => true), true);
  assert.equal(p.state.matches.length, 0);
  p.state.matches = [{ id: 'old', teamA: 'A', teamB: 'B', round: 1, slot: 0 }];
  const replacement = [{ id: 'remote-update', round: 1, slot: 0 }];
  assert.equal(await p.removeTournamentRound(1, async () => {
    p.state.matches = replacement;
    return true;
  }), false);
  assert.equal(p.state.matches, replacement);
});

test('rotation removal gives every participant equal losses despite byes and limited courts', async () => {
  for (const mode of ['singles', 'fixed', 'partnerMix']) {
    for (const courts of [1, 3]) {
      for (const selected of [1, 2, 3]) {
        const p = planner();
        p.state.format = mode === 'singles' ? 'singles' : 'doubles';
        p.state.mode = mode === 'partnerMix' ? 'partnerMix' : 'limited';
        p.state.courts = courts;
        p.state.teams = Array.from({ length: mode === 'partnerMix' ? 9 : 5 }, (_, i) => `P${i}`);
        const rounds = mode === 'partnerMix' ? p.generatePartnerMix(p.state.teams, 4) : p.generateRoundRobin(p.state.teams);
        p.state.matches = p.scheduleMatches(rounds);
        // Keep a later complete rotation to verify that removal is minimal.
        const first = [...p.state.matches];
        const offset = Math.max(...first.map(m => m.slot)) + 1;
        p.state.matches.push(...first.map(m => ({ ...m, id: `${m.id}-later`, round: m.round + rounds.length, slot: m.slot + offset })));
        const before = [...p.state.matches];
        assert.equal(await p.removeTournamentRound(selected, async message => {
          assert.match(message, /Vollständige Rotation/);
          return true;
        }), true);
        const removed = before.filter(match => !p.state.matches.includes(match));
        assert.ok(removed.some(match => match.round === selected));
        const counts = new Map(p.state.teams.map(name => [name, 0]));
        removed.forEach(match => {
          const names = mode === 'partnerMix' ? [...match.playersA, ...match.playersB] : [match.teamA, match.teamB];
          names.forEach(name => counts.set(name, counts.get(name) + 1));
        });
        assert.ok([...counts.values()].every(count => count > 0 && count === counts.get(p.state.teams[0])));
        assert.ok(p.state.matches.length >= first.length);
      }
    }
  }
});

test('incomplete rotations cannot be removed, even after confirmation', async () => {
  const p = planner();
  p.state.teams = ['A', 'B', 'C'];
  p.state.matches = p.scheduleMatches(p.generateRoundRobin(p.state.teams).slice(0, 2));
  const before = JSON.stringify(p.state);
  await assert.rejects(p.removeTournamentRound(1, async () => assert.fail('No destructive confirmation')), /keiner vollständigen Rotation/);
  assert.equal(JSON.stringify(p.state), before);
});

test('rotation warning includes results in adjacent rounds and cancelling preserves them', async () => {
  const p = planner();
  p.state.teams = ['A', 'B', 'C'];
  p.state.matches = p.scheduleMatches(p.generateRoundRobin(p.state.teams));
  p.state.matches.at(-1).scoreA = 0;
  const before = JSON.stringify(p.state);
  assert.equal(await p.removeTournamentRound(1, async message => {
    assert.match(message, /Runden 1, 2, 3/);
    assert.match(message, /verliert 2 Spiele/);
    assert.match(message, /bereits Ergebnisse/);
    return false;
  }), false);
  assert.equal(JSON.stringify(p.state), before);
});

test('12 mixed players fill both courts when two rotations are appended', async () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const p = planner();
    p.state.mode = 'partnerMix'; p.state.courts = 2;
    p.state.teams = Array.from({ length: 12 }, (_, i) => `Player ${i + 1}`);
    p.state.matches = p.scheduleMatches(p.generatePartnerMix(p.state.teams, 2));
    const original = JSON.stringify(p.state.matches);
    const first = p.appendTournamentRound();
    const lastSlot = Math.max(...first.map(m => m.slot));
    assert.equal(first.filter(m => m.slot === lastSlot).length, 1);
    const second = p.appendTournamentRound();
    assert.equal(second.filter(m => m.slot === lastSlot).length, 1);
    assert.equal(JSON.stringify(p.state.matches.slice(0, 6)), original);
    const slots = new Map();
    const counts = new Map(p.state.teams.map(name => [name, 0]));
    for (const match of p.state.matches) {
      const group = slots.get(match.slot) || [];
      group.push(match); slots.set(match.slot, group);
      [...match.playersA, ...match.playersB].forEach(name => counts.set(name, counts.get(name) + 1));
    }
    assert.equal(slots.size, 6);
    assert.ok([...counts.values()].every(count => count === 4));
    for (const group of slots.values()) {
      assert.equal(group.length, 2);
      assert.equal(new Set(group.map(m => m.court)).size, 2);
      const names = group.flatMap(m => [...m.playersA, ...m.playersB]);
      assert.equal(new Set(names).size, 8);
    }
    const shared = slots.get(lastSlot);
    assert.match(shared[0].roundLabel, /Runden/);
    const active = new Set(shared.flatMap(m => [...m.playersA, ...m.playersB]));
    assert.equal(shared[0].roundNote, `Pause: ${p.state.teams.filter(name => !active.has(name)).join(', ')}`);
    const placements = second.map(m => ({ id: m.id, slot: m.slot, court: m.court }));
    assert.equal(await p.removeTournamentRound(first[0].round, async () => true), true);
    assert.ok(second.every(m => p.state.matches.includes(m)));
    assert.deepEqual(second.map(m => ({ id: m.id, slot: m.slot, court: m.court })), placements);
    assert.equal(second.find(m => m.slot === lastSlot).roundLabel, `Runde ${second[0].round}`);
  }
});

test('appending does not fill a time block that already contains a partial result', () => {
  const p = planner();
  p.state.mode = 'partnerMix'; p.state.courts = 2;
  p.state.teams = Array.from({ length: 12 }, (_, i) => `P${i}`);
  p.state.matches = p.scheduleMatches(p.generatePartnerMix(p.state.teams, 1));
  const lastSlot = Math.max(...p.state.matches.map(m => m.slot));
  p.state.matches.at(-1).scoreA = 0;
  const before = JSON.stringify(p.state.matches);
  const length = p.state.matches.length;
  const added = p.appendTournamentRound();
  assert.ok(added.every(m => m.slot > lastSlot));
  assert.equal(JSON.stringify(p.state.matches.slice(0, length)), before);
});

test('impossible additional rounds leave the tournament unchanged', () => {
  const p = planner();
  assert.throws(() => p.appendTournamentRound(), /zuerst/);
  for (const mode of ['limited', 'partnerMix']) {
    p.state.mode = mode;
    p.state.teams = mode === 'limited' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D', 'E', 'F'];
    p.state.matches = [{ id: 'keep', scoreA: 6, scoreB: 1, slot: 0, round: 1 }];
    const before = JSON.stringify(p.state);
    assert.throws(() => p.appendTournamentRound(), /Genau ein weiteres Spiel/);
    assert.equal(JSON.stringify(p.state), before);
  }
});

test('deleting a saved tournament removes its local data and preserves a usable empty planner', () => {
  const p = planner({ name: 'Altes Turnier', participants: ['A', 'B'], matches: [{ scoreA: 6, scoreB: 4 }] });
  const oldId = p.activeTournamentId;
  assert.equal(p.removeLocalTournament(oldId), true);
  assert.equal(p.storage.has(`courtpilot-tournament-${oldId}`), false);
  assert.equal(p.storage.has('courtpilot-tournament-v1'), false);
  assert.equal(p.library.items.length, 1);
  assert.notEqual(p.library.items[0].id, oldId);
  assert.deepEqual(JSON.parse(p.storage.get(`courtpilot-tournament-${p.library.items[0].id}`)).matches, []);
});

test('round timer formats the duration and compensates for delayed updates', () => {
  const p = planner();
  assert.equal(p.formatCountdown(0), '00:00');
  assert.equal(p.formatCountdown(65), '01:05');
  assert.equal(p.formatCountdown(1200), '20:00');
  assert.equal(p.countdownRemaining(11_250, 10_000), 2);
  assert.equal(p.countdownRemaining(9_999, 10_000), 0);
});

test('singles: target appearances, unique opponents, byes and no simultaneous double bookings', () => {
  const p = planner();
  for (let n = 2; n <= 31; n++) {
    const players = Array.from({ length: n }, (_, i) => `Spieler ${i + 1}`);
    for (let requested = 1; requested <= 20; requested++) {
      const target = Math.min(requested, n - 1);
      const rounds = p.generateSingles(players, requested);
      const counts = new Map(players.map(name => [name, 0]));
      const pairs = new Set();
      for (const round of rounds) {
        const active = new Set();
        for (const m of round.matches) {
          assert.notEqual(m.teamA, m.teamB);
          for (const name of [m.teamA, m.teamB]) {
            assert.ok(counts.has(name));
            assert.ok(!active.has(name)); active.add(name);
            counts.set(name, counts.get(name) + 1);
          }
          const key = [m.teamA, m.teamB].sort().join('|');
          assert.ok(!pairs.has(key)); pairs.add(key);
        }
        const resting = players.filter(name => !active.has(name));
        assert.equal(round.note, resting.length ? `Pause: ${resting.join(', ')}` : '');
      }
      const appearances = [...counts.values()];
      assert.equal(appearances.filter(count => count === target - 1).length, n * target % 2);
      assert.ok(appearances.every(count => count === target || count === target - 1));
      assert.equal(pairs.size, Math.floor(n * target / 2));
      for (const courts of [1, 3, 12]) {
        p.state.courts = courts;
        const occupied = new Map();
        for (const m of p.scheduleMatches(rounds)) {
          const names = occupied.get(m.slot) || new Set();
          assert.ok(!names.has(m.teamA) && !names.has(m.teamB));
          names.add(m.teamA); names.add(m.teamB); occupied.set(m.slot, names);
          assert.ok(m.court >= 1 && m.court <= courts);
        }
      }
    }
  }
});

test('legacy tournaments remain doubles with scores intact', () => {
  const match = { teamA: 'A', teamB: 'B', scoreA: 6, scoreB: 2 };
  const p = planner({ mode: 'limited', participants: ['A', 'B', 'C'], teams: ['A', 'B', 'C'], matches: [match] });
  assert.equal(p.state.format, 'doubles');
  assert.equal(p.state.matches[0].scoreA, 6);
  assert.equal(p.state.teams.length, 3);
});

test('separate participant drafts survive format changes', () => {
  const p = planner();
  p.state.participants = ['Alte Teams']; p.rememberParticipants();
  p.state.format = 'singles'; p.state.entryType = 'players'; p.restoreParticipants();
  p.state.participants = ['Anna', 'Ben']; p.state.strengths = [1, 3]; p.rememberParticipants();
  p.state.format = 'doubles'; p.state.entryType = 'teams'; p.restoreParticipants();
  assert.equal(p.state.participants.join(','), 'Alte Teams');
  p.state.format = 'singles'; p.state.entryType = 'players'; p.restoreParticipants();
  assert.equal(p.state.participants.join(','), 'Anna,Ben');
  assert.equal(p.state.strengths.join(','), '1,3');
});

test('singles results use the existing ranking', () => {
  const p = planner();
  const match = { teamA: 'Anna', teamB: 'Ben', scoreA: 6, scoreB: 2, slot: 0, court: 1, roundLabel: 'Runde 1' };
  const rows = p.calculateStandings(['Anna', 'Ben'], [match]);
  assert.equal(rows[0].name, 'Anna'); assert.equal(rows[0].wins, 1); assert.equal(rows[0].diff, 4);
  assert.equal(rows[1].losses, 1);
});

test('fixed doubles and partner rotation retain their planning behavior', () => {
  const p = planner();
  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rounds = p.limitRounds(p.generateRoundRobin(teams), 3, teams.length);
  assert.equal(rounds.length, 3); assert.ok(rounds.every(round => round.matches.length === 3));
  for (let playerCount = 4; playerCount <= 20; playerCount++) {
    const players = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    for (let games = 1; games <= 12; games++) {
      const shouldWork = playerCount * games % 4 === 0;
      assert.equal(p.partnerMixValidation(playerCount, games) === '', shouldWork);
      if (!shouldWork) {
        assert.throws(() => p.generatePartnerMix(players, games), /durch 4 teilbar/);
        continue;
      }
      p.state.strengths = players.map(() => 2);
      const mixed = p.generatePartnerMix(players, games);
      const counts = Object.fromEntries(players.map(name => [name, 0]));
      for (const round of mixed) {
        const active = round.matches.flatMap(m => [...m.playersA, ...m.playersB]);
        assert.equal(new Set(active).size, active.length);
        active.forEach(name => counts[name]++);
      }
      assert.ok(Object.values(counts).every(count => count === games));
      assert.equal(mixed.flatMap(round => round.matches).length, playerCount * games / 4);
      const capacity = Math.min(p.state.courts, Math.floor(playerCount / 4));
      const minimumRounds = Math.max(games, Math.ceil(playerCount * games / 4 / capacity));
      assert.equal(mixed.length, minimumRounds);
      assert.ok(mixed.every((round, index) => round.matches.length === Math.min(capacity, playerCount * games / 4 - index * capacity)));
    }
  }
  const ninePlayers = Array.from({ length: 9 }, (_, i) => `N${i}`);
  p.state.courts = 3; p.state.strengths = ninePlayers.map(() => 2);
  assert.deepEqual(Array.from(p.generatePartnerMix(ninePlayers, 4), round => round.matches.length), [2, 2, 2, 2, 1]);
});
