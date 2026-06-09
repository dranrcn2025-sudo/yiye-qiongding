import React, { useState, useRef, useEffect } from 'react';

const MoveModal = ({ isOpen, onClose, entry, entries, currentParentId, onMove }) => {
  const [expandedIds, setExpandedIds] = useState(new Set());
  
  if (!isOpen || !entry) return null;
  
  // 递归构建树形结构
  const buildTree = (items, excluded, parentId = null, depth = 0) => {
    const results = [];
    for (const item of items) {
      if (item.id === excluded) continue;
      if (item.isFolder && !item.novelMode && !item.characterMode) {
        const hasChildren = item.children?.some(c => 
          c.isFolder && !c.novelMode && !c.characterMode && c.id !== excluded
        );
        results.push({ 
          id: item.id, 
          title: item.title, 
          depth, 
          parentId,
          hasChildren,
          children: hasChildren ? buildTree(item.children, excluded, item.id, depth + 1) : []
        });
      }
    }
    return results;
  };
  
  const tree = buildTree(entries, entry.id);
  
  const toggleExpand = (id, e) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  
  // 渲染树形列表
  const renderTree = (nodes) => {
    return nodes.map(node => {
      const isExpanded = expandedIds.has(node.id);
      const isCurrent = node.id === currentParentId;
      
      return (
        <div key={node.id}>
          <div 
            className={`move-target-item ${isCurrent ? 'current' : ''}`}
            style={{ paddingLeft: 16 + node.depth * 20 }}
          >
            {node.hasChildren && (
              <span 
                className={`expand-toggle ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => toggleExpand(node.id, e)}
              >
                ▶
              </span>
            )}
            {!node.hasChildren && <span className="expand-placeholder" />}
            <span className="move-target-icon">📁</span>
            <span 
              className="move-target-name"
              onClick={() => { if (!isCurrent) { onMove(entry.id, node.id); onClose(); } }}
            >
              {node.title}
            </span>
            {isCurrent && <span className="current-badge">当前位置</span>}
          </div>
          {isExpanded && node.children.length > 0 && renderTree(node.children)}
        </div>
      );
    });
  };
  
  const isAtRoot = currentParentId === null;
  
  return (
    <div className="modal-overlay move-modal-overlay" onClick={onClose}>
      <div className="modal-content move-modal" onClick={e => e.stopPropagation()}>
        <h3>移动到...</h3>
        <p className="move-entry-name">「{entry.title}」</p>
        <div className="move-target-list">
          {/* 顶层选项 */}
          <div 
            className={`move-target-item root-item ${isAtRoot ? 'current' : ''}`}
            onClick={() => { if (!isAtRoot) { onMove(entry.id, null); onClose(); } }}
          >
            <span className="expand-placeholder" />
            <span className="move-target-icon">📚</span>
            <span className="move-target-name">书籍顶层</span>
            {isAtRoot && <span className="current-badge">当前位置</span>}
          </div>
          
          {/* 分类树 */}
          {renderTree(tree)}
          
          {tree.length === 0 && (
            <div className="move-empty">暂无其他分类可选</div>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
};

// BookModal 已搬迁到 src/components/shared/BookModal.jsx

const TextFormatMenu = ({ isOpen, onClose, activeFormats, onToggleFormat }) => {
  // 使用 onMouseDown + preventDefault 防止按钮点击导致编辑器失焦
  const handleFormat = (e, format) => {
    e.preventDefault(); // 阻止按钮获取焦点
    onToggleFormat(format);
  };
  
  if (!isOpen) return null;
  return (
    <>
      <div className="format-menu-overlay" onClick={onClose} />
      <div className="format-menu">
        <p className="format-hint">点亮后输入即带格式</p>
        <div className="format-row">
          <button className={activeFormats.bold ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'bold')}><b>B</b></button>
          <button className={activeFormats.italic ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'italic')}><i>I</i></button>
          <button className={activeFormats.underline ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'underline')}><u>U</u></button>
          <button className={activeFormats.strike ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'strike')}><s>S</s></button>
        </div>
        <div className="format-row size-row">
          <button className={activeFormats.size === 'small' ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'small')}>小</button>
          <button className={activeFormats.size === 'medium' ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'medium')}>中</button>
          <button className={activeFormats.size === 'big' ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'big')}>大</button>
          <button className={activeFormats.size === 'huge' ? 'active' : ''} onMouseDown={(e) => handleFormat(e, 'huge')}>特大</button>
        </div>
      </div>
    </>
  );
};

const AlignMenu = ({ isOpen, onClose, onAlign }) => isOpen ? (<><div className="format-menu-overlay" onClick={onClose} /><div className="format-menu align-menu"><div className="format-row"><button onClick={() => { onAlign('justifyLeft'); onClose(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v2H3V3zm0 4h12v2H3V7zm0 4h18v2H3v-2zm0 4h12v2H3v-2zm0 4h18v2H3v-2z"/></svg></button><button onClick={() => { onAlign('justifyCenter'); onClose(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v2H3V3zm3 4h12v2H6V7zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z"/></svg></button><button onClick={() => { onAlign('justifyRight'); onClose(); }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v2H3V3zm6 4h12v2H9V7zm-6 4h18v2H3v-2zm6 4h12v2H9v-2zm-6 4h18v2H3v-2z"/></svg></button></div></div></>) : null;

const FontMenu = ({ isOpen, onClose, onSelectFont, currentFont }) => {
  const fonts = [
    { n: '默认', v: "'Noto Serif SC', 'Songti SC', 'SimSun', serif" }, 
    { n: '宋体', v: "'Songti SC', 'STSong', 'SimSun', serif" }, 
    { n: '黑体', v: "'Heiti SC', 'STHeiti', 'SimHei', 'Microsoft YaHei', sans-serif" }, 
    { n: '楷体', v: "'Kaiti SC', 'STKaiti', 'KaiTi', serif" }, 
    { n: '圆体', v: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif" }
  ];
  return isOpen ? (<><div className="format-menu-overlay" onClick={onClose} /><div className="font-menu">{fonts.map(f => (<div key={f.v} className={`font-item ${currentFont === f.v ? 'active' : ''}`} onClick={() => { onSelectFont(f.v); onClose(); }} style={{ fontFamily: f.v }}>{f.n}</div>))}</div></>) : null;
};

// EditorToolbar 已搬迁到 src/components/shared/EditorToolbar.jsx

// AddMenu 已搬迁到 src/components/shared/AddMenu.jsx

// ============ 正文模式组件结束 ============


const ReorderList = ({ entries, onReorder, onExit }) => {
  const [di, setDi] = useState(null); // dragging index (原始位置)
  const [targetIndex, setTargetIndex] = useState(null); // 目标位置
  const [dragY, setDragY] = useState(0);
  const ref = useRef(null);
  const itemHeight = 62; // 每个词条的高度（包含间距）
  
  return (
    <div className="reorder-mode">
      <div className="reorder-header">
        <h3>调整排序</h3>
        <button className="done-btn" onClick={onExit}>完成</button>
      </div>
      <p className="reorder-hint">长按拖动调整顺序</p>
      <div className="reorder-list" ref={ref}>
        {entries.map((e, i) => {
          // 计算这个词条应该偏移多少
          let offsetY = 0;
          if (di !== null && targetIndex !== null && i !== di) {
            if (di < targetIndex) {
              // 向下拖：di和targetIndex之间的项目向上移
              if (i > di && i <= targetIndex) offsetY = -itemHeight;
            } else if (di > targetIndex) {
              // 向上拖：targetIndex和di之间的项目向下移
              if (i >= targetIndex && i < di) offsetY = itemHeight;
            }
          }
          
          const isDragging = i === di;
          
          return (
            <div 
              key={e.id} 
              className={`reorder-item ${isDragging ? 'dragging' : ''}`}
              onTouchStart={(ev) => { 
                const t = ev.touches[0];
                setDragY(t.clientY);
                setDi(i);
                setTargetIndex(i);
                if (navigator.vibrate) navigator.vibrate(30); 
              }}
              onTouchMove={(ev) => {
                if (di === null) return;
                ev.preventDefault();
                const t = ev.touches[0];
                setDragY(t.clientY);
                
                // 根据手指位置计算目标索引
                const listRect = ref.current?.getBoundingClientRect();
                if (listRect) {
                  const relativeY = t.clientY - listRect.top;
                  let newTarget = Math.floor(relativeY / itemHeight);
                  newTarget = Math.max(0, Math.min(entries.length - 1, newTarget));
                  setTargetIndex(newTarget);
                }
              }}
              onTouchEnd={() => { 
                if (di !== null && targetIndex !== null && di !== targetIndex) {
                  onReorder(di, targetIndex); 
                }
                setDi(null); 
                setTargetIndex(null); 
              }}
              style={isDragging ? {
                position: 'fixed',
                left: '5%',
                width: '90%',
                top: dragY - 30,
                zIndex: 1000,
                transform: 'scale(0.95)',
                boxShadow: '0 8px 25px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
                transition: 'none'
              } : {
                transform: `translateY(${offsetY}px)`,
                transition: 'transform 0.2s ease'
              }}
            >
              <div className="reorder-content">
                <span>{e.isFolder ? '📁' : '📄'}</span>
                <span>{e.title}</span>
              </div>
              <div className="bookmark-tab">
                <span>≡</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 全局搜索弹窗
const SearchModal = ({ isOpen, onClose, query, setQuery, results, onSearch, onResultClick }) => {
  const inputRef = useRef(null);
  
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, onSearch]);
  
  if (!isOpen) return null;
  
  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <div className="search-header">
          <div className="search-input-wrap">
            <span className="search-icon">🔍</span>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="搜索词条、内容..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')}>×</button>
            )}
          </div>
          <button className="search-cancel" onClick={onClose}>取消</button>
        </div>
        
        <div className="search-results">
          {query && results.length === 0 && (
            <div className="search-empty">
              <span>✨</span>
              <p>未找到相关内容</p>
            </div>
          )}
          {results.map((r, i) => (
            <div key={i} className="search-result-item" onClick={() => onResultClick(r)}>
              <div className="result-icon">{r.entry.isFolder ? '📁' : '📄'}</div>
              <div className="result-info">
                <h4>{r.entry.title}</h4>
                <p className="result-path">
                  {r.book.title}
                  {r.path.length > 0 && ` / ${r.path.map(p => p.title).join(' / ')}`}
                </p>
                {r.entry.summary && <p className="result-summary">{r.entry.summary}</p>}
              </div>
              <span className="result-arrow">›</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export { MoveModal, ReorderList, SearchModal, TextFormatMenu, AlignMenu, FontMenu };

