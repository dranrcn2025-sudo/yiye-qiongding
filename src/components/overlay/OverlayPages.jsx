import React, { useState, useEffect, useRef } from 'react';

const TrashPage = ({ isOpen, isClosing, onClose, trashBooks, onRestore, onDelete, onClear }) => {
  if (!isOpen) return null;
  
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  };
  
  const getDaysLeft = (deletedAt) => {
    const now = Date.now();
    const deleteTime = new Date(deletedAt).getTime();
    const daysLeft = Math.ceil((deleteTime + 7 * 24 * 60 * 60 * 1000 - now) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysLeft);
  };
  
  // 非引导书的数量
  const normalBooksCount = trashBooks.filter(item => item.book.id !== 'guide').length;
  // 是否只有引导书或空
  const isEffectivelyEmpty = normalBooksCount === 0;
  
  return (
    <div className={`trash-page ${isClosing ? 'closing' : ''}`}>
      <div className="trash-header">
        <button className="trash-back" onClick={onClose}>←</button>
        <h2>回收站</h2>
        {normalBooksCount > 0 && (
          <button className="trash-clear" onClick={onClear}>清空</button>
        )}
      </div>
      <div className="trash-hint">
        <p>删除的书籍将保留7天，之后我会帮你收拾掉。</p>
        <p>——所以说，你又弄丢什么了？</p>
      </div>
      <div className="trash-list">
        {trashBooks.map(item => (
          <div key={item.book.id + '-' + item.deletedAt} className={`trash-item ${item.book.id === 'guide' ? 'guide-book' : ''}`}>
            <div className="trash-book-cover">
              {item.book.coverImage ? <img src={item.book.coverImage} alt="" /> : <span>{item.book.cover}</span>}
            </div>
            <div className="trash-book-info">
              <h3>{item.book.title}</h3>
              <p>删除于 {formatTime(item.deletedAt)}</p>
              {item.book.id === 'guide' ? (
                <p className="trash-permanent">喏，我帮你留着呢。</p>
              ) : (
                <p className="trash-days-left">{getDaysLeft(item.deletedAt)}天后自动清除</p>
              )}
            </div>
            <div className="trash-actions">
              <button className="restore-btn" onClick={() => onRestore(item.book)}>恢复</button>
              {item.book.id !== 'guide' && (
                <button className="delete-btn" onClick={() => onDelete(item.book.id)}>彻底删除</button>
              )}
            </div>
          </div>
        ))}
        {isEffectivelyEmpty && (
          <div className="trash-empty">
            <span>🗑️</span>
            <p>……难得整洁一回</p>
          </div>
        )}
      </div>
    </div>
  );
};

// 版本历史页面组件
const VersionHistoryPage = ({ isOpen, isClosing, onClose, versionHistory, onRestore, showToast }) => {
  if (!isOpen) return null;
  
  return (
    <div className={`version-history-page ${isClosing ? 'closing' : ''}`}>
      <div className="version-header">
        <button className="version-back" onClick={onClose}>←</button>
        <h2>版本历史</h2>
        <span></span>
      </div>
      <div className="version-hint">以词条为单位的版本历史，帮你找回误删或误改的内容</div>
      <div className="version-list">
        <div className="version-empty">
          <span>🚧</span>
          <p>功能升级中</p>
          <p>我们正在重新设计版本历史功能</p>
          <p style={{marginTop: '16px', fontSize: '0.85rem', opacity: 0.7}}>
            新版本将支持：<br/>
            · 以词条为单位的版本追溯<br/>
            · 更清晰的内容对比<br/>
            · 更少的存储空间占用
          </p>
        </div>
      </div>
    </div>
  );
};

// 管理员的稿纸堆页面组件
const PaperStackPage = ({ isOpen, isClosing, onClose, trashCount, libraryCount, onOpenTrash, onOpenVersionHistory, onOpenLibrary, onImportBook, importLoading, onBigClean }) => {
  const importRef = useRef(null);
  
  if (!isOpen) return null;
  
  return (
    <div className={`paper-stack-page ${isClosing ? 'closing' : ''}`}>
      <div className="paper-stack-header">
        <button className="paper-stack-back" onClick={onClose}>←</button>
        <h2>管理员的稿纸堆</h2>
        <span></span>
      </div>
      <div className="paper-stack-hint">这里堆着各种杂物，需要的时候来翻翻</div>
      <div className="paper-stack-menu">
        <div className="paper-stack-item" onClick={onOpenLibrary}>
          <span className="paper-stack-icon">📖</span>
          <div className="paper-stack-text">
            <span className="paper-stack-title">图书馆</span>
            <span className="paper-stack-desc">{libraryCount}本书 · 导入的电子书</span>
          </div>
          <span className="paper-stack-arrow">›</span>
        </div>
        <label className="paper-stack-item">
          <span className="paper-stack-icon">📥</span>
          <div className="paper-stack-text">
            <span className="paper-stack-title">{importLoading ? '导入中...' : '导入书籍'}</span>
            <span className="paper-stack-desc">.yyd 格式的世界设定</span>
          </div>
          <span className="paper-stack-arrow">›</span>
          <input ref={importRef} type="file" accept=".yyd,.json" onChange={onImportBook} style={{ display: 'none' }} disabled={importLoading} />
        </label>
        <div className="paper-stack-item" onClick={onOpenTrash}>
          <span className="paper-stack-icon">🗑️</span>
          <div className="paper-stack-text">
            <span className="paper-stack-title">回收站</span>
            <span className="paper-stack-desc">{trashCount}本书 · 删除的书籍暂存处</span>
          </div>
          <span className="paper-stack-arrow">›</span>
        </div>
        <div className="paper-stack-item" onClick={onOpenVersionHistory}>
          <span className="paper-stack-icon">📜</span>
          <div className="paper-stack-text">
            <span className="paper-stack-title">版本历史</span>
            <span className="paper-stack-desc">回溯到过去的时间点</span>
          </div>
          <span className="paper-stack-arrow">›</span>
        </div>
        <div className="paper-stack-divider" />
        <div className="paper-stack-item danger" onClick={onBigClean}>
          <span className="paper-stack-icon">🧹</span>
          <div className="paper-stack-text">
            <span className="paper-stack-title">大扫除</span>
            <span className="paper-stack-desc">清空一切，回到最初</span>
          </div>
          <span className="paper-stack-arrow">›</span>
        </div>
      </div>
    </div>
  );
};

