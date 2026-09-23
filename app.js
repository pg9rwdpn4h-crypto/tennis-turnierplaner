(() => {
  const STORAGE_KEY = 'courtpilot-tournament-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = new Date().toISOString().slice(0, 10);

  const defaults = {
    name: 'Saisonabschluss Mixed', date: today, startTime: '17:00', courts: 3,
    duration: 20, breakDuration: 5, mode: 'limited', gamesPerTeam: 3,
    format: 'doubles', entryType: 'teams', pairingMode: 'random', participantDrafts: {},
    participants: ['Team Aufschlag', 'Team Volley', 'Team Grundlinie', 'Team Matchball', 'Team Slice', 'Team Topspin'],
    strengths: [2, 2, 2, 2, 2, 2],
    teams: [], matches: [], generatedAt: null
  };
  let state = loadState();
  let timerRemainingSeconds = state.duration * 60;
  let timerEndAt = null;
  let timerInterval = null;
  let timerFinished = false;
  let audioContext = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const merged = saved ? { ...defaults, ...saved } : structuredClone(defaults);
      merged.participantDrafts = { ...(saved?.participantDrafts || {}) };
      merged.format = merged.format === 'singles' ? 'singles' : 'doubles';
      if (merged.format === 'singles') { merged.entryType = 'players'; merged.mode = 'limited'; }
      if (!['limited', 'partnerMix'].includes(merged.mode)) {
        merged.mode = 'limited'; merged.teams = []; merged.matches = []; merged.generatedAt = null;
      }
      merged.strengths = merged.participants.map((_, index) => clampNumber(merged.strengths?.[index], 1, 3, 2));
      return merged;
    } catch { return structuredClone(defaults); }
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const el = $('#saveState');
    el.lastChild.textContent = ' Lokal gespeichert';
  }
  function readForm() {
    state.name = $('#tournamentName').value.trim();
    state.date = $('#tournamentDate').value;
    state.startTime = $('#startTime').value;
    state.courts = clampNumber($('#courtCount').value, 1, 12, 1);
    state.duration = clampNumber($('#matchDuration').value, 5, 180, 20);
    state.breakDuration = clampNumber($('#breakDuration').value, 0, 60, 5);
    state.gamesPerTeam = clampNumber($('#gamesPerTeam').value, 1, 20, 3);
    state.pairingMode = $('#pairingMode').value;
    state.participants = $$('.participant-row input').map(input => input.value.trim());
    const strengthInputs = $$('.strength-select');
    if (strengthInputs.length) state.strengths = strengthInputs.map(select => clampNumber(select.value, 1, 3, 2));
    saveState(); updateTitle(); updateSetupSummary();
  }
  function clampNumber(value, min, max, fallback) {
    const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
  }
  function updateTitle() { $('#pageTitle').textContent = state.name || 'Neues Turnier'; }

  function hydrateForm() {
    $('#tournamentName').value = state.name; $('#tournamentDate').value = state.date || today;
    $('#startTime').value = state.startTime; $('#courtCount').value = state.courts;
    $('#matchDuration').value = state.duration; $('#breakDuration').value = state.breakDuration;
    $('#gamesPerTeam').value = state.gamesPerTeam; $('#pairingMode').value = state.pairingMode;
    $(`input[name="format"][value="${state.format}"]`).checked = true;
    const radio = $(`input[name="mode"][value="${state.mode}"]`); if (radio) radio.checked = true;
    state.strengths = state.participants.map((_, index) => clampNumber(state.strengths?.[index], 1, 3, 2));
    renderParticipants(); updateModeUI(); updateTitle();
  }

  function rememberParticipants() {
    const key = state.format === 'singles' ? 'singles' : state.entryType;
    state.participantDrafts[key] = { participants: [...state.participants], strengths: [...state.strengths] };
  }

  function restoreParticipants() {
    const key = state.format === 'singles' ? 'singles' : state.entryType;
    const draft = state.participantDrafts[key];
    state.participants = draft ? [...draft.participants] : state.entryType === 'teams'
      ? ['Team 1', 'Team 2', 'Team 3', 'Team 4']
      : Array.from({ length: 8 }, (_, i) => `Spieler ${i + 1}`);
    state.strengths = draft ? [...draft.strengths] : state.participants.map(() => 2);
  }

  function confirmAction(message) {
    const dialog = $('#planChangeDialog');
    $('#confirmMessage').textContent = message;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  async function confirmPlanChange() {
    return !state.matches.length || await confirmAction('Beim Wechsel werden der vorhandene Spielplan und alle Ergebnisse gelöscht. Die Teilnehmerlisten bleiben gespeichert. Fortfahren?');
  }

  function clearPlan() { state.matches = []; state.teams = []; state.generatedAt = null; resetRoundTimer(); }

  async function setFormat(format) {
    if (format === state.format) return;
    if (!await confirmPlanChange()) { hydrateForm(); return; }
    readForm(); rememberParticipants();
    state.format = format; state.mode = 'limited';
    state.entryType = format === 'singles' ? 'players' : 'teams';
    restoreParticipants(); clearPlan(); hydrateForm(); hideNotice(); saveState(); renderOutputs();
  }

  async function setEntryType(type) {
    if (type === state.entryType) return;
    if (!await confirmPlanChange()) return;
    readForm(); rememberParticipants();
    state.entryType = type;
    restoreParticipants(); clearPlan(); hydrateForm(); hideNotice(); saveState(); renderOutputs();
  }

  async function setMode(mode) {
    if (mode === state.mode) return;
    if (!await confirmPlanChange()) { hydrateForm(); return; }
    readForm();
    if (mode === 'partnerMix' && state.entryType !== 'players') {
      rememberParticipants(); state.entryType = 'players'; restoreParticipants();
    }
    state.mode = mode;
    clearPlan(); hydrateForm(); hideNotice(); saveState(); renderOutputs();
  }

  function renderParticipants() {
    const list = $('#participantList'); list.innerHTML = '';
    const showStrength = state.entryType === 'players' && state.mode === 'partnerMix';
    state.participants.forEach((name, index) => {
      const strength = clampNumber(state.strengths?.[index], 1, 3, 2);
      state.strengths[index] = strength;
      const row = document.createElement('div'); row.className = `participant-row${showStrength ? ' has-strength' : ''}`;
      row.innerHTML = `<span class="participant-index">${String(index + 1).padStart(2, '0')}</span>
        <input type="text" maxlength="60" aria-label="${state.entryType === 'teams' ? 'Team' : 'Spieler'} ${index + 1}" value="${escapeAttr(name)}" />
        ${showStrength ? `<select class="strength-select" aria-label="Spielstärke von ${escapeAttr(name || `Spieler ${index + 1}`)}">
          <option value="1"${strength === 1 ? ' selected' : ''}>Stufe 1 · Freizeit</option>
          <option value="2"${strength === 2 ? ' selected' : ''}>Stufe 2 · Fortgeschritten</option>
          <option value="3"${strength === 3 ? ' selected' : ''}>Stufe 3 · Stark</option>
        </select>` : ''}
        <button class="icon-button" type="button" aria-label="Teilnehmer entfernen" title="Entfernen">×</button>`;
      $('input', row).addEventListener('input', readForm);
      const strengthSelect = $('.strength-select', row);
      if (strengthSelect) strengthSelect.addEventListener('change', () => { state.strengths[index] = Number(strengthSelect.value); saveState(); });
      $('.icon-button', row).addEventListener('click', () => {
        state.participants.splice(index, 1); state.strengths.splice(index, 1); renderParticipants(); saveState(); updateSetupSummary();
      });
      list.appendChild(row);
    });
  }

  function updateModeUI() {
    const singles = state.format === 'singles', mix = state.mode === 'partnerMix';
    $('#modeHeading').textContent = singles ? 'Spiele pro Spieler' : 'Doppelmodus';
    $('#modeSelector').classList.toggle('is-hidden', singles);
    $$('input[name="mode"]').forEach(input => { input.disabled = singles; });
    $('#singlesHelper').classList.toggle('is-hidden', !singles);
    $('#entrySelector').classList.toggle('is-hidden', singles || mix);
    $$('.toggle button').forEach(b => {
      b.classList.toggle('is-active', b.dataset.entry === state.entryType);
      b.setAttribute('aria-pressed', String(b.dataset.entry === state.entryType));
    });
    $('#gamesPerTeamWrap').classList.remove('is-hidden');
    $('#gamesPerTeamLabel').textContent = singles || mix ? 'Spiele pro Spieler' : 'Spiele pro Team';
    $('#participantsHeading').textContent = singles || mix ? 'Spieler' : 'Teilnehmer';
    $('#pairingWrap').classList.toggle('is-hidden', singles || state.entryType !== 'players' || mix);
    $('#addParticipant').textContent = state.entryType === 'teams' ? '+ Weiteres Team' : '+ Weitere Person';
    $('#participantHelper').textContent = singles ? 'Trage jeden Spieler einzeln ein. Gespielt wird 1 gegen 1.'
      : state.entryType === 'teams' ? 'Trage bestehende Doppel-Teams ein.'
      : mix ? 'Trage einzelne Spieler ein. Die Doppelpartner werden in jeder Runde möglichst abwechslungsreich neu gemischt.'
      : 'Trage einzelne Spieler ein. Beim Erstellen werden daraus feste Zweier-Teams gebildet.';
    updateSetupSummary();
  }

  function updateSetupSummary() {
    const singles = state.format === 'singles', mix = state.mode === 'partnerMix';
    const count = state.participants.filter(name => name.trim()).length;
    const teams = state.entryType === 'teams' ? count : Math.floor(count / 2);
    const competitors = singles ? count : teams;
    const games = mix ? state.gamesPerTeam : Math.min(state.gamesPerTeam, Math.max(0, competitors - 1));
    const uneven = singles ? count * games % 2 === 1 : !mix && teams % 2 === 1 && games > 0;
    const amount = singles || mix ? `${count} Spieler` : `${teams} Teams${state.entryType === 'players' ? ` aus ${count} Spielern` : ''}`;
    const frequency = `${uneven ? 'bis zu ' : ''}${games} Spiele pro ${singles || mix ? 'Spieler' : 'Team'}`;
    $('#setupSummary').textContent = `${singles ? 'Einzel' : 'Doppel'} · ${amount} · ${state.courts} ${state.courts === 1 ? 'Platz' : 'Plätze'} · ${frequency}`;
    const hints = [];
    if (singles && count < 2) hints.push('Für ein Einzelturnier werden mindestens zwei Spieler benötigt.');
    if (!mix && competitors >= 2 && state.gamesPerTeam > competitors - 1) hints.push(`Ohne Rückspiele sind höchstens ${competitors - 1} Spiele pro ${singles ? 'Spieler' : 'Team'} möglich.`);
    if (singles && uneven) hints.push('Bei dieser Kombination aus Spieler- und Spielanzahl hat ein ausgeloster Spieler ein Spiel weniger.');
    if (!singles && uneven) hints.push('Bei ungerader Teamzahl haben einzelne Teams durch Pausen ein Spiel weniger.');
    if (singles && count % 2 && count >= 3) hints.push('Bei ungerader Spielerzahl werden Pausen eingeplant.');
    if (!singles && !mix && state.entryType === 'players' && count % 2) hints.push('Für feste Doppel-Teams wird eine gerade Spielerzahl benötigt.');
    if (mix && count >= 4) {
      const mixError = partnerMixValidation(count, games);
      if (mixError) hints.push(mixError);
    }
    $('#planningHint').textContent = hints.join(' ');
    $('#planningHint').classList.toggle('is-hidden', !hints.length);
  }

  function buildTeams() {
    const names = state.participants.map(n => n.trim()).filter(Boolean);
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) throw new Error('Jeder Teilnehmername muss eindeutig sein.');
    if (state.entryType === 'teams') return names;
    if (names.length % 2) throw new Error('Für Doppel-Teams wird eine gerade Anzahl einzelner Spieler benötigt.');
    const pool = [...names];
    if (state.pairingMode === 'random') shuffle(pool);
    return Array.from({ length: pool.length / 2 }, (_, i) => `${pool[i * 2]} & ${pool[i * 2 + 1]}`);
  }

  async function createTournament() {
    readForm(); hideNotice();
    if (state.matches.some(m => m.scoreA !== '' || m.scoreB !== '') && !await confirmAction('Spielplan neu erstellen und vorhandene Ergebnisse löschen?')) return;
    try {
      generateTournamentPlan();
    } catch (error) { showNotice(error.message); }
  }

  function generateTournamentPlan() {
    let selected;
    if (state.format === 'singles') {
      const players = state.participants.map(n => n.trim()).filter(Boolean);
      if (players.length < 2) throw new Error('Bitte trage mindestens zwei Spieler ein.');
      if (new Set(players.map(n => n.toLowerCase())).size !== players.length) throw new Error('Jeder Spielername muss eindeutig sein.');
      state.teams = players;
      selected = generateSingles(players, state.gamesPerTeam);
    } else if (state.mode === 'partnerMix') {
      const players = state.participants.map(n => n.trim()).filter(Boolean);
      if (state.entryType !== 'players') throw new Error('Der Partnerwechsel-Modus benötigt einzelne Spieler statt fester Teams.');
      if (players.length < 4) throw new Error('Für wechselnde Doppel werden mindestens vier Spieler benötigt.');
      if (new Set(players.map(n => n.toLowerCase())).size !== players.length) throw new Error('Jeder Spielername muss eindeutig sein.');
      state.teams = players;
      selected = generatePartnerMix(players, state.gamesPerTeam);
    } else {
      const teams = buildTeams();
      if (teams.length < 3) throw new Error('Bitte trage mindestens drei Teams beziehungsweise sechs einzelne Spieler ein.');
      if (new Set(teams.map(n => n.toLowerCase())).size !== teams.length) throw new Error('Jeder Teamname muss eindeutig sein.');
      state.teams = teams;
      const base = generateRoundRobin(teams);
      selected = limitRounds(base, state.gamesPerTeam, teams.length);
    }
    state.matches = scheduleMatches(selected);
    resetRoundTimer();
    state.generatedAt = Date.now(); saveState(); renderOutputs(); showTab('schedule');
    return { teams: state.teams.length, matches: state.matches.length };
  }

  function generateSingles(players, requestedGames) {
    const count = Math.min(requestedGames, players.length - 1);
    const pool = [...players]; shuffle(pool);
    // An odd sum of appearances cannot form pairs: one randomly chosen player plays once less.
    const pending = pool.map((name, i) => ({ name, remaining: count - (i === 0 && players.length * count % 2 ? 1 : 0) }));
    const matches = [];
    // Havel–Hakimi constructs a simple graph with these (almost equal) target degrees.
    while (pending.length) {
      pending.sort((a, b) => b.remaining - a.remaining);
      const current = pending.shift();
      for (let i = 0; i < current.remaining; i++) {
        const opponent = pending[i];
        if (!opponent || opponent.remaining <= 0) throw new Error('Die gewünschte Spielanzahl konnte nicht geplant werden.');
        opponent.remaining--;
        matches.push({ id: crypto.randomUUID(), teamA: current.name, teamB: opponent.name, group: '', phase: '', scoreA: '', scoreB: '' });
      }
    }
    const rounds = [];
    while (matches.length) {
      const active = new Set(), roundMatches = [];
      for (let i = 0; i < matches.length;) {
        const match = matches[i];
        if (active.has(match.teamA) || active.has(match.teamB)) { i++; continue; }
        active.add(match.teamA); active.add(match.teamB);
        roundMatches.push({ ...match, round: rounds.length + 1 }); matches.splice(i, 1);
      }
      const activeSet = new Set(active);
      const byes = players.filter(name => !activeSet.has(name));
      rounds.push({ label: `Runde ${rounds.length + 1}`, note: byes.length ? `Pause: ${byes.join(', ')}` : '', matches: roundMatches });
    }
    return rounds;
  }

  function generateRoundRobin(teams, group = '') {
    const list = teams.map((name, i) => ({ id: `${group}${i}-${slug(name)}`, name, group }));
    if (list.length % 2) list.push(null);
    const rounds = [];
    for (let r = 0; r < list.length - 1; r++) {
      const matches = [];
      for (let i = 0; i < list.length / 2; i++) {
        const a = list[i], b = list[list.length - 1 - i];
        if (a && b) matches.push({ id: crypto.randomUUID(), teamA: a.name, teamB: b.name, group, phase: group ? `Gruppe ${group}` : '', round: r + 1, scoreA: '', scoreB: '' });
      }
      rounds.push({ label: group ? `Gruppe ${group} · Runde ${r + 1}` : `Runde ${r + 1}`, phase: group ? `Gruppe ${group}` : '', matches });
      list.splice(1, 0, list.pop());
    }
    return rounds;
  }

  function limitRounds(rounds, count, teamCount) {
    const max = Math.min(Number(count), teamCount - 1);
    return rounds.slice(0, max).map((round, i) => ({ ...round, label: `Runde ${i + 1}` }));
  }

  function partnerMixValidation(playerCount, gamesPerPlayer) {
    if (playerCount < 4) return 'Für Partnerwechsel werden mindestens vier Spieler benötigt.';
    if ((playerCount * gamesPerPlayer) % 4 !== 0) {
      return `${playerCount} Spieler × ${gamesPerPlayer} Spiele ergeben keine vollständigen Doppel. Wähle eine Spielanzahl, bei der das Ergebnis durch 4 teilbar ist.`;
    }
    return '';
  }

  function generatePartnerMix(players, gamesPerPlayer) {
    const validationError = partnerMixValidation(players.length, Number(gamesPerPlayer));
    if (validationError) throw new Error(validationError);
    const partnerCounts = new Map(), opponentCounts = new Map();
    const strengths = Object.fromEntries(players.map((name, index) => [name, clampNumber(state.strengths[index], 1, 3, 2)]));
    const remaining = Object.fromEntries(players.map(name => [name, Number(gamesPerPlayer)]));
    const matchCapacity = Math.min(state.courts, Math.floor(players.length / 4));
    const totalMatches = players.length * Number(gamesPerPlayer) / 4;
    const roundCount = Math.max(Number(gamesPerPlayer), Math.ceil(totalMatches / matchCapacity));
    const matchesPerRound = Array.from({ length: roundCount }, (_, index) =>
      Math.min(matchCapacity, Math.max(0, totalMatches - index * matchCapacity))
    );
    const rounds = [];
    matchesPerRound.forEach((matchCount, roundIndex) => {
      const active = [...players]
        .map(name => ({ name, remaining: remaining[name], tie: Math.random() }))
        .sort((a, b) => b.remaining - a.remaining || a.tie - b.tie)
        .slice(0, matchCount * 4)
        .map(item => item.name);
      if (active.length !== matchCount * 4 || active.some(name => remaining[name] <= 0)) {
        throw new Error('Die gewünschte Spielanzahl lässt sich mit diesen Spielern und Plätzen nicht vollständig planen.');
      }
      active.forEach(name => remaining[name]--);
      let best = null;
      for (let attempt = 0; attempt < 160; attempt++) {
        const ordered = [...active]; shuffle(ordered);
        const pairings = [];
        let score = 0;
        for (let offset = 0; offset < ordered.length; offset += 4) {
          const group = ordered.slice(offset, offset + 4);
          const options = [
            [[group[0], group[1]], [group[2], group[3]]],
            [[group[0], group[2]], [group[1], group[3]]],
            [[group[0], group[3]], [group[1], group[2]]]
          ];
          const choice = options
            .map(teams => ({ teams, score: mixPairingScore(teams, partnerCounts, opponentCounts, strengths) }))
            .sort((a, b) => a.score - b.score)[0];
          score += choice.score; pairings.push(choice.teams);
        }
        if (!best || score < best.score) best = { score, pairings };
      }
      const roundNumber = roundIndex + 1;
      const matches = best.pairings.map(([playersA, playersB]) => {
        incrementCount(partnerCounts, pairKey(...playersA));
        incrementCount(partnerCounts, pairKey(...playersB));
        playersA.forEach(a => playersB.forEach(b => incrementCount(opponentCounts, pairKey(a, b))));
        return {
          id: crypto.randomUUID(), teamA: playersA.join(' & '), teamB: playersB.join(' & '),
          playersA, playersB, phase: 'Partnerwechsel', round: roundNumber, scoreA: '', scoreB: ''
        };
      });
      const activeSet = new Set(active);
      const byes = players.filter(name => !activeSet.has(name));
      rounds.push({
        label: `Runde ${roundNumber}`, phase: 'Partnerwechsel',
        note: byes.length ? `Pause: ${byes.join(', ')}` : '',
        matches
      });
    });
    return rounds;
  }

  function mixPairingScore([teamA, teamB], partnerCounts, opponentCounts, strengths) {
    const strengthA = teamA.reduce((sum, name) => sum + strengths[name], 0);
    const strengthB = teamB.reduce((sum, name) => sum + strengths[name], 0);
    let score = Math.abs(strengthA - strengthB) * 260;
    score += (partnerCounts.get(pairKey(...teamA)) || 0) * 120;
    score += (partnerCounts.get(pairKey(...teamB)) || 0) * 120;
    teamA.forEach(a => teamB.forEach(b => { score += (opponentCounts.get(pairKey(a, b)) || 0) * 8; }));
    return score + Math.random();
  }

  function pairKey(a, b) { return [a, b].sort((x, y) => x.localeCompare(y, 'de')).join('::'); }
  function incrementCount(map, key) { map.set(key, (map.get(key) || 0) + 1); }

  function generateGroups(teams) {
    if (teams.length < 4) throw new Error('Für Gruppen mit Finalrunde werden mindestens vier Teams benötigt.');
    const groupA = teams.filter((_, i) => i % 2 === 0);
    const groupB = teams.filter((_, i) => i % 2 === 1);
    const groupRounds = [...generateRoundRobin(groupA, 'A'), ...generateRoundRobin(groupB, 'B')];
    return [
      ...groupRounds,
      { label: 'Halbfinale', phase: 'Finalrunde', matches: [
        { id: crypto.randomUUID(), teamA: '1. Gruppe A', teamB: '2. Gruppe B', phase: 'Halbfinale', stage: 'sf1', round: 1, scoreA: '', scoreB: '', placeholder: true },
        { id: crypto.randomUUID(), teamA: '1. Gruppe B', teamB: '2. Gruppe A', phase: 'Halbfinale', stage: 'sf2', round: 1, scoreA: '', scoreB: '', placeholder: true }
      ]},
      { label: 'Finale', phase: 'Finalrunde', matches: [
        { id: crypto.randomUUID(), teamA: 'Sieger HF 1', teamB: 'Sieger HF 2', phase: 'Finale', stage: 'final', round: 1, scoreA: '', scoreB: '', placeholder: true }
      ]}
    ];
  }

  function scheduleMatches(rounds) {
    let slot = 0; const output = [];
    rounds.forEach(round => {
      for (let offset = 0; offset < round.matches.length; offset += state.courts) {
        const chunk = round.matches.slice(offset, offset + state.courts);
        chunk.forEach((match, courtIndex) => output.push({ ...match, roundLabel: round.label, roundNote: round.note || '', slot, court: courtIndex + 1 }));
        slot++;
      }
    });
    return output;
  }

  function renderOutputs() {
    const hasMatches = state.matches.length > 0;
    $('#scheduleEmpty').classList.toggle('is-hidden', hasMatches);
    $('#standingsEmpty').classList.toggle('is-hidden', hasMatches);
    $('#scheduleSummary').classList.toggle('is-hidden', !hasMatches);
    $('#roundTimer').classList.toggle('is-hidden', !hasMatches);
    renderRoundTimer();
    renderSchedule(); renderStandings();
  }

  function formatCountdown(totalSeconds) {
    const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function countdownRemaining(endAt, now = Date.now()) {
    return Math.max(0, Math.ceil((endAt - now) / 1000));
  }

  function renderRoundTimer() {
    const display = $('#timerDisplay');
    if (!display) return;
    const running = timerEndAt !== null;
    display.textContent = formatCountdown(timerRemainingSeconds);
    $('#roundTimer').classList.toggle('is-finished', timerFinished);
    $('#timerStatus').textContent = timerFinished ? 'Zeit abgelaufen' : running ? 'Läuft' : timerRemainingSeconds < state.duration * 60 ? 'Pausiert' : `Bereit · ${state.duration} Min.`;
    $('#timerToggle').textContent = running ? 'Pause' : timerRemainingSeconds < state.duration * 60 && timerRemainingSeconds > 0 ? 'Fortsetzen' : 'Starten';
  }

  function stopTimerInterval() {
    if (timerInterval !== null) clearInterval(timerInterval);
    timerInterval = null;
  }

  function resetRoundTimer() {
    stopTimerInterval();
    timerEndAt = null;
    timerRemainingSeconds = state.duration * 60;
    timerFinished = false;
    renderRoundTimer();
  }

  function updateRoundTimer() {
    if (timerEndAt === null) return;
    timerRemainingSeconds = countdownRemaining(timerEndAt);
    if (timerRemainingSeconds === 0) {
      stopTimerInterval();
      timerEndAt = null;
      timerFinished = true;
      playTimerSound();
    }
    renderRoundTimer();
  }

  async function toggleRoundTimer() {
    if (timerEndAt !== null) {
      timerRemainingSeconds = countdownRemaining(timerEndAt);
      stopTimerInterval(); timerEndAt = null; renderRoundTimer();
      return;
    }
    if (timerRemainingSeconds <= 0) resetRoundTimer();
    timerFinished = false;
    await prepareTimerSound();
    timerEndAt = Date.now() + timerRemainingSeconds * 1000;
    timerInterval = setInterval(updateRoundTimer, 250);
    renderRoundTimer();
  }

  async function prepareTimerSound() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ||= new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();
  }

  function playTimerSound() {
    if (!audioContext || audioContext.state !== 'running') return;
    const start = audioContext.currentTime;
    [0, .28, .56].forEach((offset, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = index === 1 ? 660 : 880;
      gain.gain.setValueAtTime(.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(.14, start + offset + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .2);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(start + offset); oscillator.stop(start + offset + .21);
    });
  }

  function renderSchedule() {
    const list = $('#scheduleList'); list.innerHTML = '';
    if (!state.matches.length) return;
    const completed = state.matches.filter(m => validScore(m.scoreA) && validScore(m.scoreB)).length;
    const endSlot = Math.max(...state.matches.map(m => m.slot)) + 1;
    const endTime = addMinutes(state.startTime, endSlot * (state.duration + state.breakDuration) - state.breakDuration);
    $('#scheduleSummary').innerHTML = [
      [state.format === 'singles' ? 'Einzel · Spieler' : state.mode === 'partnerMix' ? 'Doppel · Spieler' : 'Doppel · Teams', state.teams.length], ['Spiele', `${completed} / ${state.matches.length}`], ['Plätze', state.courts], ['Zeitraum', `${state.startTime}–${endTime} Uhr`]
    ].map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

    const bySlot = Map.groupBy ? Map.groupBy(state.matches, m => m.slot) : state.matches.reduce((map, m) => map.set(m.slot, [...(map.get(m.slot) || []), m]), new Map());
    [...bySlot.entries()].forEach(([slot, matches]) => {
      const block = document.createElement('article'); block.className = 'round-block';
      const time = addMinutes(state.startTime, slot * (state.duration + state.breakDuration));
      const phase = matches[0].roundLabel;
      block.innerHTML = `<header class="round-header"><h3>${escapeHtml(phase)}</h3><span>${time} Uhr · ${state.duration} Min.${matches[0].roundNote ? ` · ${escapeHtml(matches[0].roundNote)}` : ''}</span></header>`;
      matches.forEach(match => {
        const row = document.createElement('div'); row.className = 'match-row';
        row.innerHTML = `<span class="court-badge">Platz ${match.court}</span>
          <span class="team-name right">${escapeHtml(match.teamA)}${match.placeholder ? '<span class="match-label">wird ermittelt</span>' : ''}</span>
          <span class="versus">VS</span><span class="team-name">${escapeHtml(match.teamB)}</span>
          <div class="score-box"><input inputmode="numeric" min="0" max="99" type="number" aria-label="Ergebnis ${escapeAttr(match.teamA)}" value="${escapeAttr(match.scoreA)}"><span>:</span><input inputmode="numeric" min="0" max="99" type="number" aria-label="Ergebnis ${escapeAttr(match.teamB)}" value="${escapeAttr(match.scoreB)}"></div>`;
        const inputs = $$('input', row);
        inputs.forEach((input, idx) => input.addEventListener('input', () => {
          match[idx === 0 ? 'scoreA' : 'scoreB'] = input.value === '' ? '' : clampNumber(input.value, 0, 99, 0);
          const bracketChanged = resolveFinalRound();
          saveState(); renderStandings(); updateSummaryProgress();
          if (bracketChanged) renderSchedule();
        }));
        block.appendChild(row);
      });
      list.appendChild(block);
    });
  }

  function updateSummaryProgress() {
    if (!state.matches.length) return;
    const completed = state.matches.filter(m => validScore(m.scoreA) && validScore(m.scoreB)).length;
    const strong = $$('.summary-item strong')[1]; if (strong) strong.textContent = `${completed} / ${state.matches.length}`;
  }

  function renderStandings() {
    const root = $('#standingsContent'); root.innerHTML = '';
    if (!state.matches.length) return;
    const groups = state.mode === 'groups' ? ['A', 'B'] : [''];
    groups.forEach(group => {
      const names = state.mode === 'groups'
        ? state.teams.filter((_, i) => group === 'A' ? i % 2 === 0 : i % 2 === 1)
        : state.teams;
      const relevant = state.matches.filter(m => !m.placeholder && (state.mode !== 'groups' || m.group === group));
      const rows = state.mode === 'partnerMix' ? calculatePlayerStandings(names, relevant) : calculateStandings(names, relevant);
      const section = document.createElement('section'); section.className = 'standings-group';
      if (group) section.innerHTML = `<h3>Gruppe ${group}</h3>`;
      const wrap = document.createElement('div'); wrap.className = 'table-wrap';
      wrap.innerHTML = `<table><thead><tr><th>Rang</th><th>${state.format === 'singles' || state.mode === 'partnerMix' ? 'Spieler' : 'Team'}</th><th>Sp.</th><th>Siege</th><th>Nied.</th><th>Punkte</th><th>Diff.</th><th>Form</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr><td class="rank">${i + 1}</td><td class="team-cell">${escapeHtml(r.name)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.for}:${r.against}</td><td>${signed(r.diff)}</td><td><span class="form-indicator" aria-label="Letzte Ergebnisse">${r.form.slice(-5).map(x => `<span class="form-dot ${x}" title="${x === 'win' ? 'Sieg' : 'Niederlage'}"></span>`).join('')}</span></td></tr>`).join('')}
        </tbody></table>`;
      section.appendChild(wrap); root.appendChild(section);
    });
  }

  function calculateStandings(names, matches) {
    const table = Object.fromEntries(names.map(name => [name, { name, played: 0, wins: 0, losses: 0, for: 0, against: 0, diff: 0, form: [] }]));
    matches.forEach(m => {
      if (!validScore(m.scoreA) || !validScore(m.scoreB) || m.scoreA === m.scoreB || !table[m.teamA] || !table[m.teamB]) return;
      const a = table[m.teamA], b = table[m.teamB], sa = Number(m.scoreA), sb = Number(m.scoreB);
      a.played++; b.played++; a.for += sa; a.against += sb; b.for += sb; b.against += sa;
      if (sa > sb) { a.wins++; b.losses++; a.form.push('win'); b.form.push('loss'); }
      else { b.wins++; a.losses++; b.form.push('win'); a.form.push('loss'); }
    });
    return Object.values(table).map(r => ({ ...r, diff: r.for - r.against }))
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.for - a.for || a.name.localeCompare(b.name, 'de'));
  }

  function calculatePlayerStandings(names, matches) {
    const table = Object.fromEntries(names.map(name => [name, { name, played: 0, wins: 0, losses: 0, for: 0, against: 0, diff: 0, form: [] }]));
    matches.forEach(m => {
      if (!validScore(m.scoreA) || !validScore(m.scoreB) || Number(m.scoreA) === Number(m.scoreB)) return;
      const scoreA = Number(m.scoreA), scoreB = Number(m.scoreB), aWon = scoreA > scoreB;
      [[m.playersA || [], scoreA, scoreB, aWon], [m.playersB || [], scoreB, scoreA, !aWon]].forEach(([players, own, other, won]) => {
        players.forEach(name => {
          const row = table[name]; if (!row) return;
          row.played++; row.for += own; row.against += other;
          if (won) { row.wins++; row.form.push('win'); } else { row.losses++; row.form.push('loss'); }
        });
      });
    });
    return Object.values(table).map(r => ({ ...r, diff: r.for - r.against }))
      .sort((a, b) => b.wins - a.wins || b.diff - a.diff || b.for - a.for || a.name.localeCompare(b.name, 'de'));
  }

  function resolveFinalRound() {
    if (state.mode !== 'groups') return false;
    let changed = false;
    const groupRows = {};
    for (const group of ['A', 'B']) {
      const groupMatches = state.matches.filter(m => m.group === group);
      const complete = groupMatches.length && groupMatches.every(m => validScore(m.scoreA) && validScore(m.scoreB) && Number(m.scoreA) !== Number(m.scoreB));
      if (!complete) return false;
      const names = state.teams.filter((_, i) => group === 'A' ? i % 2 === 0 : i % 2 === 1);
      groupRows[group] = calculateStandings(names, groupMatches);
    }
    const assignments = {
      sf1: [groupRows.A[0]?.name, groupRows.B[1]?.name],
      sf2: [groupRows.B[0]?.name, groupRows.A[1]?.name]
    };
    for (const stage of ['sf1', 'sf2']) {
      const match = state.matches.find(m => m.stage === stage);
      const [teamA, teamB] = assignments[stage];
      if (match && teamA && teamB && (match.teamA !== teamA || match.teamB !== teamB)) {
        match.teamA = teamA; match.teamB = teamB; match.scoreA = ''; match.scoreB = ''; match.placeholder = false; changed = true;
      }
    }
    const semis = ['sf1', 'sf2'].map(stage => state.matches.find(m => m.stage === stage));
    if (semis.every(m => m && validScore(m.scoreA) && validScore(m.scoreB) && Number(m.scoreA) !== Number(m.scoreB))) {
      const winners = semis.map(m => Number(m.scoreA) > Number(m.scoreB) ? m.teamA : m.teamB);
      const final = state.matches.find(m => m.stage === 'final');
      if (final && (final.teamA !== winners[0] || final.teamB !== winners[1])) {
        final.teamA = winners[0]; final.teamB = winners[1]; final.scoreA = ''; final.scoreB = ''; final.placeholder = false; changed = true;
      }
    }
    return changed;
  }

  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    $$('.tab-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showNotice(message) { $('#formNotice').textContent = message; $('#formNotice').classList.remove('is-hidden'); }
  function hideNotice() { $('#formNotice').classList.add('is-hidden'); }
  function validScore(value) { return value !== '' && Number.isFinite(Number(value)); }
  function addMinutes(time, minutes) {
    const [h, m] = (time || '00:00').split(':').map(Number); const d = new Date(2000, 0, 1, h, m + minutes);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function shuffle(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }
  function slug(value) { return value.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-'); }
  function signed(n) { return n > 0 ? `+${n}` : String(n); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
  function escapeAttr(value) { return escapeHtml(value); }

  async function downloadTournamentPdf() {
    if (!state.matches.length) {
      alert('Erstelle zuerst einen Spielplan. Danach kann die PDF-Datei heruntergeladen werden.');
      return;
    }
    const logo = await loadPdfLogo();
    const pdf = buildSchedulePdf(logo);
    const blob = new Blob([pdfBinaryToBytes(pdf)], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = (state.name || 'Tennisturnier').replace(/[^a-z0-9äöüß-]+/gi, '-').replace(/^-|-$/g, '');
    link.href = url; link.download = `${filename || 'Tennisturnier'}-Spielplan.pdf`;
    link.style.display = 'none'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function buildSchedulePdf(logo = null) {
    const modeName = state.format === 'singles' ? 'Einzel' : state.mode === 'partnerMix' ? 'Doppel | Partnerwechsel' : 'Doppel | Feste Teams';
    const bySlot = state.matches.reduce((map, match) => map.set(match.slot, [...(map.get(match.slot) || []), match]), new Map());
    const slots = [...bySlot.entries()].map(([slot, matches], index) => ({
      number: index + 1,
      label: matches[0].roundLabel,
      note: matches[0].roundNote || '',
      time: addMinutes(state.startTime, slot * (state.duration + state.breakDuration)),
      matches
    }));
    const courts = Array.from({ length: state.courts }, (_, index) => index + 1);
    const courtGroups = chunkArray(courts, 3), rowGroups = chunkArray(slots, 7);
    const pageDefinitions = [];
    rowGroups.forEach((rows, rowGroupIndex) => courtGroups.forEach((pageCourts, courtGroupIndex) => {
      pageDefinitions.push({ rows, pageCourts, rowGroupIndex, courtGroupIndex });
    }));
    const pages = pageDefinitions.map((definition, pageIndex) => buildSchedulePage(
      definition, pageIndex, pageDefinitions.length, courtGroups.length, rowGroups.length, modeName, Boolean(logo)
    ));
    return assemblePdf(pages, 842, 595, logo);
  }

  function loadPdfLogo() {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 64 / image.naturalWidth, 64 / image.naturalHeight);
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let data = '';
        for (let index = 0; index < pixels.length; index += 4) {
          data += String.fromCharCode(pixels[index], pixels[index + 1], pixels[index + 2]);
        }
        resolve({ width, height, data });
      };
      image.onerror = () => resolve(null);
      image.src = 'logo-rsv-finningen.png';
    });
  }

  function pdfBinaryToBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index++) bytes[index] = value.charCodeAt(index) & 255;
    return bytes;
  }

  function formatPdfDate(value) {
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}.${month}.${year}` : value;
  }

  function buildSchedulePage(definition, pageIndex, totalPages, horizontalCount, verticalCount, modeName, hasLogo) {
    const { rows, pageCourts, rowGroupIndex, courtGroupIndex } = definition;
    const commands = ['0.09 0.19 0.37 rg', '0.82 0.86 0.93 RG', '0.7 w'];
    const margin = 32, leftWidth = 112, courtWidth = 220, tableTop = 505, headerHeight = 28, rowHeight = 58;
    const headingX = hasLogo ? 104 : margin;
    if (hasLogo) commands.push('q', '54 0 0 54 32 522 cm', '/Logo Do', 'Q');
    pdfDrawText(commands, state.name || 'Tennisturnier', headingX, 559, 'F2', 17, '0.18 0.37 0.70');
    const meta = `${state.date ? formatPdfDate(state.date) : 'Datum offen'} | ${modeName} | ${state.duration} Min. je Spiel`;
    pdfFillRect(commands, headingX, 532, 92, 3, '1 0.875 0.004');
    pdfDrawText(commands, meta, headingX, 519, 'F1', 8.5, '0.23 0.30 0.43');
    if (horizontalCount > 1) {
      const leftArrow = courtGroupIndex > 0 ? '< ' : '';
      const rightArrow = courtGroupIndex < horizontalCount - 1 ? ' >' : '';
      pdfDrawText(commands, `${leftArrow}Plaetze ${pageCourts[0]}-${pageCourts.at(-1)} | Abschnitt ${courtGroupIndex + 1}/${horizontalCount}${rightArrow}`, 590, 519, 'F2', 8, '0.18 0.37 0.70');
    }
    const headerY = tableTop - headerHeight;
    pdfFillRect(commands, margin, headerY, leftWidth, headerHeight, '0.18 0.37 0.70');
    pdfDrawText(commands, 'Runde / Zeit', margin + 9, headerY + 10, 'F2', 9, '1 1 1');
    pageCourts.forEach((court, index) => {
      const x = margin + leftWidth + index * courtWidth;
      pdfFillRect(commands, x, headerY, courtWidth, headerHeight, '1 0.875 0.004');
      pdfDrawText(commands, `PLATZ ${court}`, x + 10, headerY + 10, 'F2', 9, '0.09 0.19 0.37');
    });
    rows.forEach((row, rowIndex) => {
      const y = headerY - (rowIndex + 1) * rowHeight;
      const fill = rowIndex % 2 ? '0.96 0.975 1' : '1 1 1';
      pdfFillStrokeRect(commands, margin, y, leftWidth, rowHeight, fill);
      pdfDrawText(commands, pdfAscii(row.label).slice(0, 18), margin + 8, y + 39, 'F2', 8.3);
      pdfDrawText(commands, `${row.time} Uhr`, margin + 8, y + 25, 'F1', 8);
      if (row.note) pdfDrawText(commands, pdfAscii(row.note).slice(0, 19), margin + 8, y + 11, 'F1', 6.5);
      pageCourts.forEach((court, courtIndex) => {
        const x = margin + leftWidth + courtIndex * courtWidth;
        pdfFillStrokeRect(commands, x, y, courtWidth, rowHeight, fill);
        const match = row.matches.find(item => item.court === court);
        if (match) drawMatchCell(commands, match, x, y, courtWidth, rowHeight);
        else pdfDrawText(commands, '-', x + 10, y + 27, 'F1', 8, '0.45 0.49 0.53');
      });
    });
    const firstRound = rows[0]?.number || 0, lastRound = rows.at(-1)?.number || 0;
    const footer = `RSV Finningen Tennis | Runden ${firstRound}-${lastRound} | Plaetze ${pageCourts[0]}-${pageCourts.at(-1)} | Seite ${pageIndex + 1}/${totalPages}`;
    pdfDrawText(commands, footer, margin, 24, 'F1', 7.5, '0.31 0.38 0.50');
    if (verticalCount > 1) pdfDrawText(commands, `Rundenblock ${rowGroupIndex + 1}/${verticalCount}`, 692, 24, 'F2', 7.5, '0.31 0.38 0.50');
    return commands.join('\n');
  }

  function drawMatchCell(commands, match, x, y) {
    const teamA = wrapPdfLine(pdfAscii(match.teamA), 41).slice(0, 2);
    const teamB = wrapPdfLine(pdfAscii(match.teamB), 41).slice(0, 2);
    if (wrapPdfLine(pdfAscii(match.teamA), 41).length > 2) teamA[1] = `${teamA[1].slice(0, 37)}...`;
    if (wrapPdfLine(pdfAscii(match.teamB), 41).length > 2) teamB[1] = `${teamB[1].slice(0, 37)}...`;
    let cursor = y + 46;
    teamA.forEach((line, index) => { pdfDrawText(commands, `${index ? '   ' : 'A: '}${line}`, x + 8, cursor, index ? 'F1' : 'F2', 7.5); cursor -= 9; });
    teamB.forEach((line, index) => { pdfDrawText(commands, `${index ? '   ' : 'B: '}${line}`, x + 8, cursor, index ? 'F1' : 'F2', 7.5); cursor -= 9; });
    const result = validScore(match.scoreA) && validScore(match.scoreB) ? `${match.scoreA} : ${match.scoreB}` : '____ : ____';
    pdfDrawText(commands, `Ergebnis: ${result}`, x + 8, y + 7, 'F2', 7.2, '0.18 0.37 0.70');
  }

  function pdfDrawText(commands, value, x, y, font, size, color = '0.09 0.19 0.37') {
    commands.push(`${color} rg`, `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(pdfAscii(value))}) Tj ET`);
  }
  function pdfFillRect(commands, x, y, width, height, fill) {
    commands.push(`${fill} rg`, `${x} ${y} ${width} ${height} re f`);
  }
  function pdfFillStrokeRect(commands, x, y, width, height, fill) {
    commands.push(`${fill} rg`, '0.82 0.86 0.93 RG', `${x} ${y} ${width} ${height} re B`);
  }
  function chunkArray(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function assemblePdf(pages, width, height, logo = null) {
    const fontId = 3 + pages.length * 2, boldFontId = fontId + 1;
    const logoId = logo ? boldFontId + 1 : null;
    const objects = new Array((logoId || boldFontId) + 1);
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    const pageIds = pages.map((_, index) => 3 + index * 2);
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    pages.forEach((stream, index) => {
      const pageId = 3 + index * 2, contentId = pageId + 1;
      const imageResource = logo ? ` /XObject << /Logo ${logoId} 0 R >>` : '';
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >>${imageResource} >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
    objects[boldFontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';
    if (logo) objects[logoId] = `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${logo.data.length} >>\nstream\n${logo.data}\nendstream`;
    let pdf = '%PDF-1.4\n%RSV-Finningen\n';
    const offsets = new Array(objects.length).fill(0);
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = pdf.length;
      pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return pdf;
  }

  function pdfAscii(value) {
    return String(value)
      .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '?');
  }
  function wrapPdfLine(value, maxLength) {
    if (!value) return [''];
    const result = []; let rest = value;
    while (rest.length > maxLength) {
      let cut = rest.lastIndexOf(' ', maxLength);
      if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
      result.push(rest.slice(0, cut).trimEnd()); rest = `  ${rest.slice(cut).trimStart()}`;
    }
    result.push(rest); return result;
  }
  function pdfEscape(value) { return value.replace(/([\\()])/g, '\\$1'); }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    try {
      void Promise.resolve(context.registerTool({
        name: 'create_tournament_plan',
        title: 'Turnierplan erstellen',
        description: 'Konfiguriert das Tennisturnier mit Teilnehmern und Modus und erstellt den sichtbaren Spielplan.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            participants: { type: 'array', minItems: 2, items: { type: 'string', minLength: 1, maxLength: 60 } },
            format: { type: 'string', enum: ['singles', 'doubles'], description: 'Einzel oder Doppel; ohne Angabe wird Doppel verwendet.' },
            entryType: { type: 'string', enum: ['teams', 'players'] },
            mode: { type: 'string', enum: ['limited', 'partnerMix'] },
            courts: { type: 'integer', minimum: 1, maximum: 12 },
            gamesPerTeam: { type: 'integer', minimum: 1, maximum: 20, description: 'Im Partnerwechsel: gewünschte Spiele pro Spieler; sonst Spiele pro Team beziehungsweise Spieler.' },
            strengths: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 3 } }
          },
          required: ['name', 'participants', 'entryType', 'mode', 'courts'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (!input || typeof input.name !== 'string' || !Array.isArray(input.participants)) throw new Error('Ungültige Turnierdaten.');
          const format = input.format ?? 'doubles';
          if (!['singles', 'doubles'].includes(format)) throw new Error('Ungültige Turnierart.');
          if (format === 'singles' && (input.entryType !== 'players' || input.mode !== 'limited')) throw new Error('Einzel benötigt einzelne Spieler und eine feste Spielanzahl.');
          if (!['teams', 'players'].includes(input.entryType) || !['limited', 'partnerMix'].includes(input.mode)) throw new Error('Ungültiger Teilnehmer- oder Turniermodus.');
          if (input.mode === 'partnerMix' && input.entryType !== 'players') throw new Error('Partnerwechsel benötigt einzelne Spieler.');
          if (!Number.isInteger(input.courts) || input.courts < 1 || input.courts > 12) throw new Error('Die Platzanzahl muss zwischen 1 und 12 liegen.');
          const clean = input.participants.map(value => typeof value === 'string' ? value.trim() : '').filter(Boolean);
          if (clean.length !== input.participants.length) throw new Error('Alle Teilnehmer benötigen einen Namen.');
          if (new Set(clean.map(name => name.toLowerCase())).size !== clean.length) throw new Error('Jeder Teilnehmername muss eindeutig sein.');
          const minimum = format === 'singles' ? 2 : input.mode === 'partnerMix' ? 4 : input.entryType === 'teams' ? 3 : 6;
          if (clean.length < minimum) throw new Error(`Für diese Turnierart werden mindestens ${minimum} Teilnehmer benötigt.`);
          if (format === 'doubles' && input.mode === 'limited' && input.entryType === 'players' && clean.length % 2) throw new Error('Für feste Doppel-Teams wird eine gerade Spielerzahl benötigt.');
          if (input.strengths && (input.strengths.length !== clean.length || input.strengths.some(value => !Number.isInteger(value) || value < 1 || value > 3))) throw new Error('Die Spielstärken müssen für alle Teilnehmer als Stufe 1 bis 3 angegeben werden.');
          if (!await confirmPlanChange()) return { status: 'cancelled' };
          rememberParticipants();
          clearPlan();
          state.format = format;
          state.name = input.name.trim(); state.participants = clean; state.entryType = input.entryType;
          state.mode = input.mode; state.courts = input.courts;
          state.strengths = input.strengths ? [...input.strengths] : clean.map(() => 2);
          if (input.gamesPerTeam != null) state.gamesPerTeam = clampNumber(input.gamesPerTeam, 1, 20, 3);
          hydrateForm();
          const result = generateTournamentPlan();
          return { status: 'created', ...result, mode: state.mode, format: state.format };
        }
      })).catch(() => {});
    } catch { /* Browser unterstützt WebMCP noch nicht. */ }
  }

  $$('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.go)));
  $$('input[name="format"]').forEach(radio => radio.addEventListener('change', () => setFormat(radio.value)));
  $$('.toggle button').forEach(button => button.addEventListener('click', () => setEntryType(button.dataset.entry)));
  $$('input[name="mode"]').forEach(radio => radio.addEventListener('change', () => setMode(radio.value)));
  $$('#setupPanel input:not([type="radio"]), #setupPanel select').forEach(input => input.addEventListener('change', readForm));
  $('#addParticipant').addEventListener('click', () => { state.participants.push(''); state.strengths.push(2); renderParticipants(); saveState(); updateSetupSummary(); $$('.participant-row input').at(-1).focus(); });
  $('#generateButton').addEventListener('click', createTournament);
  $('#editSetup').addEventListener('click', () => showTab('setup'));
  $('#timerToggle').addEventListener('click', toggleRoundTimer);
  $('#timerReset').addEventListener('click', resetRoundTimer);
  $('#printButton').addEventListener('click', downloadTournamentPdf);
  $('#resetButton').addEventListener('click', () => {
    if (!confirm('Turnier und alle Ergebnisse wirklich zurücksetzen?')) return;
    localStorage.removeItem(STORAGE_KEY); state = structuredClone(defaults); resetRoundTimer(); hydrateForm(); renderOutputs(); showTab('setup');
  });

  hydrateForm(); renderOutputs(); saveState(); registerWebMcp();
})();

