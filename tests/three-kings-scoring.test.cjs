const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { structuredClone };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'three-kings-scoring.js'), 'utf8'), sandbox);
const scoring = sandbox.threeKingsScoring;
const sports = ['tennis', 'badminton', 'tableTennis'];
const game = (discipline, playersA, playersB, scoreA = '', scoreB = '') => ({ discipline, playersA, playersB, scoreA, scoreB });
const setMatch = () => ({ ...game('tennis', ['A','B'], ['C','D']), scoringMode: 'sets7', sets: [], currentSetA: 0, currentSetB: 0, finished: false });

test('completed sets are recorded manually without a two-point margin and can be undone', () => {
  const match = setMatch();
  const before = JSON.stringify(match);
  const won = scoring.recordSet(match, 7, 6);
  assert.equal(JSON.stringify(match), before);
  assert.equal(won.sets.length, 1); assert.equal(won.sets[0].a, 7); assert.equal(won.sets[0].b, 6);
  assert.equal(won.currentSetA, 0); assert.equal(won.currentSetB, 0);
  assert.equal(scoring.resultComplete(won), false);
  const undone = scoring.undoSetAction(won);
  assert.equal(undone.sets.length, 0); assert.equal(undone.currentSetA, 0); assert.equal(undone.currentSetB, 0);
});

test('last set needs at least four total points and a leader at time limit', () => {
  for (const [a,b,sa,sb] of [[2,1,0,0],[3,1,1,0],[1,3,0,1],[4,0,1,0],[0,4,0,1],[2,2,0,0],[6,6,0,0],[0,0,0,0]]) {
    const match = { ...setMatch(), currentSetA: a, currentSetB: b };
    const finished = scoring.finishMatch(match);
    assert.equal(finished.scoreA, sa); assert.equal(finished.scoreB, sb);
    assert.equal(finished.finished, true); assert.equal(scoring.resultComplete(finished), true);
    assert.equal(scoring.finishMatch(finished), finished);
    const reopened = scoring.undoSetAction(JSON.parse(JSON.stringify(finished)));
    assert.equal(reopened.finished, false); assert.equal(reopened.currentSetA, a); assert.equal(reopened.currentSetB, b);
    assert.equal(reopened.scoreA, ''); assert.equal(reopened.sets.length, 0);
  }
});

test('set wins determine table points, independent of ball-point margins', () => {
  let match = scoring.recordSet(setMatch(), 7, 0);
  match = scoring.recordSet(match, 6, 7);
  match.currentSetA = 1; match.currentSetB = 3;
  match = scoring.finishMatch(match);
  assert.equal(match.scoreA, 1); assert.equal(match.scoreB, 2);
  const rows = scoring.calculate({ teams: ['A','B','C','D'], matches: [match] });
  assert.equal(rows.find(r => r.name === 'A').sports.tennis.points, 0);
  assert.equal(rows.find(r => r.name === 'C').sports.tennis.points, 2);
  const tied = scoring.finishMatch(scoring.recordSet(scoring.recordSet(setMatch(), 7, 0), 0, 7));
  assert.ok(scoring.calculate({ teams: ['A','B','C','D'], matches: [tied] }).every(r => r.sports.tennis.draws === 1));
  assert.throws(() => scoring.recordSet(match, 7, 0), /abgeschlossen/);
  assert.throws(() => scoring.recordSet(setMatch(), 7, 7), /vollständiger Satz/);
  assert.throws(() => scoring.recordSet(setMatch(), 6, 5), /vollständiger Satz/);
  assert.equal(scoring.recordSet({ ...setMatch(), currentSetA: 1 }, 7, 0).currentSetA, 1);
});

test('last set is entered at match completion and undo restores its input', () => {
  const match = scoring.recordSet(setMatch(), 7, 4);
  const finished = scoring.finishMatch(match, 1, 3);
  assert.equal(finished.scoreA, 1); assert.equal(finished.scoreB, 1);
  const reopened = scoring.undoSetAction(JSON.parse(JSON.stringify(finished)));
  assert.equal(reopened.currentSetA, 1); assert.equal(reopened.currentSetB, 3);
  assert.equal(reopened.finished, false); assert.equal(reopened.sets.length, 1);
  assert.throws(() => scoring.finishMatch(match, 7, 3), /zwischen 0 und 6/);
  assert.throws(() => scoring.finishMatch(match, 1.5, 2), /zwischen 0 und 6/);
});

