const config = window.FIREBASE_CONFIG;
const organizer = document.querySelector('#liveShareButton');
const viewer = document.querySelector('#liveViewer');

function showStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.remove('is-hidden');
  element.classList.toggle('is-error', isError);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function validScore(value) {
  return value !== '' && value != null && Number.isFinite(Number(value));
}

function addMinutes(time, minutes) {
  const [hours, minute] = String(time || '00:00').split(':').map(Number);
  const date = new Date(2000, 0, 1, hours, minute + minutes);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function liveUrl(id) {
  const url = new URL('live.html', location.href);
  url.search = new URLSearchParams({ id }).toString();
  return url.href;
}

async function start() {
  if (!config?.apiKey || !config?.projectId || !config?.appId) {
    const message = 'Firebase ist noch nicht eingerichtet. Die Turnierleitung kann das Live-Teilen nach der Einrichtung nutzen.';
    if (organizer) {
      organizer.addEventListener('click', () => {
        document.querySelector('#liveShareDialog').showModal();
        showStatus(document.querySelector('#liveShareStatus'), message, true);
      });
      document.querySelector('#liveShareClose').addEventListener('click', () =>
        document.querySelector('#liveShareDialog').close());
    }
    if (viewer) showStatus(document.querySelector('#liveViewerStatus'), message, true);
    return;
  }

  const version = '12.19.0';
  const [{ initializeApp }, firestore] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
  ]);
  const app = initializeApp(config);
  const db = firestore.getFirestore(app);

  if (viewer) {
    const id = new URLSearchParams(location.search).get('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      showStatus(document.querySelector('#liveViewerStatus'), 'Dieser Turnierlink ist ungültig.', true);
      return;
    }
    function unavailable(message) {
      document.querySelector('#liveSummary').classList.add('is-hidden');
      document.querySelector('#liveScheduleSection').classList.add('is-hidden');
      document.querySelector('#liveStandingsSection').classList.add('is-hidden');
      showStatus(document.querySelector('#liveViewerStatus'), message, true);
    }
    firestore.onSnapshot(firestore.doc(db, 'tournaments', id), snapshot => {
      if (!snapshot.exists() || snapshot.data().published !== true) {
        unavailable('Dieses Turnier ist nicht verfügbar.');
        return;
      }
      renderViewer(snapshot.data().data);
    }, error => unavailable(error.code === 'permission-denied'
      ? 'Dieses Turnier ist nicht verfügbar.'
      : 'Live-Daten konnten nicht geladen werden. Prüfe die Internetverbindung und lade die Seite erneut.'));
  }

  if (organizer) {
    const authApi = await import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`);
    startOrganizer(authApi, firestore, app, db);
  }
}

function startOrganizer(authApi, firestore, app, db) {
  const auth = authApi.getAuth(app);
  const dialog = document.querySelector('#liveShareDialog');
  const status = document.querySelector('#liveShareStatus');
  const signIn = document.querySelector('#liveSignIn');
  const publish = document.querySelector('#livePublish');
  const result = document.querySelector('#liveShareResult');
  let user = null;
  let syncDirty = false;
  let syncing = false;
  let syncTimer = null;
  let shownQrUrl = null;

  function showLink(id) {
    const url = liveUrl(id);
    document.querySelector('#liveLink').value = url;
    document.querySelector('#liveOpen').href = url;
    result.classList.remove('is-hidden');
    const qr = document.querySelector('#liveQr');
    if (shownQrUrl === url) return;
    shownQrUrl = url;
    qr.replaceChildren();
    if (window.QRCode) new window.QRCode(qr, { text: url, width: 200, height: 200 });
    else qr.textContent = 'QR-Code konnte nicht geladen werden. Der Link kann weiterhin kopiert werden.';
  }

  function refresh() {
    const id = window.plannerLive.getId();
    signIn.classList.toggle('is-hidden', !!user);
    publish.classList.toggle('is-hidden', !user || !!id || !window.plannerLive.hasSchedule());
    result.classList.toggle('is-hidden', !id);
    if (id) showLink(id);
    if (!user && id) showStatus(status, 'Zum Aktualisieren der Live-Ergebnisse bitte mit Google anmelden.');
    else if (user && id) showStatus(status, 'Live-Link aktiv. Neue Ergebnisse werden automatisch übertragen.');
    else if (user) showStatus(status, 'Bereit zum Veröffentlichen.');
  }

  async function flush() {
    if (syncing || !syncDirty || !user || !window.plannerLive.getId() || !window.plannerLive.hasSchedule()) return;
    syncing = true;
    syncDirty = false;
    try {
      await firestore.updateDoc(firestore.doc(db, 'tournaments', window.plannerLive.getId()), {
        data: window.plannerLive.getData(), updatedAt: firestore.serverTimestamp()
      });
      showStatus(status, 'Live-Ergebnisse sind aktuell.');
    } catch (error) {
      showStatus(status, 'Übertragung fehlgeschlagen. Prüfe die Verbindung und deine Berechtigung.', true);
    } finally {
      syncing = false;
      if (syncDirty) scheduleSync();
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, 500);
  }

  async function revoke() {
    const id = window.plannerLive.getId();
    if (!id) return;
    if (!user) throw new Error('Anmeldung erforderlich');
    await firestore.updateDoc(firestore.doc(db, 'tournaments', id), {
      published: false, updatedAt: firestore.serverTimestamp()
    });
    window.plannerLive.setId(null);
    shownQrUrl = null;
    result.classList.add('is-hidden');
    refresh();
    showStatus(status, 'Live-Freigabe beendet. Der bisherige Link ist nicht mehr abrufbar.');
  }
  window.plannerLive.revoke = revoke;

  authApi.onAuthStateChanged(auth, currentUser => {
    user = currentUser;
    refresh();
    if (user && window.plannerLive.getId()) {
      syncDirty = true;
      scheduleSync();
    }
  });

  document.querySelector('#liveShareButton').addEventListener('click', () => {
    dialog.showModal();
    refresh();
    if (!window.plannerLive.hasSchedule())
      showStatus(status, 'Erstelle zuerst einen Spielplan. Danach kannst du ihn live teilen.', true);
  });
  document.querySelector('#liveShareClose').addEventListener('click', () => dialog.close());
  signIn.addEventListener('click', async () => {
    try {
      const provider = new authApi.GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: 'benedikth14@gmail.com' });
      await authApi.signInWithPopup(auth, provider);
    } catch (error) {
      showStatus(status, 'Anmeldung fehlgeschlagen. Prüfe, ob Google-Anmeldung und die Website-Domain in Firebase aktiviert sind.', true);
    }
  });
  publish.addEventListener('click', async () => {
    if (!user || !window.plannerLive.hasSchedule()) return;
    publish.disabled = true;
    try {
      const id = crypto.randomUUID();
      await firestore.setDoc(firestore.doc(db, 'tournaments', id), {
        ownerUid: user.uid, published: true, data: window.plannerLive.getData(),
        updatedAt: firestore.serverTimestamp()
      });
      window.plannerLive.setId(id);
      showLink(id);
      refresh();
      showStatus(status, 'Live-Link erstellt. Ergebnisse werden jetzt automatisch übertragen.');
    } catch (error) {
      showStatus(status, 'Veröffentlichen fehlgeschlagen. Prüfe die Firestore-Regeln und deine Berechtigung.', true);
    } finally {
      publish.disabled = false;
    }
  });
  document.querySelector('#liveCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector('#liveLink').value);
      showStatus(status, 'Link kopiert.');
    } catch {
      document.querySelector('#liveLink').select();
      showStatus(status, 'Bitte den markierten Link kopieren.');
    }
  });
  document.querySelector('#liveQrDownload').addEventListener('click', () => {
    const canvas = document.querySelector('#liveQr canvas');
    const image = document.querySelector('#liveQr img');
    const source = canvas?.toDataURL('image/png') || image?.src;
    if (!source) return showStatus(status, 'QR-Code konnte nicht geladen werden.', true);
    const link = document.createElement('a');
    link.href = source; link.download = 'turnier-qr-code.png'; link.click();
  });
  document.querySelector('#liveStop').addEventListener('click', async () => {
    if (!confirm('Live-Freigabe beenden? Der bisherige Link und QR-Code funktionieren danach nicht mehr.')) return;
    try { await revoke(); }
    catch { showStatus(status, 'Freigabe konnte nicht beendet werden. Prüfe die Internetverbindung.', true); }
  });
  window.addEventListener('planner-state-changed', () => {
    refresh();
    if (window.plannerLive.getId()) {
      syncDirty = true;
      scheduleSync();
    }
  });
}

function calculateRows(data) {
  const rows = Object.fromEntries((data.teams || []).map(name => [name, {
    name, played: 0, wins: 0, losses: 0, for: 0, against: 0
  }]));
  for (const match of data.matches || []) {
    if (!validScore(match.scoreA) || !validScore(match.scoreB)) continue;
    const a = Number(match.scoreA), b = Number(match.scoreB);
    if (a === b) continue;
    const sides = data.mode === 'partnerMix'
      ? [[match.playersA || [], a, b], [match.playersB || [], b, a]]
      : [[[match.teamA], a, b], [[match.teamB], b, a]];
    for (const [names, own, other] of sides) for (const name of names) {
      const row = rows[name];
      if (!row) continue;
      row.played++; row.for += own; row.against += other;
      if (own > other) row.wins++; else row.losses++;
    }
  }
  return Object.values(rows).sort((a, b) =>
    b.wins - a.wins || (b.for - b.against) - (a.for - a.against) ||
    b.for - a.for || a.name.localeCompare(b.name, 'de'));
}

function renderViewer(data) {
  if (!data || !Array.isArray(data.matches) || !Array.isArray(data.teams)) return;
  document.title = `${data.name || 'Turnier'} – Live-Ergebnisse`;
  document.querySelector('#liveTitle').textContent = data.name || 'Turnier';
  document.querySelector('#liveMeta').textContent =
    `${data.date || ''} · ${data.format === 'singles' ? 'Einzel' : 'Doppel'} · ${data.courts || 1} Plätze`;
  showStatus(document.querySelector('#liveViewerStatus'), 'Live verbunden · Ergebnisse aktualisieren sich automatisch');
  const matches = data.matches;
  const completed = matches.filter(m => validScore(m.scoreA) && validScore(m.scoreB)).length;
  document.querySelector('#liveSummary').innerHTML = [
    ['Teilnehmer', data.teams.length], ['Spiele', `${completed} / ${matches.length}`],
    ['Plätze', data.courts], ['Rundendauer', `${data.duration} Min.`]
  ].map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  document.querySelector('#liveSummary').classList.remove('is-hidden');
  const bySlot = new Map();
  for (const match of matches) bySlot.set(match.slot, [...(bySlot.get(match.slot) || []), match]);
  document.querySelector('#liveSchedule').innerHTML = [...bySlot.entries()].map(([slot, group]) => {
    const time = addMinutes(data.startTime, slot * (data.duration + data.breakDuration));
    return `<article class="round-block"><header class="round-header"><h3>${escapeHtml(group[0].roundLabel || `Runde ${slot + 1}`)}</h3><span>${time} Uhr · ${escapeHtml(data.duration)} Min.</span></header>
      ${group.map(match => `<div class="match-row"><span class="court-badge">Platz ${escapeHtml(match.court)}</span>
        <span class="team-name right">${escapeHtml(match.teamA)}</span><span class="versus">VS</span>
        <span class="team-name">${escapeHtml(match.teamB)}</span>
        <strong class="live-score">${validScore(match.scoreA) && validScore(match.scoreB)
          ? `${escapeHtml(match.scoreA)} : ${escapeHtml(match.scoreB)}` : '– : –'}</strong></div>`).join('')}
      </article>`;
  }).join('');
  document.querySelector('#liveScheduleSection').classList.remove('is-hidden');
  document.querySelector('#liveStandings').innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Rang</th><th>${data.format === 'singles' || data.mode === 'partnerMix' ? 'Spieler' : 'Team'}</th><th>Sp.</th><th>Siege</th><th>Nied.</th><th>Punkte</th><th>Diff.</th></tr></thead>
    <tbody>${calculateRows(data).map((row, index) => `<tr><td class="rank">${index + 1}</td><td class="team-cell">${escapeHtml(row.name)}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.for}:${row.against}</td><td>${row.for - row.against}</td></tr>`).join('')}</tbody>
    </table></div>`;
  document.querySelector('#liveStandingsSection').classList.remove('is-hidden');
}

start().catch(() => {
  const element = organizer ? document.querySelector('#liveShareStatus') : document.querySelector('#liveViewerStatus');
  if (element) showStatus(element, 'Firebase konnte nicht geladen werden. Prüfe die Internetverbindung.', true);
  if (organizer) {
    organizer.addEventListener('click', () =>
      document.querySelector('#liveShareDialog').showModal());
    document.querySelector('#liveShareClose').addEventListener('click', () =>
      document.querySelector('#liveShareDialog').close());
  }
});

