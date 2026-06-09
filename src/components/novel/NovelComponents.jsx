import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';

// ============ 正文模式组件 ============

// 正文模式的+菜单（在正文模式分类内使用）
const NovelAddMenu = ({ isOpen, onClose, onAddChapter, onAddVolume }) => isOpen ? (
  <><div className="add-menu-overlay" onClick={onClose} />
  <div className="add-menu">
    <div className="add-menu-item" onClick={() => { onAddChapter(); onClose(); }}>
      <span>📄</span>
      <span>新建章节</span>
    </div>
    <div className="add-menu-item" onClick={() => { onAddVolume(); onClose(); }}>
      <span>📁</span>
      <span>新建分卷</span>
    </div>
  </div></>
) : null;

// 移至分卷弹窗
const MoveToVolumeModal = ({ isOpen, onClose, volumes, currentVolumeId, onMove }) => {
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content move-volume-modal" onClick={e => e.stopPropagation()}>
        <h3>移至分卷</h3>
        <div className="volume-select-list">
          <div 
            className={`volume-select-item ${!currentVolumeId ? 'current' : ''}`}
            onClick={() => { onMove(null); onClose(); }}
          >
            <span>📄</span>
            <span>独立章节（不属于分卷）</span>
            {!currentVolumeId && <span className="current-mark">当前</span>}
          </div>
          {volumes.map(vol => (
            <div 
              key={vol.id}
              className={`volume-select-item ${currentVolumeId === vol.id ? 'current' : ''}`}
              onClick={() => { onMove(vol.id); onClose(); }}
            >
              <span>📁</span>
              <span>{vol.title}</span>
              {currentVolumeId === vol.id && <span className="current-mark">当前</span>}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
};

// 正文目录视图（在novelMode分类内显示）
const NovelTocView = ({ entry, onSelectChapter, onAddChapter, onAddVolume, onEditItem, onDeleteItem, onMoveChapter, onToggleVolume, collapsedVolumes, allEntries }) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState({ isOpen: false, type: null, item: null, parentId: null, position: { x: 0, y: 0 } });
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [movingChapter, setMovingChapter] = useState(null);
  const [movingFromVolume, setMovingFromVolume] = useState(null);
  const longPressTimer = useRef(null);
  
  // 获取所有子项
  const children = entry.children || [];
  
  // 分离分卷和独立章节
  const volumes = children.filter(c => c.isFolder);
  const standaloneChapters = children.filter(c => !c.isFolder);
  
  // 计算字数
  const countChapterWords = (ch) => ch.content ? ch.content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length : 0;
  const countVolumeWords = (vol) => (vol.children || []).reduce((sum, ch) => sum + countChapterWords(ch), 0);
  const totalWords = volumes.reduce((sum, vol) => sum + countVolumeWords(vol), 0) + standaloneChapters.reduce((sum, ch) => sum + countChapterWords(ch), 0);
  const totalChapters = volumes.reduce((sum, vol) => sum + (vol.children?.length || 0), 0) + standaloneChapters.length;
  
  const handleLongPress = (e, type, item, parentId = null) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setContextMenu({ isOpen: true, type, item, parentId, position: { x: touch.clientX, y: touch.clientY } });
    }, 500);
  };
  
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  
  const handleMoveClick = () => {
    setMovingChapter(contextMenu.item);
    setMovingFromVolume(contextMenu.parentId);
    setContextMenu({ ...contextMenu, isOpen: false });
    setShowMoveModal(true);
  };
  
  const handleMove = (targetVolumeId) => {
    if (movingChapter) {
      onMoveChapter(movingChapter, movingFromVolume, targetVolumeId);
    }
    setMovingChapter(null);
    setMovingFromVolume(null);
  };
  
  return (
    <div className="novel-toc-view">
      <div className="novel-header">
        <h1>{entry.title}</h1>
        {entry.summary && <p>{entry.summary}</p>}
      </div>
      <div className="novel-toc-stats">
        <span>{totalChapters}章</span>
        <span>·</span>
        <span>{totalWords.toLocaleString()}字</span>
      </div>
      
      <div className="novel-toc-list">
        {/* 分卷 */}
        {volumes.map(vol => (
          <div key={vol.id} className="novel-volume">
            <div 
              className="novel-volume-header"
              onClick={() => onToggleVolume(vol.id)}
              onTouchStart={(e) => handleLongPress(e, 'volume', vol)}
              onTouchEnd={clearLongPress}
              onTouchMove={clearLongPress}
            >
              <span className={`volume-arrow ${collapsedVolumes.has(vol.id) ? '' : 'expanded'}`}>▶</span>
              <span className="volume-title">{vol.title}</span>
              <span className="volume-count">{vol.children?.length || 0}章</span>
            </div>
            {!collapsedVolumes.has(vol.id) && (vol.children || []).map(ch => (
              <div 
                key={ch.id} 
                className="novel-chapter-item"
                onClick={() => onSelectChapter(ch, vol.id)}
                onTouchStart={(e) => handleLongPress(e, 'chapter', ch, vol.id)}
                onTouchEnd={clearLongPress}
                onTouchMove={clearLongPress}
              >
                <span className="chapter-title">{ch.title}</span>
                <span className="chapter-words">{countChapterWords(ch).toLocaleString()}字</span>
              </div>
            ))}
          </div>
        ))}
        
        {/* 独立章节（不属于任何分卷） */}
        {standaloneChapters.map(ch => (
          <div 
            key={ch.id} 
            className="novel-chapter-item standalone"
            onClick={() => onSelectChapter(ch, null)}
            onTouchStart={(e) => handleLongPress(e, 'chapter', ch)}
            onTouchEnd={clearLongPress}
            onTouchMove={clearLongPress}
          >
            <span className="chapter-title">{ch.title}</span>
            <span className="chapter-words">{countChapterWords(ch).toLocaleString()}字</span>
          </div>
        ))}
        
        {children.length === 0 && (
          <div className="novel-toc-empty">
            <span>📖</span>
            <p>还没有章节</p>
            <p>点击右下角添加</p>
          </div>
        )}
      </div>
      
      <button className={`fab ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}>
        <span style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span>
      </button>
      <NovelAddMenu isOpen={showAddMenu} onClose={() => setShowAddMenu(false)} onAddChapter={onAddChapter} onAddVolume={onAddVolume} />
      
      {contextMenu.isOpen && (
        <>
          <div className="context-overlay" onClick={() => setContextMenu({ ...contextMenu, isOpen: false })} />
          <div className="context-menu" style={{ top: contextMenu.position.y, left: Math.min(contextMenu.position.x, window.innerWidth - 180) }}>
            <div className="context-item" onClick={() => { 
              onEditItem(contextMenu.item, contextMenu.type);
              setContextMenu({ ...contextMenu, isOpen: false });
            }}>
              <span className="context-icon">✏️</span>编辑{contextMenu.type === 'chapter' ? '章节' : '分卷'}
            </div>
            {contextMenu.type === 'chapter' && volumes.length > 0 && (
              <div className="context-item" onClick={handleMoveClick}>
                <span className="context-icon">📂</span>移至分卷
              </div>
            )}
            <div className="context-item danger" onClick={() => {
              onDeleteItem(contextMenu.item, contextMenu.type, contextMenu.parentId);
              setContextMenu({ ...contextMenu, isOpen: false });
            }}>
              <span className="context-icon">🗑️</span>删除{contextMenu.type === 'chapter' ? '章节' : '分卷'}
            </div>
          </div>
        </>
      )}
      
      <MoveToVolumeModal 
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        volumes={volumes}
        currentVolumeId={movingFromVolume}
        onMove={handleMove}
      />
    </div>
  );
};

// 正文编辑弹窗（新建/编辑章节或分卷）
const NovelEditModal = ({ isOpen, onClose, onSave, editType, editItem }) => {
  const [title, setTitle] = useState('');
  
  useEffect(() => {
    if (isOpen) {
      setTitle(editItem?.title || (editType === 'volume' ? '新分卷' : '新章节'));
    }
  }, [isOpen, editItem, editType]);
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>{editItem ? '编辑' : '新建'}{editType === 'volume' ? '分卷' : '章节'}</h3>
        <input 
          type="text" 
          value={title} 
          onChange={e => setTitle(e.target.value)} 
          placeholder={editType === 'volume' ? '分卷名称' : '章节标题'}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => onSave({ title })}>保存</button>
        </div>
      </div>
    </div>
  );
};

// 正文目录页（全屏，从StoryTocPage简化而来）
const StoryTocPage = ({ book, onClose, onSelectChapter, onAddChapter, onAddVolume, onEditChapter, onEditVolume, onDeleteChapter, onDeleteVolume, onToggleVolume, collapsedVolumes }) => {
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [activeTab, setActiveTab] = useState('toc'); // toc | related
  const [contextMenu, setContextMenu] = useState({ isOpen: false, type: null, item: null, volId: null, position: { x: 0, y: 0 } });
  const longPressTimer = useRef(null);
  
  const handleLongPress = (e, type, item, volId = null) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setContextMenu({ isOpen: true, type, item, volId, position: { x: touch.clientX, y: touch.clientY } });
    }, 500);
  };
  
  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  
  return (
    <div className="story-toc-page">
      <div className="story-toc-header">
        <div className="story-toc-tabs">
          <button className={activeTab === 'toc' ? 'active' : ''} onClick={() => setActiveTab('toc')}>目录</button>
          <button className={activeTab === 'related' ? 'active' : ''} onClick={() => setActiveTab('related')}>相关</button>
        </div>
        <button className="story-toc-sort">☰</button>
      </div>
      
      <div className="story-toc-content">
        {activeTab === 'toc' && (
          <div className="story-toc-list">
            {book.storyMode?.volumes?.map((vol, volIndex) => (
              <div key={vol.id} className="story-volume">
                <div 
                  className="story-volume-header"
                  onClick={() => onToggleVolume(vol.id)}
                  onTouchStart={(e) => handleLongPress(e, 'volume', vol)}
                  onTouchEnd={clearLongPress}
                  onTouchMove={clearLongPress}
                >
                  <span className={`volume-arrow ${collapsedVolumes.has(vol.id) ? '' : 'expanded'}`}>▶</span>
                  <span className="volume-title">{vol.title}</span>
                  <span className="volume-count">{vol.chapters.length}章</span>
                </div>
                {!collapsedVolumes.has(vol.id) && vol.chapters.map((ch, chIndex) => (
                  <div 
                    key={ch.id} 
                    className="story-chapter-item"
                    onClick={() => onSelectChapter(vol.id, ch.id, chIndex)}
                    onTouchStart={(e) => handleLongPress(e, 'chapter', ch, vol.id)}
                    onTouchEnd={clearLongPress}
                    onTouchMove={clearLongPress}
                  >
                    <span className="chapter-title">{ch.title}</span>
                    <span className="chapter-words">{(ch.wordCount || 0).toLocaleString()}字</span>
                  </div>
                ))}
              </div>
            ))}
            {(!book.storyMode?.volumes || book.storyMode.volumes.length === 0) && (
              <div className="story-toc-empty">
                <span>📖</span>
                <p>还没有章节</p>
                <p>点击右下角添加</p>
              </div>
            )}
          </div>
        )}
        {activeTab === 'related' && (
          <div className="story-related-empty">
            <span>🔗</span>
            <p>相关词条</p>
            <p>敬请期待</p>
          </div>
        )}
      </div>
      
      <button className="story-toc-back" onClick={onClose}>← 返回</button>
      
      <button className={`fab ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}>
        <span style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span>
      </button>
      <StoryAddMenu isOpen={showAddMenu} onClose={() => setShowAddMenu(false)} onAddChapter={onAddChapter} onAddVolume={onAddVolume} />
      
      {contextMenu.isOpen && (
        <>
          <div className="context-overlay" onClick={() => setContextMenu({ ...contextMenu, isOpen: false })} />
          <div className="context-menu" style={{ top: contextMenu.position.y, left: Math.min(contextMenu.position.x, window.innerWidth - 180) }}>
            <div className="context-item" onClick={() => { 
              if (contextMenu.type === 'chapter') onEditChapter(contextMenu.volId, contextMenu.item);
              else onEditVolume(contextMenu.item);
              setContextMenu({ ...contextMenu, isOpen: false });
            }}>
              <span className="context-icon">✏️</span>编辑{contextMenu.type === 'chapter' ? '章节' : '分卷'}
            </div>
            <div className="context-item danger" onClick={() => {
              if (contextMenu.type === 'chapter') onDeleteChapter(contextMenu.volId, contextMenu.item.id);
              else onDeleteVolume(contextMenu.item.id);
              setContextMenu({ ...contextMenu, isOpen: false });
            }}>
              <span className="context-icon">🗑️</span>删除{contextMenu.type === 'chapter' ? '章节' : '分卷'}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// 阅读设置面板
const StoryReaderSettings = ({ isOpen, onClose, settings, onChangeSettings }) => {
  if (!isOpen) return null;
  
  const themes = [
    { id: 'editor', name: '编辑器', bg: '#f5f5f5', color: '#333' },
    { id: 'white', name: '纯白', bg: '#fff', color: '#333' },
    { id: 'eyecare', name: '护眼', bg: '#C7EDCC', color: '#333' },
    { id: 'parchment', name: '羊皮纸', bg: '#FAF6F0', color: '#5a4a3a' }
  ];
  
  return (
    <div className="story-settings-panel">
      <div className="settings-row">
        <span className="settings-label">字号</span>
        <input 
          type="range" 
          min="12" 
          max="28" 
          value={settings.fontSize}
          onChange={(e) => onChangeSettings({ ...settings, fontSize: parseInt(e.target.value) })}
        />
        <span className="settings-value">{settings.fontSize}</span>
        <button className="settings-reset" onClick={() => onChangeSettings({ ...settings, fontSize: 17 })}>↺</button>
      </div>
      <div className="settings-row">
        <span className="settings-label">行距</span>
        <input 
          type="range" 
          min="1.2" 
          max="2.5" 
          step="0.1"
          value={settings.lineHeight}
          onChange={(e) => onChangeSettings({ ...settings, lineHeight: parseFloat(e.target.value) })}
        />
        <span className="settings-value">{settings.lineHeight.toFixed(1)}</span>
        <button className="settings-reset" onClick={() => onChangeSettings({ ...settings, lineHeight: 1.8 })}>↺</button>
      </div>
      <div className="settings-row themes">
        <span className="settings-label">样式</span>
        <div className="theme-options">
          {themes.map(t => (
            <button 
              key={t.id}
              className={`theme-btn ${t.id}-theme ${settings.theme === t.id ? 'active' : ''}`}
              onClick={() => onChangeSettings({ ...settings, theme: t.id })}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// 正文目录弹窗（上滑1/3屏幕）
const NovelTocDrawer = ({ isOpen, onClose, chapters, currentChapterId, onSelectChapter, novelModeEntry, isLibraryMode }) => {
  if (!isOpen) return null;
  
  // 整理章节列表（包含分卷信息）
  const tocItems = [];
  
  if (isLibraryMode && chapters) {
    // 图书馆模式：直接使用chapters数组
    chapters.forEach(ch => {
      tocItems.push({ type: 'chapter', item: ch, volumeId: null });
    });
  } else if (novelModeEntry) {
    const collect = (items, parentVol = null) => {
      items.forEach(item => {
        if (item.isFolder) {
          tocItems.push({ type: 'volume', item, id: item.id });
          collect(item.children || [], item);
        } else {
          tocItems.push({ type: 'chapter', item, volumeId: parentVol?.id });
        }
      });
    };
    collect(novelModeEntry.children || []);
  }
  
  return (
    <>
      <div className="toc-drawer-overlay" onClick={onClose} />
      <div className="toc-drawer">
        <div className="toc-drawer-handle" />
        <div className="toc-drawer-header">
          <span>目录</span>
          <button onClick={onClose}>×</button>
        </div>
        <div className="toc-drawer-list">
          {tocItems.map((t, i) => (
            t.type === 'volume' ? (
              <div key={t.id} className="toc-drawer-volume">{t.item.title}</div>
            ) : (
              <div 
                key={t.item.id} 
                className={`toc-drawer-chapter ${t.item.id === currentChapterId ? 'active' : ''}`}
                onClick={() => { onSelectChapter(t.item, t.volumeId); onClose(); }}
              >
                {t.item.title}
              </div>
            )
          ))}
          {tocItems.length === 0 && (
            <div className="toc-drawer-empty">暂无章节</div>
          )}
        </div>
      </div>
    </>
  );
};

// 真正的翻页阅读器 - 左右翻页
const StoryReader = ({ book, chapter, novelModeEntry, allChapters, currentChapterIndex, onClose, onChangeChapter, onEdit, settings, onChangeSettings, isLibraryMode, isBookmarked, onToggleBookmark, initialPage }) => {
  const [showControls, setShowControls] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTocDrawer, setShowTocDrawer] = useState(false);
  const [currentPage, setCurrentPage] = useState(initialPage || 0);
  const [totalPages, setTotalPages] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const [entryOffset, setEntryOffset] = useState(0);
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const pendingDirection = useRef(null);
  const pendingLastPage = useRef(false);
  const lastChapterId = useRef(chapter?.id);
  
  const sidePadding = 24;
  const columnGap = sidePadding * 2;
  
  const cleanContent = (html) => {
    if (!html) return '<p>暂无内容</p>';
    return html
      .replace(/(<p>\s*<\/p>)+/gi, '')
      .replace(/(<p><br\s*\/?>\s*<\/p>)+/gi, '')
      .replace(/(<br\s*\/?>){2,}/gi, '<br>')
      .replace(/(<br\s*\/?>)+$/gi, '')
      .replace(/\s+$/g, '');
  };
  
  useEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
    }
  }, []);
  
  const columnWidth = containerWidth - sidePadding * 2;
  
  // 使用useLayoutEffect - 在浏览器绘制前同步执行
  useLayoutEffect(() => {
    if (lastChapterId.current === chapter?.id) return;
    
    const direction = pendingDirection.current;
    lastChapterId.current = chapter?.id;
    
    if (direction && containerWidth > 0) {
      // 立即禁用动画并设置入场偏移（在绘制前完成）
      setTransitionEnabled(false);
      
      if (direction === 'next') {
        setEntryOffset(containerWidth);
        setCurrentPage(0);
      } else {
        setEntryOffset(-containerWidth);
        // pendingLastPage会在calculatePages中处理
      }
      
      pendingDirection.current = null;
    }
  }, [chapter?.id, containerWidth]);
  
  // 计算总页数
  useLayoutEffect(() => {
    if (!contentRef.current || !columnWidth) return;
    
    const scrollW = contentRef.current.scrollWidth;
    const pageSize = columnWidth + columnGap;
    const pages = Math.max(1, Math.round(scrollW / pageSize));
    setTotalPages(pages);
    
    // 如果需要跳到最后一页
    if (pendingLastPage.current) {
      setCurrentPage(pages - 1);
      pendingLastPage.current = false;
    }
    
    // 如果有入场偏移，下一帧启用动画并清除偏移
    if (entryOffset !== 0) {
      // 使用setTimeout确保在下一个事件循环中执行
      setTimeout(() => {
        setTransitionEnabled(true);
        setEntryOffset(0);
      }, 20);
    }
  }, [chapter?.content, chapter?.id, columnWidth, settings.fontSize, settings.lineHeight, entryOffset]);
  
  const getThemeStyle = () => {
    const themes = {
      editor: { bg: '#f5f5f5', color: '#333' },
      white: { bg: '#fff', color: '#333' },
      eyecare: { bg: '#C7EDCC', color: '#2d4a30' },
      parchment: { bg: '#FAF6F0', color: '#5a4a3a', texture: true }
    };
    return themes[settings.theme] || themes.parchment;
  };
  
  const theme = getThemeStyle();
  
  const goNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    } else {
      const nextChapter = allChapters?.[currentChapterIndex + 1];
      if (nextChapter) {
        pendingDirection.current = 'next';
        pendingLastPage.current = false;
        onChangeChapter(nextChapter);
      }
    }
  };
  
  const goPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    } else {
      const prevChapter = allChapters?.[currentChapterIndex - 1];
      if (prevChapter) {
        pendingDirection.current = 'prev';
        pendingLastPage.current = true;
        onChangeChapter(prevChapter);
      }
    }
  };
  
  const handleTouchStart = (e) => {
    setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  };
  
  const handleTouchEnd = (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStart.x;
    const deltaY = e.changedTouches[0].clientY - touchStart.y;
    
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX < 0) {
        goNextPage();
      } else {
        goPrevPage();
      }
    } else if (Math.abs(deltaX) < 15 && Math.abs(deltaY) < 15) {
      const screenWidth = window.innerWidth;
      const clickX = e.changedTouches[0].clientX;
      
      if (clickX < screenWidth * 0.3) {
        goPrevPage();
      } else if (clickX > screenWidth * 0.7) {
        goNextPage();
      } else {
        setShowControls(!showControls);
        setShowSettings(false);
      }
    }
  };
  
  if (!chapter) return null;
  
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  // 计算水平偏移 + 入场偏移
  const translateX = -currentPage * containerWidth + entryOffset;
  
  return (
    <div 
      className={`story-reader ${settings.theme}`}
      style={{ background: theme.bg, color: theme.color }}
    >
      {theme.texture && <div className="parchment-texture" />}
      
      <header className={`reader-header ${showControls ? 'show' : ''}`}>
        <button className="reader-back-btn" onClick={onClose}>←</button>
        <div className="reader-header-title">{chapter.title}</div>
        {isLibraryMode ? (
          <button className="reader-edit-btn" style={{ opacity: 0, pointerEvents: 'none' }}>✏️</button>
        ) : (
          <button className="reader-edit-btn" onClick={onEdit}>✏️</button>
        )}
      </header>
      
      <div 
        className="reader-page-container"
        ref={containerRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div 
          className="reader-page-content"
          ref={contentRef}
          style={{ 
            fontSize: settings.fontSize, 
            lineHeight: settings.lineHeight,
            columnWidth: columnWidth > 0 ? `${columnWidth}px` : undefined,
            columnGap: `${columnGap}px`,
            paddingLeft: `${sidePadding}px`,
            paddingRight: `${sidePadding}px`,
            transform: `translateX(${translateX}px)`,
            transition: transitionEnabled ? 'transform 0.3s ease' : 'none',
          }}
        >
          <h2 className="reader-chapter-title">{chapter.title}</h2>
          <div 
            className="reader-text"
            dangerouslySetInnerHTML={{ __html: cleanContent(chapter.content) }}
          />
        </div>
      </div>
      
      <div className={`reader-footer ${showControls ? 'hide' : ''}`}>
        <span>{currentPage + 1}/{totalPages}</span>
        <span>{chapter.title}</span>
        <span>{timeStr}</span>
      </div>
      
      {showControls && (
        <div className="reader-controls">
          <div className="reader-controls-top">
            <button onClick={() => setShowTocDrawer(true)}>
              <span>☰</span>
              <span>目录</span>
            </button>
            {isLibraryMode && onToggleBookmark && (
              <button onClick={() => onToggleBookmark(currentChapterIndex, currentPage)} className={isBookmarked ? 'bookmarked' : ''}>
                <span>{isBookmarked ? '🔖' : '🏷️'}</span>
                <span>书签</span>
              </button>
            )}
            <button onClick={() => setShowSettings(!showSettings)}>
              <span>Aa</span>
              <span>设置</span>
            </button>
          </div>
          {showSettings && (
            <StoryReaderSettings 
              isOpen={showSettings} 
              onClose={() => setShowSettings(false)}
              settings={settings}
              onChangeSettings={onChangeSettings}
            />
          )}
        </div>
      )}
      
      <NovelTocDrawer 
        isOpen={showTocDrawer}
        onClose={() => setShowTocDrawer(false)}
        chapters={allChapters}
        currentChapterId={chapter.id}
        onSelectChapter={(ch, volId) => onChangeChapter(ch)}
        novelModeEntry={novelModeEntry}
        isLibraryMode={isLibraryMode}
      />
    </div>
  );
};

