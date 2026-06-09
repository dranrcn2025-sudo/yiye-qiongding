import React, { useState, useEffect, useRef } from 'react';
import { sendEmailCode, signInWithCode } from '../../utils/cloudbase';

const SpecialModeModal = ({ isOpen, onClose, entry, onSelectMode }) => {
  if (!isOpen || !entry) return null;
  
  const currentMode = entry.novelMode ? 'novel' : entry.characterMode ? 'character' : entry.timelineMode ? 'timeline' : null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content special-mode-modal" onClick={e => e.stopPropagation()}>
        <h3>选择模式</h3>
        <p className="modal-hint">为「{entry.title}」选择特殊模式</p>
        
        <div className="special-mode-options">
          <div 
            className={`special-mode-option ${currentMode === 'novel' ? 'active' : ''}`}
            onClick={() => { onSelectMode('novel'); onClose(); }}
          >
            <span className="mode-icon">📖</span>
            <div className="mode-info">
              <h4>正文模式</h4>
              <p>适合连载小说，按章节阅读</p>
            </div>
            {currentMode === 'novel' && <span className="mode-check">✓</span>}
          </div>
          
          <div 
            className={`special-mode-option ${currentMode === 'character' ? 'active' : ''}`}
            onClick={() => { onSelectMode('character'); onClose(); }}
          >
            <span className="mode-icon">👤</span>
            <div className="mode-info">
              <h4>人设模式</h4>
              <p>管理角色档案和关系网络</p>
            </div>
            {currentMode === 'character' && <span className="mode-check">✓</span>}
          </div>
          
          <div 
            className={`special-mode-option ${currentMode === 'timeline' ? 'active' : ''}`}
            onClick={() => { onSelectMode('timeline'); onClose(); }}
          >
            <span className="mode-icon">📅</span>
            <div className="mode-info">
              <h4>时间轴模式</h4>
              <p>记录事件时间线</p>
            </div>
            {currentMode === 'timeline' && <span className="mode-check">✓</span>}
          </div>
        </div>
        
        {currentMode && (
          <button 
            className="btn-cancel close-mode-btn" 
            onClick={() => { onSelectMode(null); onClose(); }}
          >
            关闭特殊模式
          </button>
        )}
        
        <button className="btn-cancel" onClick={onClose} style={{ marginTop: 12 }}>取消</button>
      </div>
    </div>
  );
};

// 登录注册弹窗（邮箱验证码，无密码，登录注册同一流程）
const AuthModal = ({ isOpen, onClose, showToast }) => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0); // 0=填邮箱, 1=填验证码
  const [verifyId, setVerifyId] = useState('');
  const [isUser, setIsUser] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => { setStep(0); setCode(''); setError(''); setEmail(''); }, [isOpen]);
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!isOpen) return null;

  const handleSendCode = async () => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    setLoading(true);
    setError('');
    const { verification_id, is_user, error: e } = await sendEmailCode(email);
    setLoading(false);
    if (e) { setError('发送失败：' + (e.message || '请稍后重试')); return; }
    setVerifyId(verification_id);
    setIsUser(!!is_user);
    setStep(1);
    setCountdown(60);
    showToast('验证码已发送，请查收邮件');
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!code) { setError('请输入验证码'); return; }
    setLoading(true);
    setError('');
    const { error: err } = await signInWithCode(email, code, verifyId, isUser);
    setLoading(false);
    if (err) { setError(err.message || '验证失败，请重试'); return; }
    showToast(isUser ? '登录成功！' : '注册成功！');
    onClose();
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h3>登录 / 注册</h3>
        <p className="auth-hint">输入邮箱，收验证码即可登录。没有账号会自动注册。</p>

        {step === 0 ? (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <input type="email" placeholder="邮箱地址" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendCode()} autoFocus />
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-submit-btn" onClick={handleSendCode} disabled={loading}>
              {loading ? '发送中...' : '获取验证码'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleVerify}>
            <p className="auth-email-hint">验证码已发送至 {email}</p>
            <input type="text" placeholder="6位验证码" value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6} autoFocus inputMode="numeric" />
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="auth-submit-btn" disabled={loading}>
              {loading ? '验证中...' : (isUser ? '登录' : '注册并登录')}
            </button>
            <button type="button" className="auth-resend-btn" onClick={handleSendCode}
              disabled={countdown > 0 || loading}
              style={{width:'100%',marginTop:8,background:'none',border:'none',color:'#8B7355',cursor:countdown>0?'default':'pointer',fontSize:'.85rem'}}>
              {countdown > 0 ? `${countdown}秒后可重发` : '重新发送验证码'}
            </button>
            <button type="button" style={{width:'100%',marginTop:4,background:'none',border:'none',color:'#aaa',cursor:'pointer',fontSize:'.8rem'}}
              onClick={() => { setStep(0); setCode(''); setError(''); }}>
              更换邮箱
            </button>
          </form>
        )}

      </div>
    </div>
  );
};

