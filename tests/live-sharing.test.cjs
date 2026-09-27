const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sharing() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'live-sharing.js'), 'utf8');
  const startup = source.lastIndexOf('\nstart().catch');
  assert.ok(startup > 0);
  const sandbox = {
    window: { FIREBASE_CONFIG: null },
    document: { querySelector: () => null },
    location: { href: 'https://example.org/tennis-turnierplaner/' },
    URL, URLSearchParams
  };
  vm.runInNewContext(source.slice(0, startup) +
    '\nglobalThis.sharing = { calculateRows, escapeHtml, liveUrl };', sandbox);
  return sandbox.sharing;
}

test('live link keeps its tournament ID and contains no results', () => {
  const { liveUrl } = sharing();
  const url = new URL(liveUrl('123e4567-e89b-42d3-a456-426614174000'));
  assert.equal(url.pathname, '/tennis-turnierplaner/live.html');
  assert.equal(url.searchParams.get('id'), '123e4567-e89b-42d3-a456-426614174000');
  assert.equal([...url.searchParams.keys()].length, 1);
});

test('viewer ranking matches singles and partner-change scores', () => {
  const { calculateRows } = sharing();
  const singles = calculateRows({
    mode: 'limited', teams: ['Anna', 'Ben'],
    matches: [{ teamA: 'Anna', teamB: 'Ben', scoreA: 6, scoreB: 3 }]
  });
  assert.equal(singles[0].name, 'Anna');
  assert.equal(singles[0].wins, 1);
  assert.equal(singles[0].for - singles[0].against, 3);

  const doubles = calculateRows({
    mode: 'partnerMix', teams: ['Anna', 'Ben', 'Cem', 'Dana'],
    matches: [{ playersA: ['Anna', 'Ben'], playersB: ['Cem', 'Dana'], scoreA: 7, scoreB: 5 }]
  });
  assert.equal(doubles.filter(row => row.wins === 1).length, 2);
  assert.equal(doubles.filter(row => row.losses === 1).length, 2);
  assert.equal(doubles.reduce((total, row) => total + row.played, 0), 4);
});

test('viewer escapes player names before inserting markup', () => {
  const { escapeHtml } = sharing();
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