test('approved example weights 2/3/1 games equally and gives both partners draw points', () => {
  const teams = ['Anna', 'Ben', 'Clara', 'David', 'Eva', 'Felix', 'Greta', 'Hannes'];
  const records = [
    ['tennis',[0,1],[2,3],12,9], ['tennis',[4,5],[6,7],8,11], ['tennis',[0,2],[4,6],10,10], ['tennis',[1,3],[5,7],11,8],
    ['badminton',[0,4],[1,5],21,17], ['badminton',[2,6],[3,7],18,21], ['badminton',[0,5],[2,7],15,21], ['badminton',[1,6],[3,4],20,20], ['badminton',[0,7],[3,6],21,14], ['badminton',[1,2],[4,5],19,21],
    ['tableTennis',[0,3],[1,2],14,11], ['tableTennis',[4,7],[5,6],10,14]
  ];
  const matches = records.map(([s, a, b, sa, sb]) => game(s, a.map(i => teams[i]), b.map(i => teams[i]), sa, sb));
  const before = JSON.stringify(matches);
  const rows = scoring.calculate({ teams, matches });
  const anna = rows.find(r => r.name === 'Anna');
  assert.equal(anna.sports.tennis.points, 3); assert.equal(anna.sports.tennis.percent, 75);
  assert.equal(anna.sports.badminton.maximum, 6); assert.equal(anna.sports.tableTennis.maximum, 2);
  assert.ok(Math.abs(anna.total - 80.55555555555556) < 1e-9);
  assert.equal(anna.complete, true);
  assert.equal(JSON.stringify(matches), before);
  assert.match(scoring.render({ teams, matches }, 'Anna'), /80,6 %/);
});

test('zero draws count, incomplete and invalid results do not inflate percentages', () => {
  const teams = ['A', 'B', 'C', 'D'];
  const matches = sports.map(s => game(s, ['A','B'], ['C','D'], 0, '0'));
  matches.push(game('tennis', ['A','B'], ['C','D'], 9, ''));
  const row = scoring.calculate({ teams, matches }).find(r => r.name === 'A');
  assert.equal(row.sports.tennis.played, 1); assert.equal(row.sports.tennis.planned, 2);
  assert.equal(row.sports.tennis.draws, 1); assert.equal(row.sports.tennis.percent, 25);
  assert.equal(row.complete, false);
  for (const bad of [null, undefined, '', ' ', -1, 100, 1.5, NaN]) {
    const invalid = scoring.calculate({ teams, matches: [game('tennis', ['A'], ['B'], bad, 0)] });
    assert.ok(invalid.every(r => r.sports.tennis.played === 0));
  }
});

test('tied totals share ranks regardless of ball points and names', () => {
  const teams = ['Zoe', 'Anna', 'C', 'D'];
  const matches = sports.flatMap(s => [game(s, ['Zoe'], ['C'], 99, 0), game(s, ['Anna'], ['D'], 1, 0)]);
  const rows = scoring.calculate({ teams, matches });
  assert.equal(rows[0].name, 'Anna'); assert.equal(rows[0].rank, 1); assert.equal(rows[1].rank, 1);
  assert.equal(rows[2].rank, 3); assert.equal(rows[3].rank, 3);
});

test('ranking compares full precision before rounding display values', () => {
  const teams = ['Zoe', 'Anna', 'Opponent'];
  const matches = [];
  for (const [name, count] of [['Zoe', 334], ['Anna', 335]]) {
    for (let i = 0; i < count; i++) matches.push(game('tennis', [name], ['Opponent'], i === 0 ? 1 : 0, i === 0 ? 0 : 1));
    for (const s of sports.slice(1)) matches.push(game(s, [name], ['Opponent'], 0, 1));
  }
  const rows = scoring.calculate({ teams, matches });
  const zoe = rows.find(r => r.name === 'Zoe'), anna = rows.find(r => r.name === 'Anna');
  assert.ok(zoe.total > anna.total); assert.ok(zoe.rank < anna.rank);
  assert.equal(zoe.total.toFixed(1), anna.total.toFixed(1));
});

test('triples count as two separate singles and missing disciplines have no overall rank', () => {
  const teams = ['A', 'B', 'C'];
  const matches = [game('tableTennis', ['A'], ['B'], 11, 5), game('tableTennis', ['A'], ['C'], 11, 8), game('tableTennis', ['B'], ['C'], 3, 11)];
  const rows = scoring.calculate({ teams, matches });
  assert.ok(rows.every(r => r.sports.tableTennis.planned === 2 && r.sports.tableTennis.played === 2));
  assert.equal(rows.find(r => r.name === 'A').sports.tableTennis.points, 4);
  assert.ok(rows.every(r => r.rank === null && r.total === null));
  assert.match(scoring.render({ teams, matches }), /allen drei Disziplinen/);
});

test('ranking details escape names including button attributes', () => {
  const name = '\"><img src=x onerror=alert(1)>';
  const output = scoring.render({ teams: [name], matches: sports.map(s => game(s, [name], ['X'], 1, 0)) }, name);
  assert.ok(!output.includes('<img')); assert.ok(output.includes('&lt;img'));
  assert.ok(output.includes('&quot;&gt;'));
});
