const store = window.plannerStore;
const dialog = document.querySelector('#tournamentLibraryDialog');
const list = document.querySelector('#tournamentLibraryList');
const status = document.querySelector('#tournamentLibraryStatus');
const signInButton = document.querySelector('#tournamentSignIn');
const allowedEmail = 'benedikth14@gmail.com';
let currentUser = null;
let firestore = null;
let database = null;
let authApi = null;
let auth = null;
let unsubscribe = null;
let remoteVersions = new Map();
let remoteStates = new Map();
const timers = new Map();
const writing = new Set();
const pendingWrites = new Map();
const deleting = new Set();
const deletedIds = new Set();
const conflicts = new Set();

function setMessage(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function render() {
  signInButton.classList.toggle('is-hidden', !!currentUser);
  list.replaceChildren();
  const items = store.list().sort((a, b) => b.updatedAt - a.updatedAt);
  for (const item of items) {
    const card = document.createElement('article');
    card.className = `tournament-item${item.id === store.activeId() ? ' is-current' : ''}`;
    const info = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = item.name || 'Neues Turnier';
    const meta = document.createElement('span');
    meta.textContent = `${item.date || 'Ohne Datum'} · ${item.hasSchedule ? 'Spielplan vorhanden' : 'Entwurf'} · ${conflicts.has(item.id) ? 'Speicherkonflikt' : item.dirty ? 'Nur lokal gespeichert' : item.remoteVersion ? 'Online gespeichert' : 'Noch nicht online'}`;
    info.append(title, meta);
    const open = document.createElement('button');
    open.className = 'button button-ghost'; open.type = 'button';
    open.textContent = item.id === store.activeId() ? 'Geöffnet' : 'Öffnen';
    open.disabled = item.id === store.activeId();
    open.addEventListener('click', () => { store.open(item.id); dialog.close(); render(); });
    const actions = document.createElement('div'); actions.className = 'tournament-actions';
    actions.append(open); card.append(info, actions);
    const remove = document.createElement('button');
    remove.className = 'button button-danger'; remove.type = 'button';
    remove.textContent = deleting.has(item.id) ? 'Wird gelöscht …' : 'Löschen';
    remove.setAttribute('aria-label', `Turnier ${item.name || 'ohne Namen'} löschen`);
    remove.disabled = deleting.has(item.id);
    remove.addEventListener('click', () => { void deleteTournament(item.id); });
    actions.append(remove);
    if (conflicts.has(item.id) && remoteStates.has(item.id)) {
      const resolve = document.createElement('button');
      resolve.className = 'button button-ghost'; resolve.type = 'button';
      resolve.textContent = 'Lokale Kopie behalten, Online-Version laden';
      resolve.addEventListener('click', () => {
        const copyId = store.duplicateLocal(item.id);
        const remote = remoteStates.get(item.id);
        store.importRemote(item.id, remote.state, remote.version, true);
        conflicts.delete(item.id);
        if (copyId && currentUser) schedule(copyId);
        setMessage('Die lokale Version wurde als eigenes Turnier behalten. Die Online-Version ist wieder geöffnet.');
        render();
      });
      actions.append(resolve);
    }
    list.append(card);
  }
}

function schedule(id) {
  if (deleting.has(id)) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { timers.delete(id); void syncOne(id); }, 600));
}

