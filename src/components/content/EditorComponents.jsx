import React, { useState, useRef, useEffect, useCallback } from 'react';

const ContentRenderer = ({ content, allTitlesMap, currentBookId, onLinkClick, fontFamily }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !content) return;
    ref.current.innerHTML = content.replace(/【([^】]+)】/g, (m, kw) => {
      const t = allTitlesMap.get(kw);
      return t?.length ? `<span class="keyword linked" data-kw="${kw}">【${kw}】</span>` : `<span class="keyword">【${kw}】</span>`;
    });
    ref.current.querySelectorAll('.keyword.linked').forEach(el => {
      el.onclick = () => {
        const t = allTitlesMap.get(el.dataset.kw);
        if (t?.length) { const tg = t.find(x => x.bookId === currentBookId) || t[0]; onLinkClick(el.dataset.kw, tg.bookId, tg.entry.id); }
      };
    });
  }, [content, allTitlesMap, currentBookId, onLinkClick]);
  return <div ref={ref} className="content-body" style={{ fontFamily }} />;
};

const RichEditor = ({ content, onSave, fontFamily, onImageClick, onResetFormats }) => {
  const ref = useRef(null);
  const timer = useRef(null);
  const onImageClickRef = useRef(onImageClick);
  
  useEffect(() => {
    onImageClickRef.current = onImageClick;
  }, [onImageClick]);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = content || '<p><br></p>';
    }
  }, []);
  
  useEffect(() => {
    if (!ref.current) return;
    const handleImgClick = (e) => {
      if (e.target.tagName === 'IMG') {
        e.preventDefault();
        e.stopPropagation();
        if (onImageClickRef.current) {
          onImageClickRef.current(e.target);
        }
      }
    };
    ref.current.addEventListener('click', handleImgClick);
    return () => ref.current?.removeEventListener('click', handleImgClick);
  }, []);

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (ref.current) onSave(ref.current.innerHTML);
    }, 300);
  }, [onSave]);

  const forceSave = () => { 
    if (ref.current) onSave(ref.current.innerHTML); 
  };

	  const scrollTimer = useRef(null);
	  const scrollToCursor = () => {
	    if (scrollTimer.current) return;
	    scrollTimer.current = setTimeout(() => {
	      scrollTimer.current = null;
	      const selection = window.getSelection();
	      if (selection.rangeCount > 0) {
	        const range = selection.getRangeAt(0);
	        const rect = range.getBoundingClientRect();
	        const viewportHeight = window.innerHeight;
	        const targetY = viewportHeight * 0.4;
	        if (rect.top > viewportHeight * 0.6 || rect.top < viewportHeight * 0.2) {
	          const scrollContainer = ref.current?.closest('.content-area');
	          if (scrollContainer) {
	            scrollContainer.scrollBy({ top: rect.top - targetY, behavior: 'smooth' });
	          }
	        }
	      }
	    }, 200);
	  };

  // 检查内容是否为空（只有空白字符、零宽字符、或空标签）
  const isContentEmpty = () => {
    if (!ref.current) return true;
    const text = ref.current.textContent.replace(/[\u200B\s]/g, ''); // 移除零宽字符和空白
    return text.length === 0;
  };

  // 重置为干净状态
  const resetToClean = () => {
    if (ref.current) {
      ref.current.innerHTML = '<p><br></p>';
      // 将光标放到段落内
      const p = ref.current.querySelector('p');
      if (p) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(p, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      // 通知父组件重置格式状态
      if (onResetFormats) onResetFormats();
    }
  };

  const handleInput = () => {
    save();
    scrollToCursor();
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, []);

  useEffect(() => { 
    if (ref.current) ref.current.forceSave = forceSave; 
  });

  return (
    <div 
      ref={ref} 
      className="rich-editor" 
      contentEditable 
      onInput={handleInput}
      onFocus={scrollToCursor}
      onPaste={(e) => { 
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        save();
        scrollToCursor();
      }}
      onBlur={() => {
        if (ref.current) {
          const text = ref.current.textContent.replace(/[​\s]/g, '');
          if (text.length === 0) {
            ref.current.innerHTML = '<p><br></p>';
            if (onResetFormats) onResetFormats();
          }
        }
        forceSave();
      }}
      style={{ fontFamily }} 
      suppressContentEditableWarning 
    />
  );
};

// SidebarItem 已搬迁到 src/components/shared/SidebarItem.jsx

// ConfirmModal 已搬迁到 src/components/shared/ConfirmModal.jsx

export { ContentRenderer, RichEditor };

// 特殊模式选择弹窗
