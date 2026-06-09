import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============ 人设模式组件 ============

// 人设卡片组件 - 工牌风格
const CharacterCard = ({ entry, style = 'dark', onClick, onLongPress, index }) => {
  const longPressTimer = useRef(null);
  
  const handleTouchStart = (e) => {
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        if (navigator.vibrate) navigator.vibrate(30);
        onLongPress(e, entry);
      }, 500);
    }
  };
  
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  if (style === 'dark') {
    // 深色工牌风格
    return (
      <div 
        className="character-card dark" 
        onClick={() => onClick(entry)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <div className="card-avatar">
          {entry.avatar ? (
            <img src={entry.avatar} alt="" />
          ) : (
            <span className="placeholder">👤</span>
          )}
          <span className="card-number">No.{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div className="card-name">{entry.title}</div>
        <div className="card-tags">
          {entry.tags?.slice(0, 3).map((tag, i) => (
            <span key={i} className={`tag ${i === 0 ? 'highlight' : ''}`}>{tag}</span>
          ))}
        </div>
        <div className="card-footer">
          <span className="divider"></span>
          <span className="arrow">▶</span>
        </div>
        {entry.linkable && <div className="stamp">存</div>}
      </div>
    );
  } else {
    // 复古档案风格
    return (
      <div 
        className="character-card-v2" 
        onClick={() => onClick(entry)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
      >
        <div className="card-v2-header">
          <span className="label">人 物 档 案</span>
          <span className="code">#{String(index + 1).padStart(3, '0')}</span>
        </div>
        <div className="card-v2-body">
          <div className="card-v2-avatar">
            {entry.avatar ? (
              <img src={entry.avatar} alt="" />
            ) : (
              <span className="placeholder">👤</span>
            )}
          </div>
          <div className="card-v2-info">
            <div className="card-v2-name">{entry.title}</div>
            <div className="card-v2-tags">
              {entry.tags?.slice(0, 3).map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="card-v2-footer">
          <div className="card-v2-stamp">{entry.linkable ? '存档' : ''}</div>
          <span className="card-v2-arrow">详情 ▶</span>
        </div>
      </div>
    );
  }
};

// 新建人设卡片
const AddCharacterCard = ({ style = 'dark', onClick }) => {
  if (style === 'dark') {
    return (
      <div className="character-card dark add-new" onClick={onClick}>
        <span className="add-icon">+</span>
        <span className="add-text">新建人设</span>
      </div>
    );
  } else {
    return (
      <div className="character-card-v2 add-new" onClick={onClick}>
        <span className="add-icon">+</span>
        <span className="add-text">新建人设</span>
      </div>
    );
  }
};

// 人设详情页（完整词条页，上方身份证+下方内容编辑）
const CharacterDetailPage = ({ entry, onClose, onSave, isReadOnly, cardStyle, allTitlesMap, onLinkClick, bookName, closing, skipAnimation }) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [content, setContent] = useState('');
  const contentRef = useRef(null);
  const exportRef = useRef(null);
  
  // 将HTML内容转换为纯文本（用于编辑模式）
  const htmlToText = (html) => {
    if (!html) return '';
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p>/gi, '\n\n')
      .replace(/<p>/gi, '')
      .replace(/<\/p>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  };
  
  // 将纯文本转换为HTML（用于保存）
  const textToHtml = (text) => {
    if (!text) return '';
    return text
      .split('\n')
      .map(line => line || '<br>')
      .join('<br>');
  };
  
  useEffect(() => {
    if (entry) {
      // 进入编辑模式时转换HTML为纯文本
      setContent(htmlToText(entry.content || ''));
    }
  }, [entry]);
  
  // 渲染内容并绑定链接点击事件
  useEffect(() => {
    if (!contentRef.current || !entry?.content || isEditMode) return;
    
    // 先处理换行，再处理链接
    let html = entry.content
      .split('\n')
      .map(line => line || '<br>')
      .join('<br>');
    
    html = html.replace(/【([^】]+)】/g, (m, kw) => {
      const targets = allTitlesMap?.get?.(kw);
      return targets?.length 
        ? `<span class="char-link" data-kw="${kw}">【${kw}】</span>` 
        : `<span class="char-link broken">【${kw}】</span>`;
    });
    
    contentRef.current.innerHTML = html;
    
    contentRef.current.querySelectorAll('.char-link:not(.broken)').forEach(el => {
      el.onclick = () => {
        const targets = allTitlesMap?.get?.(el.dataset.kw);
        if (targets?.length && onLinkClick) {
          const target = targets[0];
          onLinkClick(el.dataset.kw, target.bookId, target.entry.id);
        }
      };
    });
  }, [entry?.content, allTitlesMap, onLinkClick, isEditMode]);
  
  if (!entry) return null;
  
  const handleSaveContent = () => {
    if (onSave) {
      // 保存时将纯文本转换回适合存储的格式
      onSave({ ...entry, content: content });
    }
    setIsEditMode(false);
  };
  
  // 长按处理（已禁用导出功能）
  const handleLongPressStart = (e) => {
    // 人物档案暂不支持导出长图
  };
  
  const handleLongPressEnd = () => {
  };
  
  // 动画逻辑：关闭时播放下滑，已播放过入场动画的不再播放，新的播放入场
  const animationStyle = closing 
    ? { animation: 'slideDownProfile .25s ease-in forwards' }
    : skipAnimation 
      ? {} 
      : { animation: 'slideUpProfile .3s ease-out' };
  
  return (
    <div className="character-detail-page" style={animationStyle}>
      <div className="character-detail-header">
        <button className="back-btn" onClick={onClose}>←</button>
        <h2>人物档案</h2>
        {!isReadOnly && (
          <div className="read-mode-toggle" onClick={() => {
            if (isEditMode) handleSaveContent();
            else setIsEditMode(true);
          }}>
            <span className={`toggle-label ${!isEditMode ? 'active' : ''}`}>阅读</span>
            <div className={`toggle-switch ${isEditMode ? 'edit-mode' : ''}`}>
              <div className="toggle-knob" />
            </div>
            <span className={`toggle-label ${isEditMode ? 'active' : ''}`}>编辑</span>
          </div>
        )}
      </div>
      
      <div 
        className="character-detail-content"
        ref={exportRef}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchMove={handleLongPressEnd}
      >
        {/* 身份证卡片 - 米棕色风格 */}
        <div className={`char-profile-card ${cardStyle}`}>
          <div className="profile-main">
            <div className="profile-avatar">
              {entry.avatar ? (
                <img src={entry.avatar} alt="" />
              ) : (
                <span className="avatar-placeholder">👤</span>
              )}
            </div>
            <div className="profile-info">
              <h1 className="profile-name">{entry.title}</h1>
              {entry.tags?.length > 0 && (
                <div className="profile-tags">
                  {entry.tags.map((tag, i) => (
                    <span key={i} className="profile-tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {entry.summary && (
            <div className="profile-summary">
              <div className="summary-label">简介</div>
              <p>{entry.summary}</p>
            </div>
          )}
          
          <div className="profile-stamp">✦ {bookName || '一页穹顶'} ✦</div>
        </div>
        
        {/* 详细设定 - 有背景边框，无内部滚动 */}
        <div className="char-detail-section">
          <div className="detail-title">📝 详细设定</div>
          <div className="detail-box">
            {isEditMode ? (
              <textarea
                className="detail-editor"
                value={content}
                onChange={e => {
                  setContent(e.target.value);
                  // 自动调整高度
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onFocus={e => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                placeholder="在这里记录角色的详细设定、背景故事、性格特点...&#10;&#10;💡 使用【词条名】可以链接到其他词条"
              />
            ) : (
              <div className="detail-content">
                {entry.content ? (
                  <div ref={contentRef} className="detail-body" />
                ) : (
                  <p className="empty-hint">暂无详细设定，切换到编辑模式添加内容</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 导出菜单 */}
    </div>
  );
};

// 人设编辑弹窗
const CharacterEditModal = ({ isOpen, onClose, onSave, editingEntry }) => {
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [summary, setSummary] = useState('');
  const [avatar, setAvatar] = useState(null);
  const fileRef = useRef(null);
  
  useEffect(() => {
    if (isOpen) {
      if (editingEntry) {
        setName(editingEntry.title || '');
        setTags(editingEntry.tags?.join('、') || '');
        setSummary(editingEntry.summary || '');
        setAvatar(editingEntry.avatar || null);
      } else {
        setName('');
        setTags('');
        setSummary('');
        setAvatar(null);
      }
    }
  }, [editingEntry, isOpen]);
  
  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatar(ev.target.result);
    reader.readAsDataURL(file);
  };
  
  const handleSave = () => {
    if (!name.trim()) return;
    const tagList = tags.split(/[,，、\s]+/).filter(t => t.trim());
    onSave({
      title: name.trim(),
      tags: tagList,
      summary: summary.trim(),
      avatar
    });
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay character-modal-overlay" onClick={onClose}>
      <div className="modal-content character-edit-modal" onClick={e => e.stopPropagation()}>
        <h3>{editingEntry ? '编辑人设' : '新建人设'}</h3>
        
        <div className="avatar-upload" onClick={() => fileRef.current?.click()}>
          {avatar ? (
            <img src={avatar} alt="" />
          ) : (
            <span className="upload-placeholder">+ 头像</span>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
        </div>
        
        <input 
          type="text" 
          placeholder="姓名 *" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          autoFocus 
        />
        <input 
          type="text" 
          placeholder="标签（用顿号分隔，如：主角、22岁、莱塔尼亚）" 
          value={tags} 
          onChange={e => setTags(e.target.value)} 
        />
        <textarea 
          placeholder="简介（可选）" 
          value={summary} 
          onChange={e => setSummary(e.target.value)} 
          rows={3}
        />
        
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!name.trim()}>
            {editingEntry ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
};

// 关系网页面 - 重新设计UI
const RelationNetworkPage = ({ isOpen, onClose, entries, relations, onAddRelation, onDeleteRelation, onUpdateRelation, bookTitle, cardStyle, allTitlesMap, onLinkClick }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [expandedRelation, setExpandedRelation] = useState(null);
  const [editingStory, setEditingStory] = useState(null);
  const [storyText, setStoryText] = useState('');
  const [contextMenu, setContextMenu] = useState({ show: false, x: 0, y: 0, relation: null });
  const [editingRelation, setEditingRelation] = useState(null);
  const longPressTimer = useRef(null);
  const storyContentRef = useRef(null);
  
  // 渲染故事内容并绑定链接点击
  const renderStoryWithLinks = (story, relationId) => {
    if (!story) return <span className="no-story">暂无记录，点击添加</span>;
    
    const parts = [];
    let lastIndex = 0;
    const regex = /【([^】]+)】/g;
    let match;
    
    while ((match = regex.exec(story)) !== null) {
      if (match.index > lastIndex) {
        parts.push(story.substring(lastIndex, match.index));
      }
      const kw = match[1];
      const targets = allTitlesMap?.get?.(kw);
      if (targets?.length && onLinkClick) {
        parts.push(
          <span 
            key={`${relationId}-${match.index}`} 
            className="story-link" 
            onClick={(e) => { 
              e.stopPropagation(); 
              const target = targets[0];
              onLinkClick(kw, target.bookId, target.entry.id);
              onClose();
            }}
          >
            【{kw}】
          </span>
        );
      } else {
        parts.push(<span key={`${relationId}-${match.index}`} className="story-link broken">【{kw}】</span>);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < story.length) {
      parts.push(story.substring(lastIndex));
    }
    return parts;
  };
  
  if (!isOpen) return null;
  
  const getEntry = (id) => entries.find(e => e.id === id);
  
  // 根据筛选显示关系
  const filteredRelations = selectedPerson
    ? (relations || []).filter(r => r.from === selectedPerson || r.to === selectedPerson)
    : (relations || []);
  
  const handleDeleteRelation = (relationId) => {
    onDeleteRelation(relationId);
    setExpandedRelation(null);
    setContextMenu({ show: false });
  };
  
  const handleSaveStory = (relationId) => {
    if (onUpdateRelation) {
      const relation = relations.find(r => r.id === relationId);
      if (relation) {
        onUpdateRelation({ ...relation, story: storyText });
      }
    }
    setEditingStory(null);
    setStoryText('');
  };
  
  const startEditStory = (relation) => {
    setEditingStory(relation.id);
    setStoryText(relation.story || '');
  };
  
  // 长按处理
  const handleLongPressStart = (e, relation) => {
    const touch = e.touches?.[0] || e;
    longPressTimer.current = setTimeout(() => {
      setContextMenu({
        show: true,
        x: touch.clientX,
        y: touch.clientY,
        relation
      });
    }, 500);
  };
  
  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  
  // 开始编辑关系
  const handleEditRelation = (relation) => {
    setEditingRelation(relation);
    setContextMenu({ show: false });
  };
  
  return (
    <div className="relation-network-page">
      <div className="network-header">
        <button className="back-btn" onClick={onClose}>←</button>
        <h2>{bookTitle} · 关系网</h2>
        <button className="add-relation-btn" onClick={() => setShowAddModal(true)}>+ 添加</button>
      </div>
      
      <div className="relation-list-container">
        {/* 人物头像栏 */}
        <div className="relation-avatars">
          {entries.map(e => (
            <div 
              key={e.id} 
              className={`relation-avatar-item ${selectedPerson === e.id ? 'selected' : ''}`}
              onClick={() => setSelectedPerson(selectedPerson === e.id ? null : e.id)}
            >
              <div className="avatar-circle">
                {e.avatar ? <img src={e.avatar} alt="" /> : '👤'}
              </div>
              <span className="avatar-name">{e.title}</span>
            </div>
          ))}
        </div>
        
        {/* 关系列表 */}
        <div className="relation-list">
          {filteredRelations.length === 0 ? (
            <div className="relation-empty">
              <span>🕸️</span>
              <p>{selectedPerson ? '该角色暂无关系' : '还没有添加关系'}</p>
              <p>点击右上角添加</p>
            </div>
          ) : (
            filteredRelations.map(r => {
              const fromEntry = getEntry(r.from);
              const toEntry = getEntry(r.to);
              if (!fromEntry || !toEntry) return null;
              const isExpanded = expandedRelation === r.id;
              
              return (
                <div 
                  key={r.id} 
                  className={`relation-card ${isExpanded ? 'expanded' : ''}`}
                  onTouchStart={(e) => handleLongPressStart(e, r)}
                  onTouchEnd={handleLongPressEnd}
                  onTouchMove={handleLongPressEnd}
                >
                  {/* 关系主体 */}
                  <div 
                    className="relation-card-main"
                    onClick={() => setExpandedRelation(isExpanded ? null : r.id)}
                  >
                    {/* 左侧人物 */}
                    <div className="relation-person">
                      <div className="person-avatar">
                        {fromEntry.avatar ? <img src={fromEntry.avatar} alt="" /> : '👤'}
                      </div>
                      <span className="person-name">{fromEntry.title}</span>
                    </div>
                    
                    {/* 中间关系 */}
                    <div className="relation-connector">
                      <div className="connector-line" style={{ borderColor: r.color || '#6B5B4F' }}>
                        <span className="connector-label">{r.label || '—'}</span>
                      </div>
                      <span className="connector-arrow">
                        {r.arrowDir === 'both' ? '⟷' : r.arrowDir === 'backward' ? '⟵' : '⟶'}
                      </span>
                    </div>
                    
                    {/* 右侧人物 */}
                    <div className="relation-person">
                      <div className="person-avatar">
                        {toEntry.avatar ? <img src={toEntry.avatar} alt="" /> : '👤'}
                      </div>
                      <span className="person-name">{toEntry.title}</span>
                    </div>
                    
                    {/* 展开指示 */}
                    <span className="expand-indicator">{isExpanded ? '︿' : '﹀'}</span>
                  </div>
                  
                  {/* 展开内容 - 故事备忘 */}
                  {isExpanded && (
                    <div className="relation-card-expand">
                      <div className="story-section">
                        <div className="story-header">
                          <span>📖 故事备忘</span>
                          {editingStory !== r.id && (
                            <button onClick={() => startEditStory(r)}>
                              {r.story ? '编辑' : '+ 添加'}
                            </button>
                          )}
                        </div>
                        
                        {editingStory === r.id ? (
                          <div className="story-editor">
                            <textarea
                              value={storyText}
                              onChange={e => setStoryText(e.target.value)}
                              placeholder="记录这两个角色之间的故事..."
                              autoFocus
                            />
                            <div className="story-btns">
                              <button className="cancel" onClick={() => setEditingStory(null)}>取消</button>
                              <button className="save" onClick={() => handleSaveStory(r.id)}>保存</button>
                            </div>
                          </div>
                        ) : (
                          <div className="story-content">
                            {renderStoryWithLinks(r.story, r.id)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        {/* 统计 */}
        <div className="relation-stats">
          {entries.length} 位角色 · {(relations || []).length} 条关系
        </div>
      </div>
      
      {/* 长按菜单 */}
      {contextMenu.show && (
        <>
          <div className="relation-context-overlay" onClick={() => setContextMenu({ show: false })} />
          <div 
            className="relation-context-menu"
            style={{ 
              top: Math.min(contextMenu.y, window.innerHeight - 120),
              left: Math.min(contextMenu.x - 60, window.innerWidth - 130)
            }}
          >
            <button onClick={() => handleEditRelation(contextMenu.relation)}>
              <span>✏️</span>编辑关系
            </button>
            <button className="danger" onClick={() => handleDeleteRelation(contextMenu.relation.id)}>
              <span>🗑️</span>删除关系
            </button>
          </div>
        </>
      )}
      
      {/* 添加/编辑关系弹窗 */}
      {(showAddModal || editingRelation) && (
        <AddRelationModal 
          isOpen={true}
          onClose={() => { setShowAddModal(false); setEditingRelation(null); }}
          entries={entries}
          editingRelation={editingRelation}
          onSave={(relation) => {
            if (editingRelation) {
              onUpdateRelation(relation);
            } else {
              onAddRelation(relation);
            }
            setShowAddModal(false);
            setEditingRelation(null);
          }}
        />
      )}
    </div>
  );
};

// 添加/编辑关系弹窗 - 简化版
const AddRelationModal = ({ isOpen, onClose, entries, onSave, editingRelation }) => {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [label, setLabel] = useState('');
  const [arrowDir, setArrowDir] = useState('forward');
  
  // 编辑模式时填充数据
  useEffect(() => {
    if (editingRelation) {
      setFromId(editingRelation.from || '');
      setToId(editingRelation.to || '');
      setLabel(editingRelation.label || '');
      setArrowDir(editingRelation.arrowDir || 'forward');
    } else {
      setFromId('');
      setToId('');
      setLabel('');
      setArrowDir('forward');
    }
  }, [editingRelation, isOpen]);
  
  const handleSave = () => {
    if (!fromId || !toId || fromId === toId) return;
    
    onSave({
      id: editingRelation?.id || Date.now().toString(),
      from: fromId,
      to: toId,
      label: label.trim(),
      arrowDir,
      story: editingRelation?.story || ''
    });
    
    onClose();
  };
  
  if (!isOpen) return null;
  
  const getEntryName = (id) => entries.find(e => e.id === id)?.title || '';
  
  return (
    <div className="modal-overlay relation-modal-overlay" onClick={onClose}>
      <div className="modal-content relation-modal" onClick={e => e.stopPropagation()}>
        <h3>{editingRelation ? '编辑关系' : '添加关系'}</h3>
        
        <div className="relation-form">
          <div className="relation-people">
            <div className="relation-select-wrap">
              <select value={fromId} onChange={e => setFromId(e.target.value)}>
                <option value="">选择人物</option>
                {entries.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>
            <span className="relation-arrow">→</span>
            <div className="relation-select-wrap">
              <select value={toId} onChange={e => setToId(e.target.value)}>
                <option value="">选择人物</option>
                {entries.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>
          </div>
          
          <input 
            type="text" 
            placeholder={fromId && toId ? `${getEntryName(fromId)} 对 ${getEntryName(toId)} 的关系` : '关系描述（如：暗恋、师徒、死敌）'}
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          
          <div className="relation-options">
            <div className="option-group">
              <span>方向</span>
              <div className="option-buttons">
                <button className={arrowDir === 'forward' ? 'active' : ''} onClick={() => setArrowDir('forward')}>A → B</button>
                <button className={arrowDir === 'both' ? 'active' : ''} onClick={() => setArrowDir('both')}>A ↔ B</button>
                <button className={arrowDir === 'none' ? 'active' : ''} onClick={() => setArrowDir('none')}>A — B</button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button 
            className="btn-save" 
            onClick={handleSave}
            disabled={!fromId || !toId || fromId === toId}
          >
            {editingRelation ? '保存' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
};

// 人设模式下的+菜单
const CharacterAddMenu = ({ isOpen, onClose, onAddCharacter, onOpenRelationNetwork, onReorder }) => {
  if (!isOpen) return null;
  return (
    <>
      <div className="add-menu-overlay" onClick={onClose} />
      <div className="add-menu character-add-menu">
        <div className="add-menu-item" onClick={() => { onAddCharacter(); onClose(); }}>
          <span className="menu-icon">👤</span>
          <span>新建人设</span>
        </div>
        <div className="add-menu-item" onClick={() => { onOpenRelationNetwork(); onClose(); }}>
          <span className="menu-icon">🕸️</span>
          <span>关系网</span>
        </div>
        <div className="add-menu-item" onClick={() => { onReorder(); onClose(); }}>
          <span className="menu-icon">↕️</span>
          <span>调整排序</span>
        </div>
      </div>
    </>
  );
};

// ============ 人设模式组件结束 ============

export { CharacterCard, AddCharacterCard, CharacterDetailPage, CharacterEditModal, RelationNetworkPage, AddRelationModal, CharacterAddMenu };
