import cloudbase from '@cloudbase/js-sdk';

const ENV_ID = 'yiyeqiongding-d8gzi7d2ddde880bb';

const app = cloudbase.init({ env: ENV_ID });
const auth = app.auth();
const db = app.database();

// ============ 登录认证 ============

const signInAnonymously = async () => {
  try {
    const state = await auth.getLoginState();
    if (state) return { user: state.user || state, error: null };
    const result = await auth.signInAnonymously();
    return { user: result?.user || result, error: null };
  } catch (e) {
    console.error('匿名登录失败:', e);
    return { user: null, error: e };
  }
};

const getSession = async () => {
  try {
    const state = await auth.getLoginState();
    return { data: { session: state ? { user: state.user } : null } };
  } catch {
    return { data: { session: null } };
  }
};

const onAuthStateChange = (callback) => {
  return auth.onLoginStateChanged((loginState) => {
    const session = loginState ? { user: loginState.user || loginState } : null;
    callback('SIGNED_IN', session);
  });
};

const signIn = async (email, password) => {
  try {
    await auth.signInWithPassword({ username: email, password });
    const state = await auth.getLoginState();
    return { data: { user: state?.user || null }, error: null };
  } catch (e) {
    return { data: { user: null }, error: e };
  }
};

const signUp = async (email, password) => {
  try {
    await auth.signUp({ username: email, password, name: email.split('@')[0] });
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

// ============ 数据库操作 ============

// 确保集合存在（懒创建）
const ensureCollections = async () => {
  try {
    // 尝试写入一个临时文档来触发集合自动创建
    // CloudBase 会在第一次写入时自动创建集合，但如果权限不够会失败
    const checkUserData = await db.collection('user_data').limit(1).get();
  } catch (e) {
    console.warn('user_data 集合不可用:', e.message);
  }
  try {
    const checkInviteCodes = await db.collection('invite_codes').limit(1).get();
  } catch (e) {
    console.warn('invite_codes 集合不可用:', e.message);
  }
};

const loadFromCloud = async (userId) => {
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

export { app, auth, db, ENV_ID, ensureCollections, signInAnonymously, getSession, onAuthStateChange, signIn, signUp, signOut, getUser, loadFromCloud, saveToCloudDb, deleteUserData, upsertInviteCode, findByInviteCode };
