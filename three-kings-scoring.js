(() => {
  const sports = [{ id: 'tennis', name: 'Tennis' }, { id: 'badminton', name: 'Badminton' }, { id: 'tableTennis', name: 'Tischtennis' }];
  const escape = value => String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  const percent = n => n === null ? '–' : `${n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  const valid = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 99;
  const setFields = ['sets', 'currentSetA', 'currentSetB', 'finished', 'scoreA', 'scoreB', 'timeLimitNote'];
  function setSummary(match) {
    let a = 0, b = 0;
    for (const set of match.sets || []) {
      if (set.a > set.b) a++; else if (set.b > set.a) b++;
    }
    return { a, b };
  }
  function changeSetMatch(match, change) {
    if (match.scoringMode !== 'sets7') throw new Error('Diese Begegnung verwendet keine Satzwertung.');
    const previousSetState = Object.fromEntries(setFields.map(key => [key, structuredClone(match[key])]));
    const next = { ...match, sets: structuredClone(match.sets || []), previousSetState };
    change(next);
    return next;
  }
  function recordSet(match, a, b) {
    if (match.finished) throw new Error('Die Begegnung ist bereits abgeschlossen.');
    if (![a, b].every(n => Number.isInteger(n) && n >= 0 && n <= 7) || Math.max(a, b) !== 7 || a === b) throw new Error('Ein vollständiger Satz endet bei 7 Punkten; die andere Seite hat höchstens 6.');
    return changeSetMatch(match, next => { next.sets.push({ a, b }); });
  }
  function finishMatch(match, a = match.currentSetA ?? 0, b = match.currentSetB ?? 0) {
    if (match.finished) return match;
    if (![a, b].every(n => Number.isInteger(n) && n >= 0 && n <= 6)) throw new Error('Der letzte unvollständige Satz benötigt zwei Punktstände zwischen 0 und 6. Sätze mit 7 Punkten bitte als abgeschlossenen Satz nachtragen.');
    return changeSetMatch(match, next => {
      next.previousSetState.currentSetA = a; next.previousSetState.currentSetB = b;
      if (a + b >= 4 && a !== b) {
        next.sets.push({ a, b, atTimeLimit: true }); next.timeLimitNote = `Letzter Satz ${a}:${b} zählt: mindestens 4 Punkte gespielt und eine Seite führt.`;
      } else next.timeLimitNote = a + b === 0 ? 'Beim Zeitende war kein weiterer Satz begonnen.' : `Letzter Satz ${a}:${b} zählt nicht: ${a === b ? 'Gleichstand' : 'weniger als 4 Punkte gespielt'}.`;
      next.currentSetA = 0; next.currentSetB = 0; next.finished = true;
      const result = setSummary(next); next.scoreA = result.a; next.scoreB = result.b;
    });
  }
  function undoSetAction(match) {
    if (!match.previousSetState) return match;
    return { ...match, ...structuredClone(match.previousSetState), previousSetState: null };
  }
  function resultComplete(match) {
    return match.scoringMode === 'sets7' ? match.finished === true : valid(match.scoreA) && valid(match.scoreB);
  }
  function result(match) {
    return match.scoringMode === 'sets7' ? setSummary(match) : { a: Number(match.scoreA), b: Number(match.scoreB) };
  }

  function calculate(data) {
    const rows = (data.teams || []).map(name => ({ name, sports: Object.fromEntries(sports.map(s => [s.id, { planned: 0, played: 0, points: 0, wins: 0, draws: 0, losses: 0 }])) }));
    const byName = new Map(rows.map(row => [row.name, row]));
    for (const match of data.matches || []) {
      if (match.placeholder || !sports.some(s => s.id === match.discipline)) continue;
      const { a, b } = result(match);
      const complete = resultComplete(match);
      const sides = [[match.playersA || [match.teamA], a, b], [match.playersB || [match.teamB], b, a]];
      for (const [names, own, other] of sides) for (const name of new Set(names)) {
        const record = byName.get(name)?.sports[match.discipline];
        if (!record) continue;
        record.planned++;
        if (!complete) continue;
        record.played++;
        if (own > other) { record.wins++; record.points += 2; }
        else if (own === other) { record.draws++; record.points++; }
        else record.losses++;
      }
    }
    rows.forEach(row => {
      for (const s of sports) {
        const record = row.sports[s.id];
        record.maximum = 2 * record.planned;
        record.percent = record.maximum ? 100 * record.points / record.maximum : null;
      }
      row.rankable = sports.every(s => row.sports[s.id].planned > 0);
      row.complete = row.rankable && sports.every(s => row.sports[s.id].played === row.sports[s.id].planned);
      row.total = row.rankable ? sports.reduce((sum, s) => sum + row.sports[s.id].percent, 0) / 3 : null;
    });
    // Compare full precision; alphabetical ordering only stabilizes names sharing a rank.
    rows.sort((a, b) => Number(b.rankable) - Number(a.rankable) || (Math.abs((b.total || 0) - (a.total || 0)) > 1e-9 ? b.total - a.total : a.name.localeCompare(b.name, 'de')));
    let rank = 0, previous = null;
    rows.forEach((row, index) => {
      if (!row.rankable) { row.rank = null; return; }
      if (previous === null || Math.abs(row.total - previous) > 1e-9) rank = index + 1;
      row.rank = rank; previous = row.total;
    });
    return rows;
  }

  function render(data, selectedName) {
    const rows = calculate(data);
    const selected = rows.find(row => row.name === selectedName) || rows[0];
    if (!selected) return '';
    const finished = rows.every(row => row.complete);
    return `<div class="scoring-rules"><strong>Gesamtwertung · jede Disziplin zählt ⅓</strong><span>Sieg 2 · Unentschieden 1 · Niederlage 0 Tabellenpunkte</span></div>
      <p class="helper">${finished ? 'Alle Begegnungen abgeschlossen.' : 'Zwischenstand · offene Spiele bringen noch keine Tabellenpunkte. Berechnet wird mit allen geplanten Spielen.'} Bei gleicher Gesamtwertung wird der Rang geteilt. Ballwechselpunkte entscheiden nicht über die Platzierung.</p>
      <div class="table-wrap"><table class="scoring-table"><thead><tr><th>Rang</th><th>Person</th>${sports.map(s => `<th>${s.name}</th>`).join('')}<th>Gesamt</th></tr></thead><tbody>
      ${rows.map(row => `<tr${row.name === selected.name ? ' class="is-selected"' : ''}><td class="rank">${row.rank ?? '–'}</td><td><button type="button" class="ranking-person" data-ranking-person="${escape(row.name)}" aria-pressed="${row.name === selected.name}">${escape(row.name)}</button></td>${sports.map(s => { const r = row.sports[s.id]; return `<td>${percent(r.percent)}<small>${r.points} / ${r.maximum} Tabellenpunkte · ${r.played}/${r.planned} Sp.</small></td>`; }).join('')}<td><strong>${percent(row.total)}</strong></td></tr>`).join('')}</tbody></table></div>
      <section class="ranking-detail" aria-live="polite"><h3>So entsteht die Gesamtwertung von ${escape(selected.name)}</h3><div class="scoring-grid">${sports.map(s => { const r = selected.sports[s.id]; return `<div><div class="scoring-heading"><strong>${s.name}</strong><span>${percent(r.percent)}</span></div><div class="scoring-track" role="meter" aria-label="${s.name}: Anteil erreichter Tabellenpunkte" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r.percent ?? 0}"><span style="width:${r.percent ?? 0}%"></span></div><p class="helper">${r.wins} Siege · ${r.draws} Unentschieden · ${r.losses} Niederlagen<br>${r.played} von ${r.planned} Spielen abgeschlossen</p><p>Beitrag: ${r.percent === null ? '–' : (r.percent / 3).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Prozentpunkte</p></div>`; }).join('')}</div><div class="scoring-total"><span>Drei gleich gewichtete Disziplinen</span><strong>${percent(selected.total)} gesamt</strong></div>${!selected.rankable ? '<p class="helper">Für eine Gesamtwertung müssen Spiele in allen drei Disziplinen geplant sein.</p>' : ''}</section>`;
  }
  globalThis.threeKingsScoring = { calculate, render, setSummary, recordSet, finishMatch, undoSetAction, resultComplete, result };
})();