// 设置页面组件
const SettingsPage = ({ isOpen, isClosing, onClose, user, onLogout, myInviteCode, onGenerateCode, onResetCode, formatCoordinate, syncStatus, lastSyncTime, onSyncNow, showRocketBtn, onToggleRocketBtn, showToast, characterCardStyle, onChangeCardStyle }) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  if (!isOpen) return null;

  const handleResetCode = () => {
    setShowResetConfirm(false);
    onResetCode();
  };

  return (
    <div className={`settings-page ${isClosing ? 'closing' : ''}`}>
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onClose}>←</button>
        <h2>设置</h2>
        <span></span>
      </div>
      
      <div className="settings-content">
        {/* 账号部分 */}
        <div className="settings-section">
          <h3>账号</h3>
          {user ? (
            <div className="settings-account">
              <p className="account-email">{user.email}</p>
              <div className="sync-status">
                <span className={`sync-dot ${syncStatus}`}></span>
                <span>
                  {syncStatus === 'syncing' ? '同步中...' : 
                   syncStatus === 'success' ? '已同步' : 
                   syncStatus === 'error' ? '同步失败' : '未同步'}
                </span>
                {lastSyncTime && (
                  <span className="sync-time">
                    {lastSyncTime.toLocaleTimeString()}
                  </span>
                )}
              </div>
              <button className="settings-btn" onClick={onSyncNow}>立即同步</button>
              <button className="settings-btn logout-btn" onClick={onLogout}>退出登录</button>
            </div>
          ) : (
            <p className="settings-hint">登录后可云端同步数据</p>
          )}
        </div>

        {/* 我的坐标 */}
        {user && (
          <div className="settings-section">
            <h3>🌌 我的坐标</h3>
            <p className="settings-hint">分享坐标，让他人探访你的世界（只读）</p>
            
            {myInviteCode ? (
              <div className="coordinate-display">
                <span className="coordinate-text">{formatCoordinate(myInviteCode)}</span>
                <div className="coordinate-actions">
                  <button onClick={async () => {
                    const formattedCode = formatCoordinate(myInviteCode);
                    const success = await copyToClipboard(formattedCode);
                    if (success) {
                      showToast('坐标已复制');
                    } else {
                      showToast('复制失败，请手动复制: ' + formattedCode);
                    }
                  }}>复制坐标</button>
                  <button className="reset-btn" onClick={() => setShowResetConfirm(true)}>重置坐标</button>
                </div>
              </div>
            ) : (
              <button className="settings-btn generate-coord-btn" onClick={onGenerateCode}>🚀 生成我的坐标</button>
            )}
          </div>
        )}

        {/* 出航设置 */}
        {user && (
          <div className="settings-section">
            <h3>🚀 出航设置</h3>
            <div className="settings-toggle-card">
              <div className="toggle-card-content">
                <span className="toggle-card-icon">🪐</span>
                <div className="toggle-card-text">
                  <span className="toggle-card-title">显示出航按钮</span>
                  <span className="toggle-card-desc">在书架左上角显示火箭，可前往他人世界</span>
                </div>
              </div>
              <label className="toggle-switch-label">
                <input type="checkbox" checked={showRocketBtn} onChange={e => onToggleRocketBtn(e.target.checked)} />
                <span className="toggle-switch-slider"></span>
              </label>
            </div>
          </div>
        )}

        {/* 人设卡片风格 */}
        <div className="settings-section">
          <h3>👤 人设卡片风格</h3>
          <p className="settings-hint">选择人设模式下的卡片样式</p>
          <div className="card-style-options">
            <div 
              className={`card-style-option ${characterCardStyle === 'dark' ? 'active' : ''}`}
              onClick={() => onChangeCardStyle('dark')}
            >
              <div className="style-preview dark-preview">
                <div className="preview-avatar">👤</div>
                <div className="preview-name">深色工牌</div>
              </div>
              <span className="style-label">深色工牌</span>
            </div>
            <div 
              className={`card-style-option ${characterCardStyle === 'light' ? 'active' : ''}`}
              onClick={() => onChangeCardStyle('light')}
            >
              <div className="style-preview light-preview">
                <div className="preview-avatar">👤</div>
                <div className="preview-name">复古档案</div>
              </div>
              <span className="style-label">复古档案</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* 重置确认弹窗 */}
      {showResetConfirm && (
        <div className="settings-confirm-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="settings-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>重置坐标</h3>
            <p>重置后旧坐标将永久失效，确定吗？</p>
            <div className="settings-confirm-actions">
              <button className="cancel-btn" onClick={() => setShowResetConfirm(false)}>取消</button>
              <button className="confirm-btn" onClick={handleResetCode}>确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { TrashPage, VersionHistoryPage, PaperStackPage, SettingsPage };

// 火箭坐标输入弹窗
