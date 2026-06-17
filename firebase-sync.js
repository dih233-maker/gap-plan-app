import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  initializeAuth,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

const STORAGE_KEY = 'gap90_v4';
const PUSH_DEBOUNCE_MS = 1500;

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let unsubSnapshot = null;
let pushTimer = null;
let lastPushedAt = '';
let applyingRemote = false;
let callbacks = {};

const status = {
  configured: false,
  signedIn: false,
  email: '',
  cloudUpdatedAt: '',
  syncing: false,
  error: '',
};

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function isIosStandalone() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    && (window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches);
}

function formatAuthError(err) {
  const code = err?.code || '';
  const map = {
    'auth/popup-blocked': '弹窗被拦截，请允许此网站弹窗，或改用 Safari 打开',
    'auth/popup-closed-by-user': '登录窗口已关闭',
    'auth/unauthorized-domain': '域名未授权，请在 Firebase 控制台添加 gap-plan-app.vercel.app',
    'auth/operation-not-supported-in-this-environment': '当前环境不支持，请用 Safari 浏览器打开（不要从主屏幕图标）',
    'auth/network-request-failed': '网络错误，请检查网络或关闭 VPN 后重试',
    'permission-denied': 'Firestore 权限不足，请检查是否已发布安全规则',
  };
  return map[code] || err?.message || '登录失败';
}

function initAuth(firebaseApp) {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (err) {
    if (err?.code === 'auth/already-initialized') return getAuth(firebaseApp);
    throw err;
  }
}

function userDocRef(uid) {
  return doc(db, 'users', uid);
}

function updateStatus(patch) {
  Object.assign(status, patch);
  callbacks.onStatusChange?.(status);
}

function getLocalRaw() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function localUpdatedAt(data) {
  return data?._updatedAt || '';
}

async function pushToCloud(data, force = false) {
  if (!currentUser || !db || applyingRemote) return;
  const payload = data || getLocalRaw();
  if (!payload) return;
  const stamp = localUpdatedAt(payload);
  if (!force && stamp && stamp === lastPushedAt) return;

  updateStatus({ syncing: true, error: '' });
  try {
    await setDoc(userDocRef(currentUser.uid), {
      gap90_v4: payload,
      _updatedAt: stamp || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    lastPushedAt = stamp;
    updateStatus({ syncing: false, cloudUpdatedAt: stamp || status.cloudUpdatedAt });
  } catch (err) {
    updateStatus({ syncing: false, error: err.message || '上传失败' });
    callbacks.toast?.('云端上传失败');
    console.error(err);
  }
}

function schedulePush(data) {
  if (!currentUser || !db) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushToCloud(data), PUSH_DEBOUNCE_MS);
}

function applyRemoteData(remotePayload, remoteStamp) {
  if (!remotePayload) return;
  applyingRemote = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remotePayload));
    lastPushedAt = remoteStamp || localUpdatedAt(remotePayload);
    updateStatus({ cloudUpdatedAt: remoteStamp || localUpdatedAt(remotePayload) });
    callbacks.onRemoteUpdate?.();
  } finally {
    applyingRemote = false;
  }
}

async function mergeOnLogin() {
  const local = getLocalRaw();
  const localStamp = localUpdatedAt(local);
  const snap = await getDoc(userDocRef(currentUser.uid));

  if (!snap.exists()) {
    if (local) await pushToCloud(local, true);
    return;
  }

  const cloud = snap.data();
  const remote = cloud.gap90_v4;
  const remoteStamp = cloud._updatedAt || localUpdatedAt(remote);

  if (!remote) {
    if (local) await pushToCloud(local, true);
    return;
  }

  if (!local || !localStamp) {
    applyRemoteData(remote, remoteStamp);
    callbacks.toast?.('已从云端恢复数据');
    return;
  }

  if (remoteStamp > localStamp) {
    applyRemoteData(remote, remoteStamp);
    callbacks.toast?.('云端较新，已同步到本机');
    return;
  }

  if (localStamp > remoteStamp) {
    await pushToCloud(local, true);
    callbacks.toast?.('本机较新，已上传到云端');
    return;
  }
}

