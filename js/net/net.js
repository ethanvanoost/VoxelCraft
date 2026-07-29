/**
 * Networking layer — Firebase Realtime Database.
 *
 * Handles: global username claiming, server listing/creation, and live
 * multiplayer sessions (player presence + positions, block edits, chests,
 * chat). Loads the Firebase SDK from its CDN only when a config is present,
 * so the game works fully offline without it.
 */

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

export class Net {
  constructor() {
    this.ready = false;
    this.uid = null;
    this.db = null;
    this._fns = null;   // firebase database functions
  }

  get available() { return !!firebaseConfig; }

  /** Connect + anonymous sign-in. Safe to call repeatedly. */
  async init() {
    if (!this.available) return false;
    if (this.ready) return true;
    try {
      const [{ initializeApp }, authMod, dbMod] = await Promise.all([
        import(`${SDK}/firebase-app.js`),
        import(`${SDK}/firebase-auth.js`),
        import(`${SDK}/firebase-database.js`),
      ]);
      const app = initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);
      const cred = await authMod.signInAnonymously(auth);
      this.uid = cred.user.uid;
      this.db = dbMod.getDatabase(app);
      this._fns = dbMod;
      this.ready = true;
      return true;
    } catch (err) {
      console.warn('Firebase init failed:', err);
      return false;
    }
  }

  _ref(path) { return this._fns.ref(this.db, path); }

  // ---------------- Usernames ----------------

  /**
   * Try to claim a username globally. Returns 'ok' | 'taken' | 'offline'.
   * A name can be re-claimed by the same browser (same anonymous uid).
   */
  async claimUsername(name) {
    if (!(await this.init())) return 'offline';
    const key = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const { runTransaction } = this._fns;
    try {
      const result = await runTransaction(this._ref(`usernames/${key}`), (cur) => {
        if (cur === null) return { uid: this.uid, name, created: Date.now() };
        if (cur.uid === this.uid) return cur;   // already mine
        return;                                  // abort: taken by someone else
      });
      return result.committed ? 'ok' : 'taken';
    } catch (err) {
      console.warn('claimUsername failed:', err);
      return 'offline';
    }
  }

  // ---------------- Servers ----------------

  async listServers() {
    if (!(await this.init())) return null;
    const { get, child } = this._fns;
    const snap = await get(this._ref('servers'));
    const out = [];
    snap.forEach((s) => {
      const v = s.val();
      out.push({ id: s.key, name: v.name, mode: v.mode, cheats: !!v.cheats,
                 creator: v.creator, creatorName: v.creatorName, seed: v.seed });
    });
    return out.reverse();
  }

  async createServer({ name, mode, cheats, username }) {
    if (!(await this.init())) return null;
    try {
      const { push, set } = this._fns;
      const seed = Math.floor(Math.random() * 2 ** 31);
      const r = push(this._ref('servers'));
      await set(r, {
        name, mode, cheats: !!cheats, seed,
        creator: this.uid, creatorName: username, created: Date.now(),
      });
      return r.key;
    } catch (err) {
      console.warn('createServer failed:', err);
      return null;
    }
  }

  // ---------------- Live session ----------------

  /**
   * Join a server. callbacks: onPlayer(uid, data|null), onEdit(posKey, id),
   * onChest(posKey, slots|null), onChat({name, text}).
   * Returns a session with sendState/sendEdit/setChest/sendChat/leave.
   */
  async joinServer(serverId, callbacks) {
    if (!(await this.init())) return null;
    const f = this._fns;
    const base = `servers/${serverId}`;
    const myRef = this._ref(`${base}/players/${this.uid}`);
    f.onDisconnect(myRef).remove();

    const unsubs = [];
    unsubs.push(f.onValue(this._ref(`${base}/players`), (snap) => {
      const seen = new Set();
      snap.forEach((s) => {
        seen.add(s.key);
        if (s.key !== this.uid) callbacks.onPlayer(s.key, s.val());
      });
      callbacks.onPlayersSweep?.(seen);
    }));
    unsubs.push(f.onChildAdded(this._ref(`${base}/edits`), (s) =>
      callbacks.onEdit(s.key, s.val())));
    unsubs.push(f.onChildChanged(this._ref(`${base}/edits`), (s) =>
      callbacks.onEdit(s.key, s.val())));
    unsubs.push(f.onValue(this._ref(`${base}/chests`), (snap) => {
      const all = {};
      snap.forEach((s) => { all[s.key] = s.val(); });
      callbacks.onChests(all);
    }));
    unsubs.push(f.onValue(this._ref(`${base}/furnaces`), (snap) => {
      const all = {};
      snap.forEach((s) => { all[s.key] = s.val(); });
      callbacks.onFurnaces?.(all);
    }));
    // Chat: show live messages; delete anything older than 5 minutes
    // (rules allow removing only expired messages, so any client can clean up)
    const CHAT_TTL = 5 * 60 * 1000;
    const joinTs = Date.now();
    unsubs.push(f.onChildAdded(this._ref(`${base}/chat`), (s) => {
      const m = s.val();
      if (!m) return;
      if (m.ts < Date.now() - CHAT_TTL) {
        f.remove(s.ref).catch(() => {});
      } else if (m.ts >= joinTs - 5000) {
        callbacks.onChat(m);
      }
    }));
    const chatSweep = setInterval(async () => {
      try {
        const snap = await f.get(this._ref(`${base}/chat`));
        snap.forEach((s) => {
          const m = s.val();
          if (m && m.ts < Date.now() - CHAT_TTL) f.remove(s.ref).catch(() => {});
        });
      } catch { /* offline blip — retry next sweep */ }
    }, 60 * 1000);

    const net = this;
    return {
      uid: this.uid,
      sendState(state) { f.set(myRef, state).catch(() => {}); },
      sendEdit(posKey, id) { f.set(net._ref(`${base}/edits/${posKey}`), id).catch(() => {}); },
      setChest(posKey, slots) {
        f.set(net._ref(`${base}/chests/${posKey}`), slots ?? null).catch(() => {});
      },
      setFurnace(posKey, state) {
        f.set(net._ref(`${base}/furnaces/${posKey}`), state ?? null).catch(() => {});
      },
      sendChat(name, text) {
        f.push(net._ref(`${base}/chat`), { name, text: String(text).slice(0, 200), ts: Date.now() })
          .catch(() => {});
      },
      leave() {
        clearInterval(chatSweep);
        unsubs.forEach((u) => u());
        f.remove(myRef).catch(() => {});
      },
    };
  }
}
