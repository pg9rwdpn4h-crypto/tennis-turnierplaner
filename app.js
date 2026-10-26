(() => {
  const STORAGE_KEY = 'courtpilot-tournament-v1';
  const LIBRARY_KEY = 'courtpilot-tournaments-v2';
  const TOURNAMENT_KEY = id => `courtpilot-tournament-${id}`;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = new Date().toISOString().slice(0, 10);
  const disciplines = [
    { id: 'tennis', name: 'Tennis', unit: 'Platz' },
    { id: 'badminton', name: 'Badminton', unit: 'Feld' },
    { id: 'tableTennis', name: 'Tischtennis', unit: 'Platte' }
  ];
  const disciplineDefaults = { tennis: { courts: 2, games: 2 }, badminton: { courts: 2, games: 3 }, tableTennis: { courts: 2, games: 1 } };

  const defaults = {
    name: 'Saisonabschluss Mixed', date: today, startTime: '17:00', courts: 3,
    duration: 20, breakDuration: 5, mode: 'limited', gamesPerTeam: 3,
    format: 'doubles', entryType: 'teams', pairingMode: 'random', participantDrafts: {}, disciplineSettings: disciplineDefaults,
    participants: ['Team Aufschlag', 'Team Volley', 'Team Grundlinie', 'Team Matchball', 'Team Slice', 'Team Topspin'],
    strengths: [2, 2, 2, 2, 2, 2],
    teams: [], matches: [], generatedAt: null, liveId: null
  };
  const library = loadLibrary();
  let activeTournamentId = library.activeId;
  let state = loadState(activeTournamentId);
  let selectedScoringName = null;
  let timerRemainingSeconds = state.duration * 60;
  let timerEndAt = null;
  let timerInterval = null;
  let timerFinished = false;
  let audioContext = null;

  function loadLibrary() {
    try {
      const saved = JSON.parse(localStorage.getItem(LIBRARY_KEY));
      if (saved?.activeId && Array.isArray(saved.items) && saved.items.some(item => item.id === saved.activeId)) return saved;
    } catch { /* Recover the previous single tournament below. */ }
    const id = crypto.randomUUID();
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous) localStorage.setItem(TOURNAMENT_KEY(id), previous);
    let legacy = defaults;
    try { if (previous) legacy = JSON.parse(previous); } catch { /* Keep a recoverable empty tournament. */ }
    const created = { activeId: id, items: [{ id, name: legacy.name || defaults.name,
      date: legacy.date || today, updatedAt: Date.now(), dirty: !!previous,
      changeSeq: previous ? 1 : 0, remoteVersion: 0, hasSchedule: !!legacy.matches?.length,
      placeholder: !previous }] };
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(created));
    return created;
  }
  function normalizeState(saved) {
    try {
      const merged = saved ? { ...defaults, ...saved } : structuredClone(defaults);
      merged.participantDrafts = { ...(saved?.participantDrafts || {}) };
      merged.format = ['singles', 'threeKings'].includes(merged.format) ? merged.format : 'doubles';
      merged.disciplineSettings = Object.fromEntries(disciplines.map(d => [d.id, {
        flexible: saved?.disciplineSettings?.[d.id]?.flexible === true,
        courts: clampNumber(saved?.disciplineSettings?.[d.id]?.courts ?? disciplineDefaults[d.id].courts, 1, 12, 2),
        games: clampNumber(saved?.disciplineSettings?.[d.id]?.games ?? disciplineDefaults[d.id].games, 1, 48, 2)
      }]));
      if (merged.format === 'threeKings') { merged.entryType = 'players'; merged.mode = 'partnerMix'; }
      if (merged.format === 'threeKings') merged.courts = disciplines.reduce((sum, d) => sum + merged.disciplineSettings[d.id].courts, 0);
      if (merged.format === 'threeKings') merged.matches.forEach(match => {
        if (!match.scoringMode && [match.scoreA, match.scoreB].every(value => value === '' || value == null)) initializeSetMatch(match);
      });
      if (merged.format === 'singles') { merged.entryType = 'players'; merged.mode = 'limited'; }
      if (!['limited', 'partnerMix'].includes(merged.mode)) {
        merged.mode = 'limited'; merged.teams = []; merged.matches = []; merged.generatedAt = null;
      }
      merged.strengths = merged.participants.map((_, index) => clampNumber(merged.strengths?.[index], 1, 3, 2));
      return merged;
    } catch { return structuredClone(defaults); }
  }
  function loadState(id) {
    try { return normalizeState(JSON.parse(localStorage.getItem(TOURNAMENT_KEY(id)))); }
    catch { return structuredClone(defaults); }
  }
  function initializeSetMatch(match) {
    Object.assign(match, { scoringMode: 'sets7', sets: [], currentSetA: 0, currentSetB: 0, finished: false, scoreA: '', scoreB: '' });
  }
  function matchHasProgress(match) {
    return [match.scoreA, match.scoreB].some(value => value !== '' && value != null) || !!match.sets?.length || match.currentSetA > 0 || match.currentSetB > 0;
  }
  function saveLibrary() { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); }
  function saveState(notify = true) {
    localStorage.setItem(TOURNAMENT_KEY(activeTournamentId), JSON.stringify(state));
    const item = library.items.find(item => item.id === activeTournamentId);
    item.name = state.name || 'Neues Turnier'; item.date = state.date;
    item.hasSchedule = state.matches.length > 0;
    if (notify) { item.updatedAt = Date.now(); item.changeSeq++; item.dirty = true; item.placeholder = false; }
    saveLibrary();
    const el = $('#saveState');
    el.lastChild.textContent = notify ? ' Lokal gespeichert · Online-Speicherung ausstehend' : ' Lokal gespeichert';
    if (notify) window.dispatchEvent(new CustomEvent('planner-state-changed', { detail: {
      tournamentId: activeTournamentId, changeSeq: item.changeSeq
    } }));
  }
  function removeLocalTournament(id) {
    if (!library.items.some(item => item.id === id)) return false;
    library.items = library.items.filter(item => item.id !== id);
    localStorage.removeItem(TOURNAMENT_KEY(id));
    localStorage.removeItem(STORAGE_KEY);
    if (!library.items.length) {
      const freshId = crypto.randomUUID();
      const fresh = { ...structuredClone(defaults), date: today };
      localStorage.setItem(TOURNAMENT_KEY(freshId), JSON.stringify(fresh));
      library.items.push({ id: freshId, name: fresh.name, date: fresh.date,
        updatedAt: Date.now(), dirty: false, changeSeq: 0, remoteVersion: 0,
        hasSchedule: false, placeholder: true });
    }
    if (activeTournamentId === id) activateTournament(library.items[0].id);
    else saveLibrary();
    return true;
  }
  function readForm() {
    state.name = $('#tournamentName').value.trim();
    state.date = $('#tournamentDate').value;
    state.startTime = $('#startTime').value;
    state.courts = clampNumber($('#courtCount').value, 1, 12, 1);
    state.disciplineSettings = Object.fromEntries(disciplines.map(d => [d.id, {
      flexible: $(`#${d.id}Flexible`).checked,
      courts: clampNumber($(`#${d.id}Courts`).value, 1, 12, 2),
      games: clampNumber($(`#${d.id}Games`).value, 1, 48, 2)
    }]));
    if (state.format === 'threeKings') state.courts = disciplines.reduce((sum, d) => sum + state.disciplineSettings[d.id].courts, 0);
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
    disciplines.forEach(d => {
      $(`#${d.id}Courts`).value = state.disciplineSettings[d.id].courts;
      $(`#${d.id}Games`).value = state.disciplineSettings[d.id].games;
      $(`#${d.id}Flexible`).checked = state.disciplineSettings[d.id].flexible === true;
    });
    $(`input[name="format"][value="${state.format}"]`).checked = true;
    const radio = $(`input[name="mode"][value="${state.mode}"]`); if (radio) radio.checked = true;
    state.strengths = state.participants.map((_, index) => clampNumber(state.strengths?.[index], 1, 3, 2));
    renderParticipants(); updateModeUI(); updateTitle();
  }

  function rememberParticipants() {
    const key = state.format === 'singles' ? 'singles' : state.format === 'threeKings' ? 'threeKings' : state.entryType;
    state.participantDrafts[key] = { participants: [...state.participants], strengths: [...state.strengths] };
  }

  function restoreParticipants() {
    const key = state.format === 'singles' ? 'singles' : state.format === 'threeKings' ? 'threeKings' : state.entryType;
    const draft = state.participantDrafts[key];
    state.participants = draft ? [...draft.participants] : state.entryType === 'teams'
      ? ['Team 1', 'Team 2', 'Team 3', 'Team 4']
      : Array.from({ length: 8 }, (_, i) => `Spieler ${i + 1}`);
    state.strengths = draft ? [...draft.strengths] : state.participants.map(() => 2);
  }

  function confirmAction(message, title = 'Spielplan ersetzen?') {
    const dialog = $('#planChangeDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  async function confirmPlanChange() {
    if (state.matches.length && !await confirmAction('Beim Wechsel werden der vorhandene Spielplan und alle Ergebnisse gelöscht. Die Teilnehmerlisten bleiben gespeichert. Fortfahren?')) return false;
    if (state.liveId) {
      try { await window.plannerLive.revoke(); }
      catch { alert('Die Live-Freigabe konnte nicht beendet werden. Prüfe die Internetverbindung und versuche es erneut.'); return false; }
    }
    return true;
  }

  function clearPlan() { state.matches = []; state.teams = []; state.generatedAt = null; state.liveId = null; resetRoundTimer(); }

  async function setFormat(format) {
    if (format === state.format) return;
    if (!await confirmPlanChange()) { hydrateForm(); return; }
    readForm(); rememberParticipants();
    state.format = format; state.mode = 'limited';
    state.entryType = format === 'doubles' ? 'teams' : 'players';
    if (format === 'threeKings') state.mode = 'partnerMix';
    state.courts = format === 'threeKings' ? disciplines.reduce((sum, d) => sum + state.disciplineSettings[d.id].courts, 0) : Math.min(12, state.courts);
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
    const kings = state.format === 'threeKings';
    $('#disciplineSettings').classList.toggle('is-hidden', !kings);
    $('#threeKingsScoringRules').classList.toggle('is-hidden', !kings);
    $('#courtCountWrap').classList.toggle('is-hidden', kings);
    $('#modeHeading').textContent = singles ? 'Spiele pro Spieler' : 'Doppelmodus';
    $('#modeSelector').classList.toggle('is-hidden', singles || kings);
    $$('input[name="mode"]').forEach(input => { input.disabled = singles || kings; });
    if (kings) $('#modeHeading').textContent = 'Drei Disziplinen planen';
    $('#singlesHelper').classList.toggle('is-hidden', !singles);
    $('#entrySelector').classList.toggle('is-hidden', singles || mix);
    $$('.toggle button').forEach(b => {
      b.classList.toggle('is-active', b.dataset.entry === state.entryType);
      b.setAttribute('aria-pressed', String(b.dataset.entry === state.entryType));
    });
    $('#gamesPerTeamWrap').classList.remove('is-hidden');
    $('#gamesPerTeamWrap').classList.toggle('is-hidden', kings);
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
    if (state.format === 'threeKings') {
      renderDisciplineSuggestion(count);
      $('#setupSummary').textContent = `Drei Königsturnier · ${count} Spieler · ` + disciplines.map(d => {
        const { courts, games } = state.disciplineSettings[d.id];
        return `${d.name}: ${courts} ${courts === 1 ? d.unit : d.unit === 'Platte' ? 'Platten' : d.unit === 'Feld' ? 'Felder' : 'Plätze'}, ${games} ${games === 1 ? 'Spiel' : 'Spiele'} pro Person`;
      }).join(' · ');
      const errors = disciplines.map(d => { const error = threeKingsValidation(count, state.disciplineSettings[d.id].games, state.disciplineSettings[d.id].flexible); return error ? `${d.name}: ${error}` : ''; }).filter(Boolean);
      $('#planningHint').textContent = errors.join(' ');
      $('#planningHint').classList.toggle('is-hidden', !errors.length);
      return;
    }
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
    if (state.matches.some(matchHasProgress) && !await confirmAction('Spielplan neu erstellen und vorhandene Ergebnisse löschen?')) return;
    try {
      generateTournamentPlan();
    } catch (error) { showNotice(error.message); }
  }

  function generateTournamentPlan() {
    let selected;
    if (state.format === 'threeKings') {
      const players = state.participants.map(n => n.trim()).filter(Boolean);
      const matches = generateThreeKings(players);
      state.teams = players;
      state.matches = matches;
      state.courts = disciplines.reduce((sum, d) => sum + state.disciplineSettings[d.id].courts, 0);
    } else if (state.format === 'singles') {
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
    if (state.format !== 'threeKings') state.matches = scheduleMatches(selected);
    resetRoundTimer();
    state.generatedAt = Date.now(); saveState(); renderOutputs(); showTab('schedule');
    return { teams: state.teams.length, matches: state.matches.length };
  }

  function courtLabel(match) {
    if (state.format !== 'threeKings') return `Platz ${match.court}`;
    const scheduled = match.discipline ? match : state.matches.find(m => m.court === match.court && m.discipline);
    const sport = disciplines.find(d => d.id === scheduled?.discipline);
    if (sport) return `${sport.name} · ${sport.unit} ${scheduled.disciplineCourt}`;
    let offset = 0;
    for (const d of disciplines) {
      const count = state.disciplineSettings[d.id].courts;
      if (match.court <= offset + count) return `${d.name} · ${d.unit} ${match.court - offset}`;
      offset += count;
    }
    return `Platz ${match.court}`;
  }

  function matchTypeLabel(match) {
    if (match.matchKind === 'singles') return 'Einzel';
    if (match.matchKind !== 'triple') return '';
    const start = Math.floor((match.sequence - 1) * state.duration * 60 / 3);
    const end = Math.floor(match.sequence * state.duration * 60 / 3);
    return `Dreierrunde · Einzel ${match.sequence}/3 · ${formatCountdown(start)}–${formatCountdown(end)} im Zeitblock`;
  }

  function greatestCommonDivisor(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
  }

  function suggestThreeKingsGames(playerCount, settings) {
    if (!Number.isInteger(playerCount) || playerCount < 4) return null;
    const courts = disciplines.map(d => settings?.[d.id]?.courts);
    if (courts.some(n => !Number.isInteger(n) || n < 1 || n > 12)) return null;
    // Reduce the court ratio, then use the smallest multiplier that forms complete doubles.
    const divisor = courts.reduce(greatestCommonDivisor);
    const base = courts.map(n => n / divisor);
    const unit = [1, 2, 3, 4].find(k => base.every((g, i) => playerCount * g * k % (settings[disciplines[i].id].flexible ? 2 : 4) === 0));
    return Object.fromEntries(disciplines.map((d, index) => [d.id, courts[index] / divisor * unit]));
  }

  function renderDisciplineSuggestion(count) {
    const suggestion = suggestThreeKingsGames(count, state.disciplineSettings);
    const button = $('#applyDisciplineSuggestion');
    button.disabled = !suggestion;
    $('#disciplineSuggestion').textContent = suggestion
      ? `Kleinster Vorschlag für ${count} Spieler: ${disciplines.map(d => `${d.name} ${suggestion[d.id]} ${suggestion[d.id] === 1 ? 'Spiel' : 'Spiele'}`).join(' · ')} pro Person. Die Spielanzahlen entsprechen dem Verhältnis der Plätze; innerhalb jeder Disziplin spielen alle gleich oft. Der Vorschlag aktualisiert sich bei Änderungen an Spielern oder Plätzen.`
      : 'Für einen Spielvorschlag bitte mindestens vier Spieler eintragen.';
  }

  function applyDisciplineSuggestion() {
    readForm();
    const count = state.participants.filter(name => name.trim()).length;
    const suggestion = suggestThreeKingsGames(count, state.disciplineSettings);
    if (!suggestion || state.format !== 'threeKings') return;
    disciplines.forEach(d => { $(`#${d.id}Games`).value = suggestion[d.id]; });
    readForm();
  }

  function threeKingsValidation(count, games, flexible = false) {
    if (count < 4) return 'Für wechselnde Doppel werden mindestens vier Spieler benötigt.';
    if (flexible) return count * games % 2 ? 'Mit Einzel und Dreierrunden muss die Gesamtzahl der Einsätze gerade sein. Bei ungerader Spielerzahl bitte eine gerade Spielanzahl pro Person wählen.' : '';
    if ((count * games) % 4) {
      const step = count % 2 ? 4 : 2;
      return `Bei ${count} Spielern sind für exakt gleiche Einsätze Vielfache von ${step} möglich, zum Beispiel ${step}, ${step * 2} oder ${step * 3} Spiele pro Person.`;
    }
    return '';
  }

  function generateThreeKings(players) {
    if (new Set(players.map(n => n.toLowerCase())).size !== players.length) throw new Error('Jeder Spielername muss eindeutig sein.');
    const remaining = {};
    for (const d of disciplines) {
      const settings = state.disciplineSettings[d.id];
      if (!settings || !Number.isInteger(settings.courts) || settings.courts < 1 || settings.courts > 12 || !Number.isInteger(settings.games) || settings.games < 1 || settings.games > 48) throw new Error(`${d.name}: Bitte 1–12 Plätze und 1–48 Spiele pro Person wählen.`);
      const error = threeKingsValidation(players.length, settings.games, settings.flexible);
      if (error) throw new Error(`${d.name}: ${error}`);
      remaining[d.id] = new Map(players.map(p => [p, settings.games]));
    }
    const strengths = Object.fromEntries(players.map(p => [p, clampNumber(state.strengths[state.participants.indexOf(p)], 1, 3, 2)]));
    const partners = new Map(), opponents = new Map(), lastSlot = new Map();
    const output = [];
    let slot = 0;
    while (disciplines.some(d => [...remaining[d.id].values()].some(n => n > 0))) {
      const busy = new Set(), block = [];
      const courtUse = Object.fromEntries(disciplines.map(d => [d.id, 0]));
      // Reconsider every sport after each match. Largest outstanding quotas have priority.
      while (true) {
        const options = disciplines.map((d, index) => {
          const pool = players.filter(p => !busy.has(p) && remaining[d.id].get(p) > 0)
            .map(p => ({ name: p, left: remaining[d.id].get(p), last: lastSlot.get(p) ?? -1, tie: Math.random() }))
            .sort((a, b) => b.left - a.left || a.last - b.last || a.tie - b.tie);
          const quota = remaining[d.id];
          const flexible = state.disciplineSettings[d.id].flexible;
          const total = [...quota.values()].reduce((a, b) => a + b, 0);
          const candidates = flexible ? [{ size: 4, cost: 1 }, { size: 3, cost: 2 }, { size: 2, cost: 1 }] : [{ size: 4, cost: 1 }];
          const choice = candidates.find(({ size, cost }) => {
            if (pool.length < size || pool.slice(0, size).some(p => p.left < cost)) return false;
            const selected = new Set(pool.slice(0, size).map(p => p.name));
            const left = total - size * cost;
            return players.every(p => quota.get(p) - (selected.has(p) ? cost : 0) <= left / (flexible ? 2 : 4));
          });
          return { d, pool, index, choice, load: total / state.disciplineSettings[d.id].courts };
        }).filter(o => {
          return courtUse[o.d.id] < state.disciplineSettings[o.d.id].courts && o.choice;
        })
          .sort((a, b) => b.load - a.load || ((a.index + slot) % 3) - ((b.index + slot) % 3));
        if (!options.length) break;
        const { d, pool, choice } = options[0];
        const group = pool.slice(0, choice.size).map(p => p.name);
        const quota = remaining[d.id];
        if (choice.size < 4) {
          const court = disciplines.slice(0, disciplines.indexOf(d)).reduce((sum, sport) => sum + state.disciplineSettings[sport.id].courts, 0) + ++courtUse[d.id];
          const reservationId = crypto.randomUUID();
          const pairs = choice.size === 3 ? [[group[0], group[1]], [group[0], group[2]], [group[1], group[2]]] : [[group[0], group[1]]];
          group.forEach(p => { quota.set(p, quota.get(p) - choice.cost); busy.add(p); lastSlot.set(p, slot); });
          pairs.forEach(([a, b], index) => {
            incrementCount(opponents, pairKey(a, b));
            block.push({ id: crypto.randomUUID(), teamA: a, teamB: b, playersA: [a], playersB: [b],
              discipline: d.id, disciplineCourt: courtUse[d.id], court, slot, round: slot + 1, roundLabel: `Zeitblock ${slot + 1}`,
              matchKind: choice.size === 3 ? 'triple' : 'singles', reservationId, sequence: index + 1,
              sequenceCount: pairs.length, scoreA: '', scoreB: '' });
          });
          continue;
        }
        const choices = [[[group[0], group[1]], [group[2], group[3]]], [[group[0], group[2]], [group[1], group[3]]], [[group[0], group[3]], [group[1], group[2]]]];
        shuffle(choices);
        choices.sort((a, b) => mixPairingScore(a, partners, opponents, strengths) - mixPairingScore(b, partners, opponents, strengths));
        const [playersA, playersB] = choices[0];
        incrementCount(partners, pairKey(...playersA)); incrementCount(partners, pairKey(...playersB));
        playersA.forEach(a => playersB.forEach(b => incrementCount(opponents, pairKey(a, b))));
        group.forEach(p => { quota.set(p, quota.get(p) - 1); busy.add(p); lastSlot.set(p, slot); });
        const court = disciplines.slice(0, disciplines.indexOf(d)).reduce((sum, sport) => sum + state.disciplineSettings[sport.id].courts, 0) + ++courtUse[d.id];
        block.push({ id: crypto.randomUUID(), teamA: playersA.join(' & '), teamB: playersB.join(' & '), playersA, playersB,
          discipline: d.id, court, disciplineCourt: courtUse[d.id], slot, round: slot + 1, roundLabel: `Zeitblock ${slot + 1}`, scoreA: '', scoreB: '' });
      }
      if (!block.length) throw new Error('Die Disziplinen konnten nicht vollständig geplant werden. Bitte Einstellungen prüfen.');
      const byes = players.filter(p => !busy.has(p));
      block.forEach(m => { m.roundNote = byes.length ? `Pause: ${byes.join(', ')}` : ''; });
      output.push(...block); slot++;
    }
    output.forEach(initializeSetMatch);
    return output;
  }

  function renderDisciplineOverview() {
    const root = $('#disciplineOverview');
    const visible = state.format === 'threeKings' && state.matches.length > 0;
    root.classList.toggle('is-hidden', !visible);
    if (!visible) { root.innerHTML = ''; return; }
    root.innerHTML = `<table><caption>Geplante Einsätze pro Person</caption><thead><tr><th>Spieler</th>${disciplines.map(d => `<th>${d.name}</th>`).join('')}</tr></thead><tbody>${state.teams.map(p => `<tr><td>${escapeHtml(p)}</td>${disciplines.map(d => `<td>${state.matches.filter(m => m.discipline === d.id && [...m.playersA, ...m.playersB].includes(p)).length}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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

  function generatePartnerMix(players, gamesPerPlayer, history = [], opening = null) {
    const validationError = partnerMixValidation(players.length, Number(gamesPerPlayer));
    if (validationError) throw new Error(validationError);
    const partnerCounts = new Map(), opponentCounts = new Map();
    history.forEach(match => {
      if (!match.playersA || !match.playersB) return;
      incrementCount(partnerCounts, pairKey(...match.playersA));
      incrementCount(partnerCounts, pairKey(...match.playersB));
      match.playersA.forEach(a => match.playersB.forEach(b => incrementCount(opponentCounts, pairKey(a, b))));
    });
    const strengths = Object.fromEntries(players.map((name, index) => [name, clampNumber(state.strengths[index], 1, 3, 2)]));
    const remaining = Object.fromEntries(players.map(name => [name, Number(gamesPerPlayer)]));
    const matchCapacity = Math.min(state.courts, Math.floor(players.length / 4));
    const totalMatches = players.length * Number(gamesPerPlayer) / 4;
    const roundCount = Math.max(Number(gamesPerPlayer), Math.ceil(totalMatches / matchCapacity));
    let matchesPerRound = Array.from({ length: roundCount }, (_, index) =>
      Math.min(matchCapacity, Math.max(0, totalMatches - index * matchCapacity))
    );
    if (opening && Number(gamesPerPlayer) === 1) {
      matchesPerRound = [opening.capacity];
      for (let left = totalMatches - opening.capacity; left > 0; left -= matchCapacity) {
        matchesPerRound.push(Math.min(matchCapacity, left));
      }
    }
    const rounds = [];
    matchesPerRound.forEach((matchCount, roundIndex) => {
      const active = [...players]
        .filter(name => !opening || roundIndex !== 0 || !opening.busy.has(name))
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

  function additionalRoundError() {
    if (state.format === 'threeKings') return 'Für weitere Spiele die Spielanzahl je Disziplin in der Vorbereitung ändern und den Plan neu erstellen.';
    if (!state.matches.length) return 'Erstelle zuerst einen Spielplan.';
    if (state.mode === 'partnerMix') {
      if (state.teams.length < 4 || state.teams.length % 4) return 'Genau ein weiteres Spiel pro Spieler ist beim Partnerwechsel nur mit einer durch 4 teilbaren Spielerzahl möglich.';
    } else if (state.teams.length < 2 || state.teams.length % 2) {
      return `Genau ein weiteres Spiel pro ${state.format === 'singles' ? 'Spieler' : 'Team'} ist nur bei gerader ${state.format === 'singles' ? 'Spielerzahl' : 'Teamzahl'} möglich.`;
    }
    return '';
  }

  function appendTournamentRound() {
    const error = additionalRoundError();
    if (error) throw new Error(error);
    // Use the scheduled roster, even if the preparation form has since changed.
    const lastSlot = Math.max(...state.matches.map(match => match.slot));
    const lastMatches = state.matches.filter(match => match.slot === lastSlot);
    const busy = new Set(lastMatches.flatMap(matchParticipants));
    const freeCourts = Array.from({ length: state.courts }, (_, i) => i + 1)
      .filter(court => !lastMatches.some(match => match.court === court));
    const canFill = !lastMatches.some(match => [match.scoreA, match.scoreB].some(score => score !== '' && score != null));
    const capacity = canFill ? Math.min(freeCourts.length, Math.floor((state.teams.length - busy.size) / (state.mode === 'partnerMix' ? 4 : 2))) : 0;
    let rounds;
    if (state.mode === 'partnerMix') {
      rounds = generatePartnerMix(state.teams, 1, state.matches, capacity ? { capacity, busy } : null);
    } else {
      const encounters = new Map();
      state.matches.forEach(match => incrementCount(encounters, pairKey(match.teamA, match.teamB)));
      // Choose the least repeated complete pairing from a randomized round robin.
      const pool = [...state.teams]; shuffle(pool);
      rounds = [generateRoundRobin(pool).map(round => ({
        round, repeats: round.matches.reduce((sum, match) => sum + (encounters.get(pairKey(match.teamA, match.teamB)) || 0), 0)
      })).sort((a, b) => a.repeats - b.repeats)[0].round];
    }
    const number = Math.max(...state.matches.map(match => Number(match.round) || 0)) + 1;
    rounds.forEach(round => {
      round.label = `Runde ${number}`;
      round.matches.forEach(match => { match.round = number; });
    });
    const pending = rounds.flatMap(round => round.matches);
    const filled = [];
    if (capacity) {
      for (let index = 0; index < pending.length && filled.length < capacity;) {
        if (matchParticipants(pending[index]).some(name => busy.has(name))) { index++; continue; }
        const match = pending.splice(index, 1)[0];
        filled.push({ ...match, slot: lastSlot, court: freeCourts[filled.length] });
        matchParticipants(match).forEach(name => busy.add(name));
      }
    }
    const added = [...filled, ...scheduleMatches([{ label: `Runde ${number}`, matches: pending }])
      .map(match => ({ ...match, slot: match.slot + lastSlot + 1 }))];
    state.matches.push(...added);
    new Set(added.map(match => match.slot)).forEach(updateSlotDescription);
    return added;
  }

  function matchParticipants(match) {
    return state.mode === 'partnerMix' ? [...(match.playersA || []), ...(match.playersB || [])] : [match.teamA, match.teamB];
  }

  function updateSlotDescription(slot) {
    const matches = state.matches.filter(match => match.slot === slot);
    const rounds = [...new Set(matches.map(match => match.round))];
    const active = new Set(matches.flatMap(matchParticipants));
    const resting = state.teams.filter(name => !active.has(name));
    matches.forEach(match => {
      match.roundLabel = `Runde${rounds.length > 1 ? 'n' : ''} ${rounds.join(' / ')}`;
      match.roundNote = resting.length ? `Pause: ${resting.join(', ')}` : '';
    });
  }

  function addTournamentRound() {
    try {
      appendTournamentRound();
      saveState(); renderOutputs();
    } catch (error) { alert(error.message); }
  }

  function findRemovalRotation(number) {
    const rounds = [...new Set(state.matches.map(match => match.round))];
    const selected = rounds.indexOf(number);
    if (selected < 0) return null;
    const appearances = rounds.map(round => {
      const counts = new Map(state.teams.map(name => [name, 0]));
      state.matches.filter(match => match.round === round).forEach(match => {
        const names = state.mode === 'partnerMix'
          ? [...(match.playersA || []), ...(match.playersB || [])] : [match.teamA, match.teamB];
        names.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
      });
      return counts;
    });
    let best = null;
    for (let start = selected; start >= 0; start--) {
      const totals = new Map(state.teams.map(name => [name, 0]));
      for (let end = start; end < rounds.length; end++) {
        if (best && end - start + 1 >= best.rounds.length) break;
        appearances[end].forEach((count, name) => totals.set(name, (totals.get(name) || 0) + count));
        const values = [...totals.values()];
        if (end >= selected && values.length === state.teams.length && values[0] > 0 && values.every(count => count === values[0])) {
          best = { rounds: rounds.slice(start, end + 1), gamesPerParticipant: values[0] };
          break;
        }
      }
    }
    return best;
  }

  async function removeTournamentRound(number, confirmRemoval = confirmAction) {
    if (state.format === 'threeKings') return false;
    const tournament = state;
    const tournamentId = activeTournamentId;
    const schedule = state.matches;
    if (!schedule.some(match => match.round === number)) return false;
    const rotation = findRemovalRotation(number);
    if (!rotation) throw new Error('Diese Runde gehört zu keiner vollständigen Rotation, bei der jeder Teilnehmer gleich viele Spiele verliert. Es wurde nichts entfernt.');
    const removedRounds = new Set(rotation.rounds);
    const matches = schedule.filter(match => removedRounds.has(match.round));
    const hasResults = matches.some(match => [match.scoreA, match.scoreB].some(score => score !== '' && score != null));
    const slots = new Set(matches.map(match => match.slot)).size;
    const message = `Vollständige Rotation (Runde${rotation.rounds.length > 1 ? 'n' : ''} ${rotation.rounds.join(', ')}) mit ${matches.length} Spielen${slots > 1 ? ` in ${slots} Zeitblöcken` : ''} entfernen?`
      + ` Jeder ${state.mode === 'partnerMix' || state.format === 'singles' ? 'Spieler' : 'Teilnehmer bzw. jedes feste Team'} verliert ${rotation.gamesPerParticipant} ${rotation.gamesPerParticipant === 1 ? 'Spiel' : 'Spiele'}.`
      + (hasResults ? ' Achtung: In dieser Rotation sind bereits Ergebnisse eingetragen. Diese werden unwiderruflich gelöscht und aus der Rangliste entfernt.' : '')
      + ' Die übrigen Runden behalten ihre Spielzeiten und Ergebnisse.';
    if (!await confirmRemoval(message, 'Rotation entfernen?')) return false;
    // A remote update or tournament switch must not delete a different schedule.
    if (state !== tournament || activeTournamentId !== tournamentId || state.matches !== schedule) return false;
    state.matches = schedule.filter(match => !removedRounds.has(match.round));
    new Set(matches.map(match => match.slot)).forEach(updateSlotDescription);
    return true;
  }

  async function deleteRound(number) {
    try {
      if (!await removeTournamentRound(number)) return;
    } catch (error) { alert(error.message); return; }
    if (!state.matches.length) resetRoundTimer();
    saveState(); renderOutputs();
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
    renderDisciplineOverview();
    const hasMatches = state.matches.length > 0;
    $('#scheduleEmpty').classList.toggle('is-hidden', hasMatches);
    $('#standingsEmpty').classList.toggle('is-hidden', hasMatches);
    $('#scheduleSummary').classList.toggle('is-hidden', !hasMatches);
    $('#roundTimer').classList.toggle('is-hidden', !hasMatches);
    $('#additionalRoundActions').classList.toggle('is-hidden', !hasMatches || state.format === 'threeKings');
    $('#addRoundButton').disabled = !!additionalRoundError();
    $('#addRoundButton').title = additionalRoundError();
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
    const completed = state.matches.filter(m => m.scoringMode === 'sets7' ? m.finished : validScore(m.scoreA) && validScore(m.scoreB)).length;
    const endSlot = Math.max(...state.matches.map(m => m.slot)) + 1;
    const endTime = addMinutes(state.startTime, endSlot * (state.duration + state.breakDuration) - state.breakDuration);
    $('#scheduleSummary').innerHTML = [
      [state.format === 'threeKings' ? 'Drei Könige · Spieler' : state.format === 'singles' ? 'Einzel · Spieler' : state.mode === 'partnerMix' ? 'Doppel · Spieler' : 'Doppel · Teams', state.teams.length], ['Spiele', `${completed} / ${state.matches.length}`], ['Plätze', state.courts], ['Zeitraum', `${state.startTime}–${endTime} Uhr`]
    ].map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');

    const bySlot = Map.groupBy ? Map.groupBy(state.matches, m => m.slot) : state.matches.reduce((map, m) => map.set(m.slot, [...(map.get(m.slot) || []), m]), new Map());
    [...bySlot.entries()].forEach(([slot, matches]) => {
      const block = document.createElement('article'); block.className = 'round-block';
      const time = addMinutes(state.startTime, slot * (state.duration + state.breakDuration));
      const phase = matches[0].roundLabel;
      block.innerHTML = `<header class="round-header"><h3>${escapeHtml(phase)}</h3><span>${time} Uhr · ${state.duration} Min.${matches[0].roundNote ? ` · ${escapeHtml(matches[0].roundNote)}` : ''}</span></header>`;
      const roundNumbers = [...new Set(matches.map(match => match.round))];
      (state.format === 'threeKings' ? [] : roundNumbers).forEach(number => {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'button button-danger';
        remove.textContent = roundNumbers.length > 1 ? `Rotation mit Runde ${number} entfernen` : 'Rotation entfernen';
        remove.setAttribute('aria-label', `Vollständige Rotation mit Runde ${number} entfernen`);
        remove.addEventListener('click', () => deleteRound(number));
        $('.round-header', block).appendChild(remove);
      });
      matches.forEach(match => {
        if (match.scoringMode === 'sets7') { block.appendChild(createSetMatchRow(match)); return; }
        const row = document.createElement('div'); row.className = 'match-row';
        row.innerHTML = `<span class="court-badge">${escapeHtml(courtLabel(match))}${matchTypeLabel(match) ? `<span class="match-label">${escapeHtml(matchTypeLabel(match))}</span>` : ''}</span>
          <span class="team-name right">${escapeHtml(match.teamA)}${match.placeholder ? '<span class="match-label">wird ermittelt</span>' : ''}</span>
          <span class="versus">VS</span><span class="team-name">${escapeHtml(match.teamB)}</span>
          <div class="score-box"><input inputmode="numeric" min="0" max="99" type="number" aria-label="${state.format === 'threeKings' ? 'Ballwechselpunkte' : 'Ergebnis'} ${escapeAttr(match.teamA)}" value="${escapeAttr(match.scoreA)}"><span>:</span><input inputmode="numeric" min="0" max="99" type="number" aria-label="${state.format === 'threeKings' ? 'Ballwechselpunkte' : 'Ergebnis'} ${escapeAttr(match.teamB)}" value="${escapeAttr(match.scoreB)}"></div>${state.format === 'threeKings' ? '<p class="score-feedback" aria-live="polite"></p>' : ''}`;
        const feedback = $('.score-feedback', row);
        if (feedback) feedback.textContent = scoringFeedback(match);
        const inputs = $$('input', row);
        inputs.forEach((input, idx) => input.addEventListener('input', () => {
          match[idx === 0 ? 'scoreA' : 'scoreB'] = input.value === '' ? '' : clampNumber(input.value, 0, 99, 0);
          if (feedback) feedback.textContent = scoringFeedback(match);
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
    const completed = state.matches.filter(m => m.scoringMode === 'sets7' ? m.finished : validScore(m.scoreA) && validScore(m.scoreB)).length;
    const strong = $$('.summary-item strong')[1]; if (strong) strong.textContent = `${completed} / ${state.matches.length}`;
  }

  function renderStandings() {
    const root = $('#standingsContent'); root.innerHTML = '';
    $('#rankingRule').textContent = state.format === 'threeKings' ? '2 / 1 / 0 Tabellenpunkte · jede Disziplin zählt ⅓' : 'Sortierung: Siege · Differenz · erzielte Punkte';
    if (!state.matches.length) return;
    if (state.format === 'threeKings') {
      root.innerHTML = globalThis.threeKingsScoring.render(state, selectedScoringName);
      return;
    }
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

  function scoringFeedback(match) {
    if (!validScore(match.scoreA) || !validScore(match.scoreB)) return 'Ballwechselpunkte eintragen · Sieg 2, Unentschieden 1, Niederlage 0 Tabellenpunkte pro Person.';
    const a = Number(match.scoreA), b = Number(match.scoreB);
    if (a === b) return 'Unentschieden · alle Beteiligten erhalten 1 Tabellenpunkt.';
    const winners = a > b ? match.playersA : match.playersB;
    const names = winners?.join(' & ') || (a > b ? match.teamA : match.teamB);
    return `Sieg für ${names} · ${winners?.length > 1 ? 'jeweils ' : ''}2 Tabellenpunkte. Gegenseite: 0.`;
  }

  function createSetMatchRow(match) {
    const row = document.createElement('div'); row.className = 'match-row set-match-row';
    const result = globalThis.threeKingsScoring.setSummary(match);
    const completedSets = (match.sets || []).map((set, i) => `Satz ${i + 1}: ${set.a}:${set.b}${set.atTimeLimit ? ' (Zeitende)' : ''}`).join(' · ');
    const finalFeedback = match.finished ? result.a === result.b ? 'Unentschieden · alle Beteiligten erhalten 1 Tabellenpunkt.' : `Sieg für ${result.a > result.b ? match.teamA : match.teamB} · je Person 2 Tabellenpunkte; Gegenseite 0.` : 'Abgeschlossene Sätze mit ihrem Ergebnis nachtragen, zum Beispiel 7:4 oder 6:7.';
    row.innerHTML = `<span class="court-badge">${escapeHtml(courtLabel(match))}${matchTypeLabel(match) ? `<span class="match-label">${escapeHtml(matchTypeLabel(match))}</span>` : ''}</span>
      <span class="team-name right">${escapeHtml(match.teamA)}</span><span class="versus">VS</span><span class="team-name">${escapeHtml(match.teamB)}</span>
      <div class="set-summary"><strong>${result.a} : ${result.b}</strong><span>Sätze · ${match.finished ? 'beendet' : 'erfasst'}</span></div>
      <div class="set-editor"><p class="helper set-history">${escapeHtml(completedSets || 'Noch kein Satz abgeschlossen.')}</p>
      <div class="set-manual"${match.finished ? ' hidden' : ''}><strong>Abgeschlossenen Satz nachtragen</strong><div class="set-actions"><label class="field">Satzpunkte ${escapeHtml(match.teamA)}<input data-set-input="A" type="number" min="0" max="7" placeholder="z. B. 7"></label><label class="field">Satzpunkte ${escapeHtml(match.teamB)}<input data-set-input="B" type="number" min="0" max="7" placeholder="z. B. 4"></label><button type="button" class="button button-ghost" data-record-set>Satz speichern</button></div></div>
      <p class="score-feedback" aria-live="polite">${escapeHtml(finalFeedback)}${match.finished && match.timeLimitNote ? ` ${escapeHtml(match.timeLimitNote)}` : ''}</p>
      <div class="set-final"${match.finished ? ' hidden' : ''}><strong>Letzter unvollständiger Satz bei Zeitende (optional)</strong><p class="helper">Stand bei Abpfiff eintragen. Ohne angefangenen Satz beide Felder leer lassen. Er zählt nur bei Führung und zusammen mindestens 4 Punkten.</p><div class="set-actions"><label class="field">Letzter Satz ${escapeHtml(match.teamA)}<input data-final-input="A" type="number" min="0" max="6" value="${match.currentSetA || match.currentSetB ? escapeAttr(match.currentSetA) : ''}" placeholder="0"></label><label class="field">Letzter Satz ${escapeHtml(match.teamB)}<input data-final-input="B" type="number" min="0" max="6" value="${match.currentSetA || match.currentSetB ? escapeAttr(match.currentSetB) : ''}" placeholder="0"></label></div></div>
      <div class="set-actions"><button class="button button-primary" type="button" data-finish-match${match.finished ? ' hidden' : ''}>Spiel bei Zeitende abschließen</button><button class="button button-ghost" type="button" data-undo-set${match.previousSetState ? '' : ' disabled'}>${match.finished ? 'Abschluss rückgängig' : 'Letzte Eingabe rückgängig'}</button></div>
      <p class="notice is-hidden" data-set-error role="alert"></p></div>`;
    const apply = action => {
      try {
        Object.assign(match, action()); saveState(); renderStandings(); updateSummaryProgress();
        // Keep the entry fields in place while updating the recorded results.
        const fresh = createSetMatchRow(match);
        for (const selector of ['.set-summary', '.set-history', '.score-feedback']) $(selector, row).innerHTML = $(selector, fresh).innerHTML;
        for (const selector of ['.set-final', '.set-manual', '[data-finish-match]']) $(selector, row).hidden = match.finished;
        const undo = $('[data-undo-set]', row); undo.disabled = !match.previousSetState; undo.textContent = match.finished ? 'Abschluss rückgängig' : 'Letzte Eingabe rückgängig';
        $('[data-set-error]', row).classList.add('is-hidden');
      } catch (error) { const notice = $('[data-set-error]', row); notice.textContent = error.message; notice.classList.remove('is-hidden'); }
    };
    $('[data-record-set]', row)?.addEventListener('click', () => {
      const a = $('[data-set-input="A"]', row).value, b = $('[data-set-input="B"]', row).value;
      apply(() => {
        if (a === '' || b === '') throw new Error('Bitte beide Satzpunktstände eintragen.');
        const next = globalThis.threeKingsScoring.recordSet(match, Number(a), Number(b));
        $('[data-set-input="A"]', row).value = ''; $('[data-set-input="B"]', row).value = '';
        return next;
      });
    });
    $('[data-finish-match]', row)?.addEventListener('click', () => apply(() => {
      if ($$('[data-set-input]', row).some(input => input.value !== '')) throw new Error('Bitte den eingetragenen vollständigen Satz zuerst speichern oder die Eingabefelder leeren.');
      const a = $('[data-final-input="A"]', row).value, b = $('[data-final-input="B"]', row).value;
      if ((a === '') !== (b === '')) throw new Error('Bitte beide Punktstände des letzten Satzes eingeben, auch eine 0.');
      return globalThis.threeKingsScoring.finishMatch(match, a === '' ? 0 : Number(a), b === '' ? 0 : Number(b));
    }));
    $$('[data-final-input]', row).forEach(input => input.addEventListener('change', () => {
      const a = $('[data-final-input="A"]', row).value, b = $('[data-final-input="B"]', row).value;
      const values = [a === '' ? 0 : Number(a), b === '' ? 0 : Number(b)];
      if (values.every(value => Number.isInteger(value) && value >= 0 && value <= 6)) {
        [match.currentSetA, match.currentSetB] = values; saveState();
      }
    }));
    $('[data-undo-set]', row).addEventListener('click', () => {
      apply(() => globalThis.threeKingsScoring.undoSetAction(match));
      for (const side of ['A', 'B']) $(`[data-final-input="${side}"]`, row).value = match.currentSetA || match.currentSetB ? match[`currentSet${side}`] : '';
    });
    return row;
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
  $('#standingsContent').addEventListener('click', event => {
    const button = event.target.closest('[data-ranking-person]');
    if (!button || state.format !== 'threeKings') return;
    selectedScoringName = button.dataset.rankingPerson; renderStandings();
  });
  $('#applyDisciplineSuggestion').addEventListener('click', applyDisciplineSuggestion);
  $('#editSetup').addEventListener('click', () => showTab('setup'));
  $('#addRoundButton').addEventListener('click', addTournamentRound);
  $('#timerToggle').addEventListener('click', toggleRoundTimer);
  $('#timerReset').addEventListener('click', resetRoundTimer);
  window.plannerLive = {
    getData: () => ({
      name: state.name, date: state.date, startTime: state.startTime,
      courts: state.courts, duration: state.duration, breakDuration: state.breakDuration,
      format: state.format, mode: state.mode, teams: [...state.teams],
      matches: structuredClone(state.matches), generatedAt: state.generatedAt
    }),
    getId: () => state.liveId,
    setId: id => { state.liveId = id; saveState(); },
    hasSchedule: () => state.matches.length > 0
  };
  function activateTournament(id) {
    const item = library.items.find(item => item.id === id);
    if (!item) return false;
    activeTournamentId = id; library.activeId = id; saveLibrary();
    state = loadState(id); resetRoundTimer(); hydrateForm(); renderOutputs();
    showTab(state.matches.length ? 'schedule' : 'setup'); updateTitle();
    $('#saveState').lastChild.textContent = item.dirty ? ' Lokal gespeichert · Online-Speicherung ausstehend'
      : item.remoteVersion ? ' Online gespeichert' : ' Lokal gespeichert';
    window.dispatchEvent(new CustomEvent('planner-tournament-changed', { detail: { tournamentId: id } }));
    return true;
  }
  window.plannerStore = {
    list: () => structuredClone(library.items),
    activeId: () => activeTournamentId,
    localState: id => { try { return JSON.parse(localStorage.getItem(TOURNAMENT_KEY(id))); } catch { return null; } },
    create: () => {
      const id = crypto.randomUUID();
      library.items.unshift({ id, name: defaults.name, date: today, updatedAt: Date.now(),
        dirty: true, changeSeq: 1, remoteVersion: 0, hasSchedule: false });
      localStorage.setItem(TOURNAMENT_KEY(id), JSON.stringify({ ...defaults, date: today }));
      activateTournament(id); return id;
    },
    open: activateTournament,
    importRemote: (id, remoteState, version, force = false) => {
      let item = library.items.find(item => item.id === id);
      if (item?.dirty && !force) return false;
      if (!item) {
        item = { id, name: '', date: '', updatedAt: Date.now(), dirty: false,
          changeSeq: 0, remoteVersion: 0, hasSchedule: false };
        library.items.push(item);
      }
      if (!force && version <= item.remoteVersion) return true;
      const clean = normalizeState(remoteState);
      localStorage.setItem(TOURNAMENT_KEY(id), JSON.stringify(clean));
      item.name = clean.name; item.date = clean.date; item.hasSchedule = clean.matches.length > 0;
      item.remoteVersion = version; item.updatedAt = Date.now(); item.dirty = false; saveLibrary();
      const empty = library.items.find(entry => entry.id === activeTournamentId && entry.placeholder && !entry.dirty);
      if (empty && empty.id !== id) {
        library.items = library.items.filter(entry => entry.id !== empty.id);
        localStorage.removeItem(TOURNAMENT_KEY(empty.id));
        activateTournament(id);
      } else if (id === activeTournamentId) activateTournament(id);
      return true;
    },
    duplicateLocal: id => {
      const source = window.plannerStore.localState(id);
      if (!source) return null;
      const copyId = crypto.randomUUID();
      source.name = `${source.name || 'Turnier'} (lokale Kopie)`;
      source.liveId = null;
      localStorage.setItem(TOURNAMENT_KEY(copyId), JSON.stringify(source));
      library.items.unshift({ id: copyId, name: source.name, date: source.date,
        updatedAt: Date.now(), dirty: true, changeSeq: 1, remoteVersion: 0,
        hasSchedule: !!source.matches?.length });
      saveLibrary(); return copyId;
    },
    removeLocal: removeLocalTournament,
    markSynced: (id, version, changeSeq) => {
      const item = library.items.find(item => item.id === id);
      if (!item) return;
      item.remoteVersion = version;
      if (item.changeSeq === changeSeq) item.dirty = false;
      saveLibrary();
      if (id === activeTournamentId && !item.dirty) $('#saveState').lastChild.textContent = ' Online gespeichert';
    },
    setStatus: message => { $('#saveState').lastChild.textContent = ` ${message}`; }
  };
  $('#resetButton').addEventListener('click', async () => {
    if (!confirm('Turnier und alle Ergebnisse wirklich zurücksetzen?')) return;
    if (state.liveId) {
      try { await window.plannerLive.revoke(); }
      catch { alert('Die Live-Freigabe konnte nicht beendet werden. Prüfe die Internetverbindung und versuche es erneut.'); return; }
    }
    state = { ...structuredClone(defaults), date: today }; resetRoundTimer(); hydrateForm();
    renderOutputs(); showTab('setup'); saveState();
  });

  hydrateForm(); renderOutputs(); saveState(false); registerWebMcp();
})();