// 回收站页面组件

const RocketModal = ({ isOpen, onClose, onFly, showToast, onLaunchStart }) => {
  const [coord1, setCoord1] = useState('');
  const [coord2, setCoord2] = useState('');
  const [loading, setLoading] = useState(false);
  const [flying, setFlying] = useState(false);
  const input1Ref = useRef(null);
  const input2Ref = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setCoord1('');
      setCoord2('');
      setFlying(false);
      setTimeout(() => input1Ref.current?.focus(), 100);
    }
  }, [isOpen]);

  const parseFullCode = (text) => {
    const cleaned = text.replace(/[\s·,，]/g, '');
    const match = cleaned.match(/(?:α-?)?([A-Z0-9]{3})(?:β-?)?([A-Z0-9]{3})/i);
    if (match) return { part1: match[1].toUpperCase(), part2: match[2].toUpperCase() };
    if (/^[A-Z0-9]{6}$/i.test(cleaned)) return { part1: cleaned.slice(0, 3).toUpperCase(), part2: cleaned.slice(3, 6).toUpperCase() };
    return null;
  };

  const handleInput1 = (e) => {
    const parsed = parseFullCode(e.target.value);
    if (parsed) { setCoord1(parsed.part1); setCoord2(parsed.part2); input2Ref.current?.focus(); return; }
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    setCoord1(val);
    if (val.length === 3) input2Ref.current?.focus();
  };

  const handleInput2 = (e) => {
    setCoord2(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3));
  };

  const handleFly = async () => {
    const fullCode = coord1 + coord2;
    if (fullCode.length !== 6) { showToast('请输入完整的6位坐标'); return; }
    setLoading(true);
    const result = await onFly(fullCode, () => {
      setLoading(false);
      setFlying(true);
      if (onLaunchStart) onLaunchStart();
    });
    if (result.error) { setLoading(false); showToast(result.error); }
  };

  if (!isOpen) return null;

  return (
    <div className={`rocket-modal-overlay ${flying ? 'flying' : ''}`} onClick={flying ? undefined : onClose}>
      <div className={`rocket-modal ${flying ? 'flying' : ''}`} onClick={e => e.stopPropagation()}>
        {flying ? (
          <>
            <div className="rocket-modal-icon flying">🚀</div>
            <p className="rocket-modal-title">正在穿越星际...</p>
            <div className="flying-dots"><span></span><span></span><span></span></div>
          </>
        ) : (
          <>
            <div className="rocket-modal-icon">🚀</div>
            <p className="rocket-modal-title">输入坐标，前往Ta的世界</p>
            <div className="rocket-coord-input">
              <span className="coord-prefix">α-</span>
              <input ref={input1Ref} type="text" value={coord1} onChange={handleInput1} placeholder="___" maxLength={3} className="coord-input" />
              <span className="coord-dot">·</span>
              <span className="coord-prefix">β-</span>
              <input ref={input2Ref} type="text" value={coord2} onChange={handleInput2} placeholder="___" maxLength={3} className="coord-input" />
            </div>
            <button className="rocket-fly-btn" onClick={handleFly} disabled={loading || coord1.length + coord2.length < 6}>
              {loading ? '连接中...' : '启航'}
            </button>
            <button className="rocket-cancel-btn" onClick={onClose}>取消</button>
          </>
        )}
      </div>
    </div>
  );
};

export { SpecialModeModal, AuthModal, RocketModal };

// 移动词条弹窗