async function syncOne(id) {
  const item = store.list().find(entry => entry.id === id);
  if (!item?.dirty || !currentUser || writing.has(id) || conflicts.has(id) || deleting.has(id)) return;
  if (remoteVersions.has(id) && remoteVersions.get(id) !== item.remoteVersion) {
    conflicts.add(id); render();
    setMessage('Ein Turnier wurde auf einem anderen Gerät geändert. Deine lokale Version bleibt erhalten; bitte prüfe den Konflikt.', true);
    return;
  }
  const state = store.localState(id);
  if (!state) return;
  writing.add(id);
  let writeFinished;
  pendingWrites.set(id, new Promise(resolve => { writeFinished = resolve; }));
  try {
    const reference = firestore.doc(database, 'organizers', currentUser.uid, 'tournaments', id);
    const version = await firestore.runTransaction(database, async transaction => {
      const snapshot = await transaction.get(reference);
      const previous = snapshot.exists() ? snapshot.data().version : 0;
      if (previous !== item.remoteVersion) throw new Error('conflict');
      const next = previous + 1;
      transaction.set(reference, {
        ownerUid: currentUser.uid, version: next, state,
        updatedAt: firestore.serverTimestamp()
      });
      return next;
    });
    remoteVersions.set(id, version);
    store.markSynced(id, version, item.changeSeq);
    setMessage('Deine Turniere sind online gespeichert.');
  } catch (error) {
    if (error.message === 'conflict') {
      conflicts.add(id);
      setMessage('Speicherkonflikt: Auf einem anderen Gerät liegt eine neuere Version. Deine lokale Version bleibt erhalten.', true);
    } else {
      store.setStatus('Nur lokal gespeichert · Verbindung prüfen');
      setMessage('Online-Speicherung fehlgeschlagen. Deine Änderungen bleiben in diesem Browser erhalten.', true);
    }
  } finally {
    writing.delete(id); pendingWrites.delete(id); writeFinished(); render();
    const latest = store.list().find(entry => entry.id === id);
    if (latest?.dirty && !conflicts.has(id) && !deleting.has(id) && latest.changeSeq !== item.changeSeq) schedule(id);
  }
}

async function deleteTournament(id) {
  const item = store.list().find(entry => entry.id === id);
  if (!item || deleting.has(id)) return;
  const local = store.localState(id);
  const live = !!local?.liveId;
  const message = `„${item.name || 'Dieses Turnier'}“ dauerhaft löschen? Spielplan und Ergebnisse werden entfernt.${live ? ' Der Live-Link und QR-Code funktionieren danach nicht mehr.' : ''}`;
  if (!confirm(message)) return;
  if (conflicts.has(id)) {
    setMessage('Dieses Turnier hat einen Speicherkonflikt. Bitte zuerst die lokale Kopie behalten und die Online-Version laden.', true);
    return;
  }
  if (!currentUser && (item.remoteVersion || live)) {
    setMessage('Zum Löschen dieses online gespeicherten oder live geteilten Turniers bitte zuerst mit Google anmelden.', true);
    return;
  }
  deleting.add(id); clearTimeout(timers.get(id)); timers.delete(id); render();
  try {
    await pendingWrites.get(id);
    const latest = store.list().find(entry => entry.id === id);
    const latestLiveId = store.localState(id)?.liveId;
    if (currentUser) {
      const privateRef = firestore.doc(database, 'organizers', currentUser.uid, 'tournaments', id);
      const publicRef = latestLiveId ? firestore.doc(database, 'tournaments', latestLiveId) : null;
      await firestore.runTransaction(database, async transaction => {
        const saved = await transaction.get(privateRef);
        const published = publicRef ? await transaction.get(publicRef) : null;
        if (saved.exists() && saved.data().version !== latest.remoteVersion) throw new Error('conflict');
        if (!saved.exists() && latest.remoteVersion) throw new Error('conflict');
        if (published?.exists() && published.data().ownerUid !== currentUser.uid) throw new Error('owner');
        if (published?.exists()) transaction.delete(publicRef);
        if (saved.exists()) transaction.delete(privateRef);
      });
    }
    deletedIds.add(id);
    remoteVersions.delete(id); remoteStates.delete(id); conflicts.delete(id);
    store.removeLocal(id);
    setMessage('Turnier gelöscht. Falls es live geteilt war, ist auch der Teilnehmer-Link beendet.');
  } catch (error) {
    if (error.message === 'conflict') conflicts.add(id);
    setMessage(error.message === 'conflict'
      ? 'Das Turnier wurde anderswo geändert. Es wurde nicht gelöscht; bitte den Konflikt zuerst prüfen.'
      : 'Turnier konnte nicht gelöscht werden. Prüfe die Verbindung und versuche es erneut.', true);
  } finally {
    deleting.delete(id); render();
  }
}

