import cloudbase from '@cloudbase/js-sdk';

const ENV_ID = 'yiyeqiongding-d8gzi7d2ddde880bb';

const app = cloudbase.init({ env: ENV_ID });
const auth = app.auth({ persistence: 'local' });
const db = app.database();

// ============ 登录认证（邮箱验证码，无密码）============

const onAuthStateChange = (callback) => {
  return auth.onLoginStateChanged((loginState) => {
    if (!loginState) return;
    const user = loginState.user || loginState;
    if (user && (user.uid || user._id)) {
      callback('SIGNED_IN', { user });
    }
  });
};

// 第一步：发送验证码（登录和注册通用）
const sendEmailCode = async (email) => {
  try {
    const result = await auth.getVerification({ email });
    return { verification_id: result?.verification_id, is_user: result?.is_user, error: null };
  } catch (e) {
    return { verification_id: null, is_user: false, error: e };
  }
};

// 第二步：用验证码登录或注册（自动判断是否已有账号）
const signInWithCode = async (email, code, verificationId, isUser) => {
  try {
    if (isUser) {
      // 已有账号，直接登录
      await auth.signInWithEmail({
        verificationInfo: { verification_id: verificationId, is_user: true },
        verificationCode: code,
        email,
      });
    } else {
      // 新用户，先 verify 拿 token，再 signUp
      const verifyRes = await auth.verify({ verification_code: code, verification_id: verificationId });
      if (!verifyRes?.verification_token) throw new Error('验证码错误');
      await auth.signUp({ email, verification_token: verifyRes.verification_token, name: email.split('@')[0] });
    }
    const state = await auth.getLoginState();
    return { data: { user: state?.user || null }, error: null };
  } catch (e) {
    return { data: { user: null }, error: e };
  }
};

const signOut = async () => {
  await auth.signOut();
};

const getUser = async () => {
  const state = await auth.getLoginState();
  return state?.user || null;
};

const getSession = async () => {
  try {
    const state = await auth.getLoginState();
    return { data: { session: state ? { user: state.user } : null } };
  } catch {
    return { data: { session: null } };
  }
};

// ============ 数据库操作 ============

const isAuthenticated = async () => {
  try {
    const state = await auth.getLoginState();
    return !!state;
  } catch { return false; }
};

const loadFromCloud = async (userId) => {
  if (!userId) return { data: null, error: { code: 'NO_USER' } };
  if (!(await isAuthenticated())) return { data: null, error: { code: 'NOT_AUTH' } };
  try {
    const res = await db.collection('user_data').where({ user_id: userId }).get();
    if (res.data && res.data.length > 0) {
      return { data: { data: res.data[0].data, updated_at: res.data[0].updated_at }, error: null };
    }
    return { data: null, error: { code: 'NOT_FOUND' } };
  } catch (e) {
    console.error('加载云端数据失败:', e);
    return { data: null, error: e };
  }
};

const saveToCloudDb = async (userId, cloudData) => {
  if (!userId) return { error: new Error('无用户ID') };
  if (!(await isAuthenticated())) return { error: new Error('未登录') };
  try {
    const existing = await db.collection('user_data').where({ user_id: userId }).get();
    if (existing.data && existing.data.length > 0) {
      await db.collection('user_data').doc(existing.data[0]._id).update({
        data: cloudData,
        updated_at: new Date().toISOString()
      });
    } else {
      await db.collection('user_data').add({
        user_id: userId,
        data: cloudData,
        updated_at: new Date().toISOString()
      });
    }
    return { error: null };
  } catch (e) {
    console.error('保存云端数据失败:', e);
    return { error: e };
  }
};

// 实时监听云端数据变化
const watchCloud = (userId, onUpdate) => {
  try {
    const watcher = db.collection('user_data')
      .where({ user_id: userId })
      .watch({
        onChange: (snapshot) => {
          // 取第一条变更文档
          const changed = snapshot.docChanges?.find(c => c.dataType !== 'init');
          if (!changed) return;
          const doc = changed.doc;
          if (doc?.data && doc?.updated_at) {
            onUpdate(doc.data, doc.updated_at);
          }
        },
        onError: (err) => console.warn('实时监听出错:', err),
      });
    return () => { try { watcher.close(); } catch (e) {} };
  } catch (e) {
    console.warn('启动实时监听失败:', e);
    return () => {};
  }
};

const deleteUserData = async (userId) => {
  try {
    const res = await db.collection('user_data').where({ user_id: userId }).get();
    if (res.data?.length > 0) {
      for (const doc of res.data) {
        await db.collection('user_data').doc(doc._id).remove();
      }
    }
    return { error: null };
  } catch (e) {
    return { error: e };
  }
};

// ============ 邀请码 ============

const upsertInviteCode = async (userId, code) => {
  try {
    const res = await db.collection('invite_codes').where({ user_id: userId }).get();
    if (res.data?.length > 0) {
      await db.collection('invite_codes').doc(res.data[0]._id).update({ code, updated_at: Date.now() });
    } else {
      await db.collection('invite_codes').add({ user_id: userId, code, updated_at: Date.now() });
    }
    return { error: null };
  } catch (e) {
    return { error: e };
  }
};

const findByInviteCode = async (code) => {
  try {
    const res = await db.collection('invite_codes').where({ code }).get();
    if (res.data?.length > 0) {
      const targetUserId = res.data[0].user_id;
      const userRes = await db.collection('user_data').where({ user_id: targetUserId }).get();
      if (userRes.data?.length > 0) {
        return { data: { data: userRes.data[0].data, user_id: targetUserId }, error: null };
      }
    }
    return { data: null, error: { code: 'NOT_FOUND' } };
  } catch (e) {
    return { data: null, error: e };
  }
};

// 兼容旧导出名（App.jsx 仍引用这些名字）
const signInAnonymously = async () => ({ user: null, error: null });
const signIn = sendEmailCode;
const signUp = signInWithCode;

export {
  app, auth, db, ENV_ID,
  onAuthStateChange, getSession, getUser,
  sendEmailCode, signInWithCode,
  signIn, signUp, signInAnonymously,
  signOut,
  loadFromCloud, saveToCloudDb, deleteUserData,
  watchCloud,
  upsertInviteCode, findByInviteCode,
};