// 章节/分卷编辑弹窗
const StoryEditModal = ({ isOpen, onClose, onSave, editingItem, type }) => {
  const [title, setTitle] = useState('');
  
  useEffect(() => {
    if (editingItem) {
      setTitle(editingItem.title || '');
    } else {
      setTitle('');
    }
  }, [editingItem, isOpen]);
  
  if (!isOpen) return null;
  
  const handleSave = () => {
    if (!title.trim()) return;
    onSave({ ...editingItem, title: title.trim() });
    onClose();
  };
  
  const placeholder = type === 'volume' ? '分卷名称' : '章节标题';
  const modalTitle = editingItem ? `编辑${type === 'volume' ? '分卷' : '章节'}` : `新建${type === 'volume' ? '分卷' : '章节'}`;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>{modalTitle}</h3>
        <input 
          type="text" 
          placeholder={placeholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!title.trim()}>保存</button>
        </div>
      </div>
    </div>
  );
};

// 章节编辑器页面
const StoryChapterEditor = ({ book, volumeId, chapter, onSave, onClose }) => {
  const [title, setTitle] = useState(chapter?.title || '');
  const [content, setContent] = useState(chapter?.content || '');
  const editorRef = useRef(null);
  
  useEffect(() => {
    if (editorRef.current && chapter?.content) {
      editorRef.current.innerHTML = chapter.content;
    }
  }, [chapter?.id]);
  
  const handleSave = () => {
    const html = editorRef.current?.innerHTML || '';
    const wordCount = html.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
    onSave(volumeId, { ...chapter, title, content: html, wordCount });
  };
  
  return (
    <div className="story-chapter-editor">
      <div className="chapter-editor-header">
        <button onClick={() => { handleSave(); onClose(); }}>← 返回</button>
        <span>{book.title}</span>
        <button onClick={handleSave}>保存</button>
      </div>
      <div className="chapter-editor-content">
        <input 
          type="text"
          className="chapter-title-input"
          placeholder="章节标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div 
          ref={editorRef}
          className="chapter-content-editor"
          contentEditable
          onBlur={() => {
            setContent(editorRef.current?.innerHTML || '');
          }}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
          }}
        />
      </div>
      <div className="chapter-editor-footer">
        {content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length.toLocaleString()} 字
      </div>
    </div>
  );
};

// ============ 正文模式组件结束 ============

export { NovelAddMenu, MoveToVolumeModal, NovelTocView, NovelEditModal, StoryTocPage, StoryReaderSettings, NovelTocDrawer, StoryReader, StoryEditModal, StoryChapterEditor };