function startSnapshot() {
  if (unsubSnapshot) unsubSnapshot();
  unsubSnapshot = onSnapshot(userDocRef(currentUser.uid), (snap) => {
    if (!snap.exists()) return;
    const cloud = snap.data();
    const remote = cloud.gap90_v4;
    const remoteStamp = cloud._updatedAt || localUpdatedAt(remote);
    if (!remote) return;

    updateStatus({ cloudUpdatedAt: remoteStamp });

    const local = getLocalRaw();
    const localStamp = localUpdatedAt(local);
    if (remoteStamp > localStamp) {
      applyRemoteData(remote, remoteStamp);
      callbacks.toast?.('检测到其他设备更新');
    }
  }, (err) => {
    updateStatus({ error: err.message || '监听失败' });
    console.error(err);
  });
}

async function signIn() {
  if (!auth) {
    callbacks.toast?.('请先配置 firebase-config.js');
    return;
  }

  if (isIosStandalone()) {
    const msg = 'iPhone 主屏幕 App 内无法完成 Google 登录。请 Safari 地址栏打开 gap-plan-app.vercel.app#sync 登录。';
    updateStatus({ error: msg });
    callbacks.toast?.('请用 Safari 浏览器打开登录');
    return;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    if (isMobile()) {
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  } catch (err) {
    updateStatus({ error: formatAuthError(err) });
    callbacks.toast?.(formatAuthError(err));
    console.error(err);
  }
}

async function signOut() {
  if (!auth) return;
  clearTimeout(pushTimer);
  if (unsubSnapshot) {
    unsubSnapshot();
    unsubSnapshot = null;
  }
  await firebaseSignOut(auth);
  callbacks.toast?.('已退出云同步');
}

async function pullNow() {
  if (!currentUser || !db) {
    callbacks.toast?.('请先 Google 登录');
    return;
  }
  updateStatus({ syncing: true, error: '' });
  try {
    const snap = await getDoc(userDocRef(currentUser.uid));
    if (!snap.exists() || !snap.data().gap90_v4) {
      callbacks.toast?.('云端暂无数据');
      updateStatus({ syncing: false });
      return;
    }
    const cloud = snap.data();
    applyRemoteData(cloud.gap90_v4, cloud._updatedAt);
    callbacks.toast?.('已从云端拉取');
    updateStatus({ syncing: false });
  } catch (err) {
    updateStatus({ syncing: false, error: err.message || '拉取失败' });
    callbacks.toast?.('拉取失败');
    console.error(err);
  }
}

async function pushNow() {
  if (!currentUser || !db) {
    callbacks.toast?.('请先 Google 登录');
    return;
  }
  await pushToCloud(getLocalRaw(), true);
  callbacks.toast?.('已上传到云端');
}

function init(options = {}) {
  callbacks = options;

  if (!isFirebaseConfigured()) {
    updateStatus({
      configured: false,
      signedIn: false,
      error: '未配置 firebase-config.js',
    });
    return;
  }

  app = initializeApp(firebaseConfig);
  auth = initAuth(app);
  db = getFirestore(app);
  updateStatus({
    configured: true,
    syncing: true,
    error: isIosStandalone() ? 'iPhone 主屏幕内请改用 Safari 登录' : '',
  });

  (async () => {
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        currentUser = result.user;
        updateStatus({ signedIn: true, email: result.user.email || result.user.uid });
        callbacks.toast?.('登录成功');
        await mergeOnLogin();
        startSnapshot();
      }
    } catch (err) {
      if (err?.code && err.code !== 'auth/no-auth-event') {
        updateStatus({ error: formatAuthError(err) });
        callbacks.toast?.(formatAuthError(err));
      }
    } finally {
      updateStatus({ syncing: false });
    }
  })();

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      updateStatus({ signedIn: true, email: user.email || user.uid, error: '' });
      try {
        await mergeOnLogin();
        startSnapshot();
      } catch (err) {
        updateStatus({ error: err.message || '同步失败' });
        console.error(err);
      }
    } else {
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
      currentUser = null;
      lastPushedAt = '';
      updateStatus({ signedIn: false, email: '', cloudUpdatedAt: '' });
    }
  });
}

window.GapCloudSync = {
  init,
  signIn,
  signOut,
  pullNow,
  pushNow,
  schedulePush,
  getStatus: () => ({ ...status }),
};

if (window.__pendingGapCloudInit) {
  init(window.__pendingGapCloudInit);
  delete window.__pendingGapCloudInit;
}
