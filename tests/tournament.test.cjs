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
  const sandbox = { structuredClone, crypto: webcrypto, localStorage: { getItem: () => JSON.stringify(saved) } };
  vm.runInNewContext(source.slice(0, startup) + '\n globalThis.planner = { state, generateSingles, generateRoundRobin, limitRounds, generatePartnerMix, partnerMixValidation, scheduleMatches, calculateStandings, calculatePlayerStandings, buildSchedulePdf, rememberParticipants, restoreParticipants }; })();', sandbox);
  return sandbox.planner;
}

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

test('singles results use the existing ranking and identify the format in PDF', () => {
  const p = planner();
  const match = { teamA: 'Anna', teamB: 'Ben', scoreA: 6, scoreB: 2, slot: 0, court: 1, roundLabel: 'Runde 1' };
  const rows = p.calculateStandings(['Anna', 'Ben'], [match]);
  assert.equal(rows[0].name, 'Anna'); assert.equal(rows[0].wins, 1); assert.equal(rows[0].diff, 4);
  assert.equal(rows[1].losses, 1);
  p.state.format = 'singles'; p.state.matches = [match];
  assert.match(p.buildSchedulePdf(), /Einzel/);
  p.state.format = 'doubles'; assert.match(p.buildSchedulePdf(), /Doppel/);
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
