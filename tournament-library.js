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
    card.append(info, open);
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
      card.append(resolve);
    }
    list.append(card);
  }
}

function schedule(id) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => { timers.delete(id); void syncOne(id); }, 600));
}

async function syncOne(id) {
  const item = store.list().find(entry => entry.id === id);
  if (!item?.dirty || !currentUser || writing.has(id) || conflicts.has(id)) return;
  if (remoteVersions.has(id) && remoteVersions.get(id) !== item.remoteVersion) {
    conflicts.add(id); render();
    setMessage('Ein Turnier wurde auf einem anderen Gerät geändert. Deine lokale Version bleibt erhalten; bitte prüfe den Konflikt.', true);
    return;
  }
  const state = store.localState(id);
  if (!state) return;
  writing.add(id);
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
    writing.delete(id); render();
    const latest = store.list().find(entry => entry.id === id);
    if (latest?.dirty && !conflicts.has(id) && latest.changeSeq !== item.changeSeq) schedule(id);
  }
}

function subscribe() {
  unsubscribe?.(); remoteVersions = new Map(); remoteStates = new Map(); conflicts.clear();
  if (!currentUser) { render(); return; }
  const collection = firestore.collection(database, 'organizers', currentUser.uid, 'tournaments');
  unsubscribe = firestore.onSnapshot(collection, snapshot => {
    for (const document of snapshot.docs) {
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