function subscribe() {
  unsubscribe?.(); remoteVersions = new Map(); remoteStates = new Map(); conflicts.clear();
  if (!currentUser) { render(); return; }
  const collection = firestore.collection(database, 'organizers', currentUser.uid, 'tournaments');
  unsubscribe = firestore.onSnapshot(collection, snapshot => {
    const presentIds = new Set(snapshot.docs.map(document => document.id));
    for (const id of deletedIds) if (!presentIds.has(id)) deletedIds.delete(id);
    for (const document of snapshot.docs) {
      if (deletedIds.has(document.id)) continue;
      const remote = document.data();
      remoteStates.set(document.id, { state: remote.state, version: remote.version });
      const local = store.list().find(item => item.id === document.id);
      remoteVersions.set(document.id, remote.version);
      if (writing.has(document.id)) continue;
      if (local?.dirty && remote.version > local.remoteVersion) {
        conflicts.add(document.id);
        continue;
      }
      store.importRemote(document.id, remote.state, remote.version);
    }
    for (const item of store.list()) if (item.dirty && !conflicts.has(item.id)) schedule(item.id);
    if (conflicts.size) setMessage('Ein Turnier wurde auf einem anderen Gerät geändert. Deine lokale Version bleibt erhalten.', true);
    else setMessage('Deine Turniere sind online verfügbar.');
    render();
  }, () => setMessage('Turniere konnten nicht geladen werden. Prüfe die Internetverbindung und die Firebase-Regeln.', true));
}

document.querySelector('#tournamentLibraryButton').addEventListener('click', () => {
  render(); dialog.showModal();
});
document.querySelector('#tournamentLibraryClose').addEventListener('click', () => dialog.close());
document.querySelector('#tournamentNew').addEventListener('click', () => {
  store.create(); render(); dialog.close();
  if (currentUser) schedule(store.activeId());
});
window.addEventListener('planner-state-changed', event => {
  if (currentUser) schedule(event.detail.tournamentId);
  else store.setStatus('Lokal gespeichert · für Online-Speicherung anmelden');
  render();
});
window.addEventListener('online', () => {
  if (currentUser) for (const item of store.list()) if (item.dirty) schedule(item.id);
});

async function start() {
  render();
  if (!window.FIREBASE_CONFIG?.appId) throw new Error('Firebase-Konfiguration fehlt');
  const version = '12.19.0';
  const [{ initializeApp, getApps, getApp }, firestoreApi, authentication] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`)
  ]);
  firestore = firestoreApi; authApi = authentication;
  const app = getApps().length ? getApp() : initializeApp(window.FIREBASE_CONFIG);
  database = firestore.getFirestore(app); auth = authApi.getAuth(app);
  signInButton.addEventListener('click', async () => {
    try {
      const provider = new authApi.GoogleAuthProvider();
      provider.setCustomParameters({ login_hint: allowedEmail });
      await authApi.signInWithPopup(auth, provider);
    } catch { setMessage('Google-Anmeldung fehlgeschlagen. Bitte versuche es erneut.', true); }
  });
  authApi.onAuthStateChanged(auth, user => {
    if (user && user.email?.toLowerCase() !== allowedEmail) {
      currentUser = null;
      subscribe();
      setMessage(`Dieses Google-Konto darf keine Turniere speichern. Bitte mit ${allowedEmail} anmelden.`, true);
    } else {
      currentUser = user;
      subscribe();
      setMessage(user ? 'Turniere werden geladen …' : 'Zum Speichern auf mehreren Geräten bitte mit Google anmelden.');
    }
    render();
  });
}

start().catch(() => {
  setMessage('Firebase konnte nicht geladen werden. Die Turniere bleiben in diesem Browser gespeichert.', true);
  signInButton.disabled = true;
});

