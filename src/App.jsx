import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const SUPABASE_URL = 'https://phlughyikkretphpkuoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBobHVnaHlpa2tyZXRwaHBrdW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NTU1OTgsImV4cCI6MjA4MDMzMTU5OH0.WAYl4ZS8-vm_y48dAwW1Jc_DJduTFyZAgq-D5xqJ--8';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = 'inspiration-vault-data';
const LIBRARY_KEY = 'ebook-library-data';
const saveToStorage = (data) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { console.error('保存失败:', e); } };
const loadFromStorage = () => { try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : null; } catch (e) { return null; } };
const saveLibrary = (data) => { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(data)); } catch (e) { console.error('保存图书馆失败:', e); } };
const loadLibrary = () => { try { const saved = localStorage.getItem(LIBRARY_KEY); return saved ? JSON.parse(saved) : { books: [] }; } catch (e) { return { books: [] }; } };

// txt智能分章解析
const parseTxtBook = (text, filename) => {
  const lines = text.split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;
  
  // 常见的章节标题模式
  const chapterPatterns = [
    /^第[一二三四五六七八九十百千万零\d]+[章节回卷集部篇]/,
    /^[第]?\s*\d+\s*[章节回卷集部篇]/,
    /^Chapter\s*\d+/i,
    /^CHAPTER\s*\d+/i,
    /^卷[一二三四五六七八九十百千万零\d]+/,
    /^[【\[].+[】\]]\s*$/,
    /^序[章言幕]|^楔子|^引子|^尾声|^后记|^番外/,
  ];
  
  const isChapterTitle = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 50) return false;
    return chapterPatterns.some(p => p.test(trimmed));
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (isChapterTitle(trimmed)) {
      if (currentChapter && currentChapter.content.trim()) {
        chapters.push(currentChapter);
      }
      currentChapter = {
        id: generateId(),
        title: trimmed,
        content: ''
      };
    } else if (currentChapter) {
      // 不添加额外缩进，让CSS处理
      if (trimmed) {
        currentChapter.content += `<p>${trimmed}</p>`;
      }
    } else if (trimmed) {
      currentChapter = {
        id: generateId(),
        title: '正文',
        content: `<p>${trimmed}</p>`
      };
    }
  }
  
  if (currentChapter && currentChapter.content.trim()) {
    chapters.push(currentChapter);
  }
  
  if (chapters.length === 0) {
    const content = lines.filter(l => l.trim()).map(l => `<p>${l.trim()}</p>`).join('');
    chapters.push({
      id: generateId(),
      title: '正文',
      content
    });
  }
  
  const bookTitle = filename.replace(/\.(txt|TXT)$/, '').trim() || '未命名';
  
  return {
    id: generateId(),
    title: bookTitle,
    author: '未知',
    chapters,
    importTime: Date.now(),
    type: 'txt',
    bookmark: null // 书签：{ chapterIndex, page }
  };
};

// epub解析
const parseEpubBook = async (file) => {
  if (!window.JSZip) {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    document.head.appendChild(script);
    await new Promise(resolve => script.onload = resolve);
  }
  
  const zip = await window.JSZip.loadAsync(file);
  
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('无效的epub文件');
  
  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!rootfileMatch) throw new Error('找不到内容文件');
  
  const opfPath = rootfileMatch[1];
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
  const opfContent = await zip.file(opfPath)?.async('string');
  if (!opfContent) throw new Error('找不到OPF文件');
  
  const parser = new DOMParser();
  const opfDoc = parser.parseFromString(opfContent, 'text/xml');
  
  const titleEl = opfDoc.querySelector('title');
  const creatorEl = opfDoc.querySelector('creator');
  const title = titleEl?.textContent || file.name.replace(/\.epub$/i, '');
  const author = creatorEl?.textContent || '未知';
  
  const manifest = {};
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    manifest[item.getAttribute('id')] = item.getAttribute('href');
  });
  
  const spineItems = [];
  opfDoc.querySelectorAll('spine itemref').forEach(itemref => {
    const idref = itemref.getAttribute('idref');
    if (manifest[idref]) {
      spineItems.push(manifest[idref]);
    }
  });
  
  const chapters = [];
  for (const href of spineItems) {
    // 处理相对路径
    let filePath = opfDir + href;
    if (href.startsWith('/')) {
      filePath = href.substring(1);
    }
    
    const content = await zip.file(filePath)?.async('string');
    if (!content) continue;
    
    const doc = parser.parseFromString(content, 'text/html');
    const body = doc.body;
    if (!body) continue;
    
    // 提取标题
    let chapterTitle = doc.querySelector('h1, h2, h3')?.textContent?.trim();
    if (!chapterTitle) {
      chapterTitle = doc.querySelector('title')?.textContent?.trim();
    }
    if (!chapterTitle) {
      chapterTitle = `章节 ${chapters.length + 1}`;
    }
    
    // 移除不需要的元素
    body.querySelectorAll('script, style, link, meta').forEach(el => el.remove());
    
    // 提取段落内容
    let htmlContent = '';
    const paragraphs = [];
    
    // 遍历所有块级元素提取文本
    const extractParagraphs = (element) => {
      element.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim();
          if (text) {
            paragraphs.push(text);
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          
          if (['script', 'style', 'link', 'meta'].includes(tag)) return;
          
          // 块级元素
          if (['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'].includes(tag)) {
            const text = node.textContent?.trim();
            if (text) {
              if (tag.match(/^h[1-6]$/)) {
                paragraphs.push({ type: 'heading', text });
              } else {
                paragraphs.push(text);
              }
            }
          } else if (tag === 'br') {
            // 换行符不做处理
          } else {
            // 递归处理其他元素
            extractParagraphs(node);
          }
        }
      });
    };
    
    extractParagraphs(body);
    
    // 构建HTML
    paragraphs.forEach(p => {
      if (typeof p === 'object' && p.type === 'heading') {
        htmlContent += `<h3>${p.text}</h3>`;
      } else if (typeof p === 'string') {
        htmlContent += `<p>${p}</p>`;
      }
    });
    
    // 如果没提取到段落，尝试按换行分割
    if (!htmlContent.trim()) {
      const text = body.innerText?.trim();
      if (text) {
        htmlContent = text.split(/\n+/).filter(l => l.trim()).map(l => `<p>${l.trim()}</p>`).join('');
      }
    }
    
    if (htmlContent.trim()) {
      chapters.push({
        id: generateId(),
        title: chapterTitle,
        content: htmlContent
      });
    }
  }
  
  return {
    id: generateId(),
    title,
    author,
    chapters,
    importTime: Date.now(),
    type: 'epub',
    bookmark: null
  };
};

const initialData = {
  books: [
    {
      id: 'guide', title: '先从这个小故事开始', author: '一页穹顶', tags: ['教程'],
      cover: '✨', coverImage: null, color: '#4A3D6A', showStats: true,
      gallery: { enabled: false, images: [] },
      entries: [
        {
          id: 'welcome', title: '欢迎来到一页穹顶', summary: '你的创作伙伴', linkable: true, isFolder: false,
          content: '<p>　　欢迎！🎉</p><p>　　<b>一页穹顶</b>是一款专为创作者设计的灵感管理工具。无论你是小说作者、剧本创作者还是世界观构建爱好者，这里都能帮你把散落的灵感碎片编织成完整的星空。</p><p>　　在这本引导书里，你将学会如何使用一页穹顶的全部功能。点击下方的【基础操作】开始探索吧！</p>',
          children: []
        },
        {
          id: 'basics', title: '基础操作', summary: '从这里开始', content: '', isFolder: true, linkable: true,
          children: [
            { id: 'create-entry', title: '创建词条', summary: '记录你的灵感', linkable: true, isFolder: false, content: '<p>　　<b>创建词条很简单：</b></p><p>　　1. 进入任意书籍或分类</p><p>　　2. 点击右下角的 <b>+</b> 按钮</p><p>　　3. 选择「新建词条」或「新建分类」</p><p>　　4. 输入标题和简介</p><p>　　<b>小提示：</b>分类可以包含子词条，适合整理复杂的世界观。</p>', children: [] },
            { id: 'edit-content', title: '编辑内容', summary: '让文字更精彩', linkable: true, isFolder: false, content: '<p>　　<b>进入编辑模式：</b></p><p>　　点击右上角的「编辑」按钮，即可开始书写。</p><p>　　<b>底部工具栏功能：</b></p><p>　　• <b>↵</b> 首行缩进（给每段加两个空格）</p><p>　　• <b>A</b> 文字格式（加粗、斜体、下划线、删除线、字号）</p><p>　　• <b>对齐</b> 左对齐/居中/右对齐</p><p>　　• <b>T</b> 切换字体</p><p>　　• <b>🖼</b> 插入图片</p>', children: [] },
            { id: 'link-system', title: '跳转链接', summary: '连接你的世界', linkable: true, isFolder: false, content: '<p>　　这是一页穹顶最强大的功能！</p><p>　　<b>使用方法：</b></p><p>　　在正文中用【】包裹词条名，如【创建词条】，就会自动变成可点击的链接。</p><p>　　点击链接会跳转到对应词条，用左上角的返回按钮可以回来。</p><p>　　<b>开启跳转：</b></p><p>　　长按词条 → 选择「开启跳转」，该词条就可以被链接了。</p>', children: [] }
          ]
        },
        {
          id: 'advanced', title: '进阶功能', summary: '更多强大工具', content: '', isFolder: true, linkable: true,
          children: [
            { id: 'merged-view', title: '合并视图', summary: '一览无余', linkable: true, isFolder: false, content: '<p>　　<b>什么是合并视图？</b></p><p>　　当你有一个分类包含多个词条时，可以用合并视图一次性阅读所有内容。</p><p>　　<b>使用方法：</b></p><p>　　在分类列表中，<b>向左滑动</b>任意分类或词条，即可进入该项的合并视图。</p><p>　　合并视图中可以直接编辑所有子词条的内容，甚至添加新词条！</p>', children: [] },
            { id: 'search-func', title: '全局搜索', summary: '星星指引方向', linkable: true, isFolder: false, content: '<p>　　<b>书架页面的金色星星 ⭐</b></p><p>　　点击它会打开搜索界面，可以搜索所有书籍中的词条。</p><p>　　支持搜索：标题、简介、正文内容。</p><p>　　点击搜索结果会直接跳转到对应位置。</p>', children: [] },
            { id: 'reorder', title: '调整排序', summary: '自由安排顺序', linkable: true, isFolder: false, content: '<p>　　<b>如何调整词条顺序？</b></p><p>　　1. 点击右下角 <b>+</b> 按钮</p><p>　　2. 选择「调整排序」</p><p>　　3. 长按词条并拖动到目标位置</p><p>　　4. 点击「完成」保存</p>', children: [] },
            { id: 'export-image', title: '导出长图', summary: '分享你的创作', linkable: true, isFolder: false, content: '<p>　　<b>在只读模式下</b>，长按正文内容可以唤出功能菜单。</p><p>　　选择「导出长图」，会将当前词条生成为一张精美的长图，方便分享到社交媒体。</p><p>　　导出的图片不包含顶部导航栏，只有纯净的内容。</p>', children: [] }
          ]
        },
        {
          id: 'tips', title: '小贴士', summary: '让使用更顺手', linkable: true, isFolder: false,
          content: '<p>　　<b>一些实用技巧：</b></p><p>　　• 长按书籍或词条可以编辑/删除</p><p>　　• 切换编辑/阅读模式时会自动保存</p><p>　　• 词条底部会显示实时字数统计</p><p>　　• 在书籍设置中可以选择是否显示字数</p><p>　　<b>现在，创建你的第一本书吧！</b></p><p>　　返回书架，点击「新建世界」开始你的创作之旅~ 🚀</p>',
          children: []
        }
      ]
    }
  ]
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);
const collectAllLinkableTitles = (books) => { const m = new Map(); const c = (es, bid, bt) => es.forEach(e => { if (e.linkable) { if (!m.has(e.title)) m.set(e.title, []); m.get(e.title).push({ bookId: bid, bookTitle: bt, entry: e }); } if (e.children?.length) c(e.children, bid, bt); }); books.forEach(b => c(b.entries, b.id, b.title)); return m; };
const findEntryPath = (es, tid, p = []) => { for (const e of es) { const cp = [...p, e]; if (e.id === tid) return cp; if (e.children?.length) { const f = findEntryPath(e.children, tid, cp); if (f) return f; } } return null; };
const findEntryById = (es, id) => { for (const e of es) { if (e.id === id) return e; if (e.children?.length) { const f = findEntryById(e.children, id); if (f) return f; } } return null; };
const getAllChildContent = (e, all) => { let r = []; const c = (x) => { if (!x) return; if (x.content || !x.isFolder) r.push(x); if (x.children?.length) x.children.forEach(ch => c(findEntryById(all, ch.id) || ch)); }; if (e?.children?.length) e.children.forEach(ch => c(findEntryById(all, ch.id) || ch)); return r; };
const updateEntryInTree = (es, eid, u) => es.map(e => e.id === eid ? { ...e, ...u } : e.children?.length ? { ...e, children: updateEntryInTree(e.children, eid, u) } : e);
const addEntryToParent = (es, pid, ne) => { if (!pid) return [...es, ne]; return es.map(e => e.id === pid ? { ...e, children: [...(e.children || []), ne] } : e.children?.length ? { ...e, children: addEntryToParent(e.children, pid, ne) } : e); };
const deleteEntryFromTree = (es, eid) => es.filter(e => e.id !== eid).map(e => e.children?.length ? { ...e, children: deleteEntryFromTree(e.children, eid) } : e);
const reorderEntriesInParent = (es, pid, fi, ti) => { if (pid === null) { const a = [...es]; const [m] = a.splice(fi, 1); a.splice(ti, 0, m); return a; } return es.map(e => e.id === pid && e.children ? (() => { const a = [...e.children]; const [m] = a.splice(fi, 1); a.splice(ti, 0, m); return { ...e, children: a }; })() : e.children?.length ? { ...e, children: reorderEntriesInParent(e.children, pid, fi, ti) } : e); };
const countWords = (es) => { let c = 0; const t = (is) => is.forEach(i => { if (i.content) c += i.content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length; if (i.children?.length) t(i.children); }); t(es); return c; };
const countSingleEntryWords = (content) => content ? content.replace(/<[^>]+>/g, '').replace(/\s/g, '').length : 0;
const countEntries = (es) => { let c = 0; const t = (is) => is.forEach(i => { if (!i.isFolder) c++; if (i.children?.length) t(i.children); }); t(es); return c; };
const compressImage = (file, maxW = 600) => new Promise(r => { const rd = new FileReader(); rd.onload = (e) => { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); let { width: w, height: h } = img; if (w > maxW) { h = (h * maxW) / w; w = maxW; } cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h); r(cv.toDataURL('image/jpeg', 0.6)); }; img.src = e.target.result; }; rd.readAsDataURL(file); });

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

  const scrollToCursor = () => {
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
    // 如果内容变空，重置为干净状态，防止格式残留
    if (isContentEmpty()) {
      resetToClean();
    }
    save();
    setTimeout(scrollToCursor, 50);
  };

  useEffect(() => { 
    return () => { if (timer.current) clearTimeout(timer.current); }; 
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
        setTimeout(scrollToCursor, 50);
      }} 
      onBlur={forceSave} 
      style={{ fontFamily }} 
      suppressContentEditableWarning 
    />
  );
};

const SidebarItem = ({ entry, depth = 0, onSelect, currentId, expandedIds, onToggle }) => {
  const hasC = entry.children?.length > 0;
  const isExp = expandedIds.has(entry.id);
  return (<div className="sidebar-item-wrapper"><div className={`sidebar-item ${currentId === entry.id ? 'active' : ''}`} style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => onSelect(entry)}>{hasC && <span className={`expand-icon ${isExp ? 'expanded' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(entry.id); }}>›</span>}<span className="sidebar-icon">{entry.isFolder ? '📁' : '📄'}</span><span className="sidebar-title">{entry.title}</span>{entry.linkable && <span className="link-star">⭐</span>}</div>{hasC && isExp && entry.children.map(c => <SidebarItem key={c.id} entry={c} depth={depth + 1} onSelect={onSelect} currentId={currentId} expandedIds={expandedIds} onToggle={onToggle} />)}</div>);
};

const ConfirmModal = ({ isOpen, title, message, onConfirm, onCancel }) => isOpen ? (<div className="modal-overlay" onClick={onCancel}><div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}><h3>{title}</h3><p>{message}</p><div className="modal-actions"><button className="btn-cancel" onClick={onCancel}>取消</button><button className="btn-danger" onClick={onConfirm}>确认删除</button></div></div></div>) : null;

// 登录注册弹窗
const AuthModal = ({ isOpen, onClose, mode, setMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert('注册成功！');
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>×</button>
        <h3>{mode === 'login' ? '登录' : '注册'}</h3>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="密码（至少6位）"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={6}
            required
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? '请稍候...' : (mode === 'login' ? '登录' : '注册')}
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'login' ? (
            <>还没有账号？<span onClick={() => setMode('register')}>立即注册</span></>
          ) : (
            <>已有账号？<span onClick={() => setMode('login')}>立即登录</span></>
          )}
        </p>
      </div>
    </div>
  );
};

// 设置页面组件
const SettingsPage = ({ isOpen, onClose, user, onLogout, myInviteCode, onGenerateCode, syncStatus, lastSyncTime, onSyncNow }) => {
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');

  if (!isOpen) return null;

  const handleUseCode = async () => {
    if (!inviteCodeInput.trim()) return;
    // 这个函数会从父组件传入
    if (window.useInviteCodeFn) {
      await window.useInviteCodeFn(inviteCodeInput.trim());
      setInviteCodeInput('');
      setShowInviteInput(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button onClick={onClose}>← 返回</button>
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

        {/* 邀请码部分 */}
        {user && (
          <div className="settings-section">
            <h3>邀请码</h3>
            <p className="settings-hint">分享邀请码，让好友查看你的书架（只读）</p>
            
            {myInviteCode ? (
              <div className="invite-code-display">
                <span className="code">{myInviteCode}</span>
                <button onClick={() => {
                  navigator.clipboard?.writeText(myInviteCode);
                  alert('已复制');
                }}>复制</button>
              </div>
            ) : (
              <button className="settings-btn" onClick={onGenerateCode}>生成我的邀请码</button>
            )}

            <div className="settings-divider"></div>
            
            <p className="settings-hint">输入他人的邀请码，查看对方书架</p>
            {showInviteInput ? (
              <div className="invite-input-row">
                <input
                  type="text"
                  placeholder="输入邀请码"
                  value={inviteCodeInput}
                  onChange={e => setInviteCodeInput(e.target.value.toUpperCase())}
                  maxLength={6}
                />
                <button onClick={handleUseCode}>确定</button>
                <button onClick={() => setShowInviteInput(false)}>取消</button>
              </div>
            ) : (
              <button className="settings-btn" onClick={() => setShowInviteInput(true)}>使用邀请码</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
const ContextMenu = ({ isOpen, position, onClose, options }) => isOpen ? (<><div className="context-overlay" onClick={onClose} /><div className="context-menu" style={{ top: position.y, left: Math.min(position.x, window.innerWidth - 180) }}>{options.map((o, i) => (<div key={i} className={`context-item ${o.danger ? 'danger' : ''}`} onClick={() => { o.action(); onClose(); }}><span className="context-icon">{o.icon}</span>{o.label}</div>))}</div></>) : null;

const EntryModal = ({ isOpen, onClose, onSave, editingEntry, parentTitle, isFolder }) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [createAsFolder, setCreateAsFolder] = useState(false);
  useEffect(() => { if (editingEntry) { setTitle(editingEntry.title || ''); setSummary(editingEntry.summary || ''); } else { setTitle(''); setSummary(''); setCreateAsFolder(isFolder || false); } }, [editingEntry, isOpen, isFolder]);
  if (!isOpen) return null;
  return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h3>{editingEntry ? '编辑词条' : (createAsFolder ? '新建分类' : '新建词条')}</h3>{parentTitle && <p className="modal-hint">添加到: {parentTitle}</p>}<input type="text" placeholder="标题" value={title} onChange={e => setTitle(e.target.value)} autoFocus /><input type="text" placeholder="简介（可选）" value={summary} onChange={e => setSummary(e.target.value)} />{!editingEntry && <label className="checkbox-label"><input type="checkbox" checked={createAsFolder} onChange={e => setCreateAsFolder(e.target.checked)} /><span>创建为分类文件夹</span></label>}<div className="modal-actions"><button className="btn-cancel" onClick={onClose}>取消</button><button className="btn-save" onClick={() => { if (title.trim()) { onSave({ title: title.trim(), summary: summary.trim(), isFolder: createAsFolder }); onClose(); } }} disabled={!title.trim()}>{editingEntry ? '保存' : '创建'}</button></div></div></div>);
};

const BookModal = ({ isOpen, onClose, onSave, editingBook }) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState('');
  const [emoji, setEmoji] = useState('📖');
  const [coverImage, setCoverImage] = useState(null);
  const [showStats, setShowStats] = useState(true);
  const fileRef = useRef(null);
  const emojis = ['📖', '🌙', '⭐', '🏯', '🗡️', '🌸', '🔮', '🐉', '🦋', '🌊', '🔥', '💎'];
  useEffect(() => { if (editingBook) { setTitle(editingBook.title); setAuthor(editingBook.author || ''); setTags(editingBook.tags?.join(', ') || ''); setEmoji(editingBook.cover); setCoverImage(editingBook.coverImage); setShowStats(editingBook.showStats !== false); } else { setTitle(''); setAuthor(''); setTags(''); setEmoji('📖'); setCoverImage(null); setShowStats(true); } }, [editingBook, isOpen]);
  if (!isOpen) return null;
  return (<div className="modal-overlay" onClick={onClose}><div className="modal-content book-modal" onClick={e => e.stopPropagation()}><h3>{editingBook ? '编辑书籍' : '新建世界'}</h3><input type="text" placeholder="书名" value={title} onChange={e => setTitle(e.target.value)} autoFocus /><input type="text" placeholder="作者（可选）" value={author} onChange={e => setAuthor(e.target.value)} /><input type="text" placeholder="标签，逗号分隔" value={tags} onChange={e => setTags(e.target.value)} /><label className="checkbox-label"><input type="checkbox" checked={showStats} onChange={e => setShowStats(e.target.checked)} /><span>显示字数统计</span></label><div className="cover-section"><p className="section-label">封面</p>{coverImage ? (<div className="cover-preview"><img src={coverImage} alt="" /><button className="remove-cover" onClick={() => setCoverImage(null)}>×</button></div>) : (<div className="emoji-picker">{emojis.map(e => <span key={e} className={`emoji-option ${emoji === e ? 'selected' : ''}`} onClick={() => setEmoji(e)}>{e}</span>)}</div>)}<button className="upload-cover-btn" onClick={() => fileRef.current?.click()}>📷 上传封面</button><input ref={fileRef} type="file" accept="image/*" onChange={async e => { const f = e.target.files[0]; if (f) setCoverImage(await compressImage(f, 400)); }} style={{ display: 'none' }} /></div><div className="modal-actions"><button className="btn-cancel" onClick={onClose}>取消</button><button className="btn-save" onClick={() => { if (title.trim()) { onSave({ title: title.trim(), author, tags: tags.split(',').map(t => t.trim()).filter(Boolean), emoji, coverImage, showStats }); onClose(); } }} disabled={!title.trim()}>保存</button></div></div></div>);
};

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

const EditorToolbar = ({ onIndent, onFormat, onFont, onAlign, onImage, hasActive }) => {
  const imgRef = useRef(null);
  return (<div className="editor-toolbar-bottom"><button onClick={onIndent}>↵</button><button onClick={onFormat} className={hasActive ? 'has-active' : ''}>A</button><button onClick={onAlign}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h18v2H3V3zm3 4h12v2H6V7zm-3 4h18v2H3v-2zm3 4h12v2H6v-2zm-3 4h18v2H3v-2z"/></svg></button><button onClick={onFont}>T</button><button onClick={() => imgRef.current?.click()}>🖼</button><input ref={imgRef} type="file" accept="image/*" onChange={onImage} style={{ display: 'none' }} /></div>);
};

const AddMenu = ({ isOpen, onClose, onAddEntry, onAddFolder, onReorder, onToggleGallery, galleryEnabled }) => isOpen ? (<><div className="add-menu-overlay" onClick={onClose} /><div className="add-menu"><div className="add-menu-item" onClick={() => { onAddFolder(); onClose(); }}><span>📁</span><span>新建分类</span></div><div className="add-menu-item" onClick={() => { onAddEntry(); onClose(); }}><span>📄</span><span>新建词条</span></div><div className="add-menu-item" onClick={() => { onReorder(); onClose(); }}><span>↕️</span><span>调整排序</span></div><div className="add-menu-item" onClick={() => { onToggleGallery(); onClose(); }}><span>🖼️</span><span>{galleryEnabled ? '关闭画廊' : '开启画廊'}</span></div></div></>) : null;

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

export default function App() {
  const [data, setData] = useState(() => loadFromStorage() || initialData);
  const [currentBook, setCurrentBook] = useState(null);
  const [currentEntry, setCurrentEntry] = useState(null);
  const [viewMode, setViewMode] = useState('list');
  const [isReadOnly, setIsReadOnly] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [navigationStack, setNavigationStack] = useState([]);
  const [mergedContents, setMergedContents] = useState([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showBookModal, setShowBookModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [editingBook, setEditingBook] = useState(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState({ isOpen: false, position: { x: 0, y: 0 }, options: [] });
  const [confirmModal, setConfirmModal] = useState({ isOpen: false });
  const [slideAnim, setSlideAnim] = useState('');
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [showAlignMenu, setShowAlignMenu] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [currentFont, setCurrentFont] = useState("'Noto Serif SC', serif");
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false, strike: false, size: 'medium' });
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportMenuPos, setExportMenuPos] = useState({ x: 0, y: 0 });
  const [imageToDelete, setImageToDelete] = useState(null);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryPreviewImage, setGalleryPreviewImage] = useState(null);
  const [galleryContextMenu, setGalleryContextMenu] = useState({ isOpen: false, image: null, position: { x: 0, y: 0 } });
  const [galleryConfirmModal, setGalleryConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  // 正文模式状态
  const [showStoryBookPage, setShowStoryBookPage] = useState(false);
  const [showStoryToc, setShowStoryToc] = useState(false);
  const [showStoryReader, setShowStoryReader] = useState(false);
  const [currentStoryVolume, setCurrentStoryVolume] = useState(null);
  const [currentStoryChapter, setCurrentStoryChapter] = useState(null);
  const [storyCollapsedVolumes, setStoryCollapsedVolumes] = useState(new Set());
  const [showStoryEditModal, setShowStoryEditModal] = useState(false);
  const [storyEditType, setStoryEditType] = useState('chapter'); // chapter | volume
  const [storyEditItem, setStoryEditItem] = useState(null);
  const [storyEditVolId, setStoryEditVolId] = useState(null);
  const [showStoryChapterEditor, setShowStoryChapterEditor] = useState(false);
  const [storySettings, setStorySettings] = useState({ fontSize: 17, lineHeight: 1.8, theme: 'parchment' });
  // 新正文模式（基于分类的）
  const [novelCollapsedVolumes, setNovelCollapsedVolumes] = useState(new Set());
  const [showNovelEditModal, setShowNovelEditModal] = useState(false);
  const [novelEditType, setNovelEditType] = useState('chapter');
  const [novelEditItem, setNovelEditItem] = useState(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileClosing, setProfileClosing] = useState(false);
  const [userAvatar, setUserAvatar] = useState(() => localStorage.getItem('userAvatar') || '');
  const [userBio, setUserBio] = useState(() => localStorage.getItem('userBio') || '');
  const [userBg, setUserBg] = useState(() => localStorage.getItem('userBg') || '');
  const [showTotalGallery, setShowTotalGallery] = useState(false);
  const avatarUploadRef = useRef(null);
  const bgUploadRef = useRef(null);
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '创作者');
  const [shelfOverscroll, setShelfOverscroll] = useState(0);
  const [shelfPage, setShelfPage] = useState(0);
  const shelfTouchStart = useRef({ y: 0, scrollTop: 0 });
  const shelfRef = useRef(null);
  const [galleryViewIndex, setGalleryViewIndex] = useState(0);
  const [galleryViewerMenu, setGalleryViewerMenu] = useState(false);
  const galleryViewerLongPress = useRef(null);
  const [galleryViewScale, setGalleryViewScale] = useState(1);
  const [galleryViewPos, setGalleryViewPos] = useState({ x: 0, y: 0 });
  const [galleryAnimating, setGalleryAnimating] = useState(false);
  const [galleryDragX, setGalleryDragX] = useState(0);
  const [galleryIsDragging, setGalleryIsDragging] = useState(false);
  const galleryTouchStart = useRef({ x: 0, y: 0, dist: 0, scale: 1, time: 0 });
  const galleryLongPressTimer = useRef(null);
  const contentLongPressTimer = useRef(null);
  const exportRef = useRef(null);
  const galleryUploadRef = useRef(null);
  const longPressTimer = useRef(null);
  const touchStartX = useRef(0);
  const editorRef = useRef(null);
  const savedSelection = useRef(null);
  
  // 图书馆状态（导入的电子书）
  const [library, setLibrary] = useState(() => loadLibrary());
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryBook, setLibraryBook] = useState(null); // 当前阅读的图书馆书籍
  const [libraryChapterIndex, setLibraryChapterIndex] = useState(0);
  const [showLibraryReader, setShowLibraryReader] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const libraryUploadRef = useRef(null);

  // 认证状态
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | success | error
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [myInviteCode, setMyInviteCode] = useState(null);
  const [sharedUsers, setSharedUsers] = useState([]); // 我分享给了谁
  const [viewingSharedUser, setViewingSharedUser] = useState(null); // 正在查看谁的书架
  const [sharedBookshelf, setSharedBookshelf] = useState(null); // 他人的书架数据
  const [showInviteInput, setShowInviteInput] = useState(false);

  // 初始化认证状态
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 用户登录后加载云端数据
  useEffect(() => {
    if (user) {
      loadCloudData();
      loadMyInviteCode();
      loadSharedUsers();
    }
  }, [user]);

  // 加载云端数据
  const loadCloudData = async () => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      const { data: cloudData, error } = await supabase
        .from('user_data')
        .select('data, updated_at')
        .eq('user_id', user.id)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        throw error;
      }
      
      if (cloudData?.data) {
        const localUpdated = localStorage.getItem('lastUpdated');
        const cloudUpdated = new Date(cloudData.updated_at).getTime();
        
        // 如果云端数据更新，使用云端数据
        if (!localUpdated || cloudUpdated > parseInt(localUpdated)) {
          setData(cloudData.data);
          saveToStorage(cloudData.data);
          localStorage.setItem('lastUpdated', cloudUpdated.toString());
        }
        setLastSyncTime(new Date(cloudData.updated_at));
      }
      setSyncStatus('success');
    } catch (err) {
      console.error('加载云端数据失败:', err);
      setSyncStatus('error');
    }
  };

  // 保存到云端
  const saveToCloud = async (dataToSave) => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      const { error } = await supabase
        .from('user_data')
        .upsert({
          user_id: user.id,
          data: dataToSave,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });
      
      if (error) throw error;
      
      const now = Date.now();
      localStorage.setItem('lastUpdated', now.toString());
      setLastSyncTime(new Date());
      setSyncStatus('success');
    } catch (err) {
      console.error('保存到云端失败:', err);
      setSyncStatus('error');
    }
  };

  // 加载我的邀请码
  const loadMyInviteCode = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('invitations')
      .select('code')
      .eq('owner_id', user.id)
      .single();
    
    if (data) {
      setMyInviteCode(data.code);
    }
  };

  // 生成邀请码
  const generateInviteCode = async () => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const { error } = await supabase
      .from('invitations')
      .insert({ code, owner_id: user.id });
    
    if (error) {
      if (error.code === '23505') {
        // 重复，重新生成
        return generateInviteCode();
      }
      alert('生成失败：' + error.message);
      return;
    }
    
    setMyInviteCode(code);
  };

  // 加载我分享给了谁
  const loadSharedUsers = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('shared_access')
      .select('viewer_id, created_at')
      .eq('owner_id', user.id);
    
    if (data) {
      setSharedUsers(data);
    }
  };

  // 使用邀请码
  const useInviteCode = async (code) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    
    // 查找邀请码
    const { data: invitation, error } = await supabase
      .from('invitations')
      .select('owner_id')
      .eq('code', code.toUpperCase())
      .single();
    
    if (error || !invitation) {
      alert('邀请码无效');
      return;
    }
    
    if (invitation.owner_id === user.id) {
      alert('不能使用自己的邀请码');
      return;
    }
    
    // 添加访问权限
    const { error: accessError } = await supabase
      .from('shared_access')
      .upsert({
        owner_id: invitation.owner_id,
        viewer_id: user.id
      }, { onConflict: 'owner_id,viewer_id' });
    
    if (accessError) {
      alert('添加失败：' + accessError.message);
      return;
    }
    
    // 加载对方的书架
    const { data: ownerData } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', invitation.owner_id)
      .single();
    
    if (ownerData?.data) {
      setSharedBookshelf(ownerData.data);
      setViewingSharedUser(invitation.owner_id);
      setShowInviteInput(false);
      alert('成功！现在可以查看对方的书架了');
    }
  };

  // 退出查看他人书架
  const exitSharedView = () => {
    setViewingSharedUser(null);
    setSharedBookshelf(null);
  };

  // 保存当前选区
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      savedSelection.current = sel.getRangeAt(0).cloneRange();
    }
  };

  // 恢复选区
  const restoreSelection = () => {
    if (savedSelection.current) {
      const ed = document.querySelector('.rich-editor');
      if (ed) {
        ed.focus();
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedSelection.current);
      }
    }
  };

  useEffect(() => { 
    saveToStorage(data); 
    // 防抖保存到云端
    if (user && !viewingSharedUser) {
      const timer = setTimeout(() => {
        saveToCloud(data);
      }, 2000); // 2秒防抖
      return () => clearTimeout(timer);
    }
  }, [data, user, viewingSharedUser]);
  useEffect(() => { saveLibrary(library); }, [library]);
  
  // 导入电子书处理
  const handleImportBook = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportLoading(true);
    try {
      let book;
      const ext = file.name.split('.').pop().toLowerCase();
      
      if (ext === 'txt') {
        const text = await file.text();
        book = parseTxtBook(text, file.name);
      } else if (ext === 'epub') {
        book = await parseEpubBook(file);
      } else {
        alert('不支持的文件格式，请选择txt或epub文件');
        setImportLoading(false);
        return;
      }
      
      setLibrary(prev => ({
        ...prev,
        books: [...prev.books, book]
      }));
      
      alert(`《${book.title}》导入成功！共${book.chapters.length}章`);
    } catch (err) {
      console.error('导入失败:', err);
      alert('导入失败: ' + err.message);
    }
    
    setImportLoading(false);
    e.target.value = '';
  };
  
  // 删除图书馆书籍（使用app内置弹窗）
  const handleDeleteLibraryBook = (bookId, bookTitle) => {
    setConfirmModal({
      isOpen: true,
      title: '删除书籍',
      message: `确定删除《${bookTitle}》吗？`,
      onConfirm: () => {
        setLibrary(prev => ({
          ...prev,
          books: prev.books.filter(b => b.id !== bookId)
        }));
        setConfirmModal({ isOpen: false });
      }
    });
  };
  
  // 打开图书馆书籍阅读（从书签位置开始）
  const openLibraryBook = (book) => {
    setLibraryBook(book);
    // 如果有书签，从书签位置开始
    if (book.bookmark) {
      setLibraryChapterIndex(book.bookmark.chapterIndex || 0);
    } else {
      setLibraryChapterIndex(0);
    }
    setShowLibraryReader(true);
  };
  
  // 切换书签
  const toggleLibraryBookmark = (chapterIndex, page) => {
    if (!libraryBook) return;
    
    const hasBookmark = libraryBook.bookmark !== null;
    const newBookmark = hasBookmark ? null : { chapterIndex, page };
    
    // 更新library
    setLibrary(prev => ({
      ...prev,
      books: prev.books.map(b => 
        b.id === libraryBook.id 
          ? { ...b, bookmark: newBookmark }
          : b
      )
    }));
    
    // 更新当前libraryBook
    setLibraryBook(prev => ({ ...prev, bookmark: newBookmark }));
  };
  
  // 关闭个人主页（带动画）
  const closeProfile = () => {
    setProfileClosing(true);
    setTimeout(() => {
      setShowProfile(false);
      setProfileClosing(false);
    }, 280);
  };
  
  const allTitlesMap = useMemo(() => collectAllLinkableTitles(data.books), [data.books]);
  
  // 全局搜索函数
  const performSearch = useCallback((query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    
    // 递归搜索词条，返回路径
    const searchInEntries = (entries, book, path = []) => {
      entries.forEach(entry => {
        const titleMatch = entry.title?.toLowerCase().includes(q);
        const summaryMatch = entry.summary?.toLowerCase().includes(q);
        const contentMatch = entry.content?.toLowerCase().includes(q);
        
        if (titleMatch || summaryMatch || contentMatch) {
          results.push({
            entry,
            book,
            path: [...path],
            matchType: titleMatch ? 'title' : summaryMatch ? 'summary' : 'content'
          });
        }
        
        if (entry.children?.length > 0) {
          searchInEntries(entry.children, book, [...path, entry]);
        }
      });
    };
    
    data.books.forEach(book => {
      searchInEntries(book.entries, book);
    });
    
    setSearchResults(results);
  }, [data.books]);
  
  // 点击搜索结果跳转
  const handleSearchResultClick = (result) => {
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    setCurrentBook(result.book);
    setNavigationStack(result.path);
    setCurrentEntry(result.entry);
    if (result.entry.isFolder || result.entry.children?.length > 0) {
      setViewMode('list');
    } else {
      setViewMode('single');
      setIsReadOnly(true);
    }
  };
  
  useEffect(() => { if (currentBook) { const u = data.books.find(b => b.id === currentBook.id); if (u && u !== currentBook) setCurrentBook(u); } }, [data.books]);
  useEffect(() => { if (currentEntry && currentBook) { const f = findEntryById(currentBook.entries, currentEntry.id); if (f && f !== currentEntry) setCurrentEntry(f); } }, [currentBook]);

  const saveContent = useCallback((html, eid = null, bid = null) => {
    const eId = eid || currentEntry?.id;
    const bId = bid || currentBook?.id;
    if (!eId || !bId) return;
    setData(prev => ({ ...prev, books: prev.books.map(b => b.id === bId ? { ...b, entries: updateEntryInTree(b.entries, eId, { content: html }) } : b) }));
  }, [currentEntry?.id, currentBook?.id]);

  const initMerged = useCallback((e) => { if (!e || !currentBook) return; setMergedContents(getAllChildContent(e, currentBook.entries).map(i => ({ id: i.id, title: i.title, content: i.content || '', isNew: false }))); }, [currentBook]);

  const handleLongPressStart = (e, type, item) => { 
    const t = e.touches ? e.touches[0] : e; 
    const pos = { x: t.clientX, y: t.clientY }; 
    longPressTimer.current = setTimeout(() => { 
      let opts = []; 
      if (type === 'entry') { 
        opts = [
          { icon: '✏️', label: '编辑信息', action: () => { setEditingEntry(item); setShowEntryModal(true); } }, 
          { icon: item.linkable ? '🚫' : '⭐', label: item.linkable ? '关闭跳转' : '开启跳转', action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, item.id, { linkable: !item.linkable }) } : b) })) }
        ];
        // 如果是文件夹，添加正文模式选项
        if (item.isFolder) {
          opts.push({ 
            icon: item.novelMode ? '📝' : '📖', 
            label: item.novelMode ? '关闭正文模式' : '开启正文模式', 
            action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, item.id, { novelMode: !item.novelMode }) } : b) })) 
          });
        }
        opts.push({ icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: `删除「${item.title}」？`, onConfirm: () => { setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: deleteEntryFromTree(b.entries, item.id) } : b) })); if (currentEntry?.id === item.id) handleBack(); setConfirmModal({ isOpen: false }); } }) });
      } else if (type === 'book') { 
        opts = [
          { icon: '✏️', label: '编辑', action: () => { setEditingBook(item); setShowBookModal(true); } }, 
          { icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: `删除「${item.title}」？`, onConfirm: () => { setData(prev => ({ ...prev, books: prev.books.filter(b => b.id !== item.id) })); setConfirmModal({ isOpen: false }); } }) }
        ]; 
      } 
      setContextMenu({ isOpen: true, position: pos, options: opts }); 
    }, 500); 
  };
  const handleLongPressEnd = () => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } };

  const handleBookSelect = (b) => { setCurrentBook(b); setCurrentEntry(null); setViewMode('list'); setNavigationStack([]); };
  const handleBackToShelf = () => { setSlideAnim('slide-out'); setTimeout(() => { setCurrentBook(null); setCurrentEntry(null); setViewMode('list'); setNavigationStack([]); setIsSidebarOpen(false); setIsReorderMode(false); setSlideAnim(''); }, 200); };
  const handleEntryClick = (e) => { 
    setSlideAnim('slide-in'); 
    setNavigationStack(prev => [...prev, currentEntry].filter(Boolean)); 
    setCurrentEntry(e); 
    if (e.isFolder || e.children?.length > 0) {
      // 如果是正文模式的文件夹，进入正文视图
      if (e.novelMode) {
        setViewMode('novel');
      } else {
        setViewMode('list');
      }
    } else { 
      setViewMode('single'); 
      setIsReadOnly(true); 
    } 
    setTimeout(() => setSlideAnim(''), 250); 
  };
  const handleBack = () => { 
    setSlideAnim('slide-out'); 
    setTimeout(() => { 
      if (navigationStack.length > 0) { 
        const last = navigationStack[navigationStack.length - 1]; 
        setNavigationStack(s => s.slice(0, -1)); 
        // 检查是否是跳转记录（包含 bookId）
        if (last.bookId) {
          const b = data.books.find(x => x.id === last.bookId);
          if (b) {
            setCurrentBook(b);
            setCurrentEntry(last.entry);
            setViewMode(last.viewMode || 'single');
          }
        } else {
          // 普通的父级导航
          setCurrentEntry(last); 
          setViewMode('list'); 
        }
      } else { 
        setCurrentEntry(null); 
        setViewMode('list'); 
      } 
      setSlideAnim(''); 
      setIsReorderMode(false); 
    }, 200); 
  };
  const handleSidebarSelect = (e) => { const p = findEntryPath(currentBook.entries, e.id); if (p) { setNavigationStack(p.slice(0, -1)); setCurrentEntry(e); if (e.isFolder || e.children?.length > 0) setViewMode('list'); else setViewMode('single'); } setIsSidebarOpen(false); };
  const handleLinkClick = useCallback((kw, tbid, teid) => { 
    // 把当前位置存入导航栈（包含完整信息以便返回）
    const jumpRecord = { bookId: currentBook.id, entry: currentEntry, viewMode };
    setNavigationStack(p => [...p, jumpRecord]); 
    
    const tb = data.books.find(b => b.id === tbid); 
    if (tb) { 
      setSlideAnim('slide-in'); 
      setCurrentBook(tb); 
      const path = findEntryPath(tb.entries, teid); 
      if (path) { 
        const te = path[path.length - 1]; 
        setCurrentEntry(te); 
        if (te.isFolder && te.linkable) { 
          setViewMode('merged'); 
          setTimeout(() => initMerged(te), 0); 
        } else if (te.isFolder) setViewMode('list'); 
        else setViewMode('single'); 
      } 
      setTimeout(() => setSlideAnim(''), 250); 
    } 
  }, [currentBook, currentEntry, viewMode, data.books, initMerged]);

  // 修改标题并同步更新所有【】引用
  const handleTitleChange = (entryId, oldTitle, newTitle) => {
    if (oldTitle === newTitle) return;
    
    // 递归更新所有词条内容中的【旧标题】为【新标题】
    const updateContentRefs = (entries) => {
      return entries.map(e => {
        let updated = { ...e };
        if (e.content && e.content.includes(`【${oldTitle}】`)) {
          updated.content = e.content.replaceAll(`【${oldTitle}】`, `【${newTitle}】`);
        }
        if (e.children?.length > 0) {
          updated.children = updateContentRefs(e.children);
        }
        return updated;
      });
    };
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => ({
        ...b,
        entries: updateContentRefs(updateEntryInTree(b.entries, entryId, { title: newTitle }))
      }))
    }));
  };
  
  // 修改简介
  const handleSummaryChange = (entryId, newSummary) => {
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, entryId, { summary: newSummary })
      } : b)
    }));
  };

  const handleMergedChange = (i, f, v) => { 
    const entry = mergedContents[i];
    if (f === 'content') {
      // 内容都需要保存
      saveContent(v, entry.id, currentBook.id); 
    } else if (f === 'title') {
      // 标题变更
      if (entry.isNew) {
        // 新词条：直接更新标题
        setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, entry.id, { title: v }) } : b) }));
      } else if (entry.title !== v) {
        // 已有词条：更新标题并同步所有【】引用
        handleTitleChange(entry.id, entry.title, v);
      }
    }
    // 更新本地状态，如果是新词条也要标记为非新
    setMergedContents(nc => nc.map((x, j) => j === i ? { ...x, [f]: v, isNew: false } : x)); 
  };
  const handleAddMerged = () => { const ne = { id: generateId(), title: '新词条', content: '', isNew: true }; setMergedContents(p => [...p, ne]); setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: addEntryToParent(b.entries, currentEntry.id, { ...ne, summary: '', isFolder: false, linkable: true, children: [] }) } : b) })); };
  const handleAddEntry = (d) => { const ne = { id: generateId(), title: d.title, summary: d.summary || '', content: '', isFolder: d.isFolder, linkable: !d.isFolder, children: d.isFolder ? [] : undefined }; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: addEntryToParent(b.entries, currentEntry?.id || null, ne) } : b) })); };
  const handleUpdateEntry = (d) => { if (!editingEntry) return; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, editingEntry.id, { title: d.title, summary: d.summary }) } : b) })); setEditingEntry(null); };
  
  const handleAddBook = ({ title, author, tags, emoji, coverImage, showStats }) => { if (editingBook) { const updatedBook = { ...editingBook, title, author, tags, cover: emoji, coverImage, showStats }; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === editingBook.id ? { ...b, title, author, tags, cover: emoji, coverImage, showStats } : b) })); if (currentBook?.id === editingBook.id) { setCurrentBook(prev => ({ ...prev, title, author, tags, cover: emoji, coverImage, showStats })); } setEditingBook(null); } else { const colors = ['#2D3047', '#1A1A2E', '#4A0E0E', '#0E4A2D', '#3D2E4A', '#4A3D0E']; setData(prev => ({ ...prev, books: [...prev.books, { id: generateId(), title, author, tags, cover: emoji, coverImage, showStats, color: colors[Math.floor(Math.random() * colors.length)], entries: [] }] })); } };
  const handleReorder = (fi, ti) => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: reorderEntriesInParent(b.entries, currentEntry?.id || null, fi, ti) } : b) }));

  const handleToggleFormat = (t) => {
    const ed = document.querySelector('.rich-editor');
    if (!ed) return;
    
    const sel = window.getSelection();
    const hasSelection = sel && sel.toString().length > 0;
    
    // 计算新的格式状态
    let newFormats;
    if (['small', 'medium', 'big', 'huge'].includes(t)) {
      newFormats = { ...activeFormats, size: t };
    } else {
      newFormats = { ...activeFormats, [t]: !activeFormats[t] };
    }
    
    ed.focus();
    
    if (hasSelection) {
      // 对选中文字应用格式
      if (t === 'bold') document.execCommand('bold', false, null);
      else if (t === 'italic') document.execCommand('italic', false, null);
      else if (t === 'underline') document.execCommand('underline', false, null);
      else if (t === 'strike') document.execCommand('strikeThrough', false, null);
      else if (t === 'small') document.execCommand('fontSize', false, '2');
      else if (t === 'medium') document.execCommand('fontSize', false, '3');
      else if (t === 'big') document.execCommand('fontSize', false, '5');
      else if (t === 'huge') document.execCommand('fontSize', false, '7');
    } else {
      // 没有选中文字时，插入带完整样式声明的零宽字符
      // 关键：总是声明所有样式属性，不依赖继承
      let styles = [];
      
      // 字重
      styles.push(newFormats.bold ? 'font-weight:bold' : 'font-weight:normal');
      // 斜体
      styles.push(newFormats.italic ? 'font-style:italic' : 'font-style:normal');
      // 装饰线（下划线+删除线）
      let decorations = [];
      if (newFormats.underline) decorations.push('underline');
      if (newFormats.strike) decorations.push('line-through');
      styles.push('text-decoration:' + (decorations.length > 0 ? decorations.join(' ') : 'none'));
      // 字号
      if (newFormats.size === 'small') styles.push('font-size:12px');
      else if (newFormats.size === 'big') styles.push('font-size:24px');
      else if (newFormats.size === 'huge') styles.push('font-size:32px');
      else styles.push('font-size:16px');
      
      const html = `<span style="${styles.join(';')}">\u200B</span>`;
      document.execCommand('insertHTML', false, html);
    }
    
    ed.forceSave?.();
    setActiveFormats(newFormats);
  };
  const handleAlign = (c) => { const ed = document.querySelector('.rich-editor'); if (ed) { ed.focus(); document.execCommand(c, false, null); ed.forceSave?.(); } };
  const handleIndent = () => { 
    const ed = document.querySelector('.rich-editor'); 
    if (!ed) return; 
    ed.querySelectorAll('p').forEach(p => { 
      // 检查纯文本是否已经有缩进
      if (p.textContent && !p.textContent.startsWith('　　')) {
        // 在段落开头插入两个全角空格，保留原有HTML结构
        const indent = document.createTextNode('　　');
        p.insertBefore(indent, p.firstChild);
      }
    }); 
    ed.forceSave?.(); 
  };
  const handleImageUpload = async (e) => { const f = e.target.files[0]; if (f) { const c = await compressImage(f, 600); const ed = document.querySelector('.rich-editor'); if (ed) { ed.focus(); document.execCommand('insertHTML', false, `<p style="text-align:center"><img src="${c}" style="max-width:100%;border-radius:8px" /></p>`); ed.forceSave?.(); } } e.target.value = ''; };
  const handleEntrySwipe = (e, dx) => { if (dx < -80 && (e.isFolder || e.children?.length > 0)) { setSlideAnim('slide-in'); setNavigationStack(p => [...p, currentEntry].filter(Boolean)); setCurrentEntry(e); setViewMode('merged'); setTimeout(() => initMerged(e), 50); setTimeout(() => setSlideAnim(''), 250); } };

  // 点击图片，弹出删除确认
  const handleImageClick = (imgElement) => {
    setImageToDelete(imgElement);
    setConfirmModal({
      isOpen: true,
      title: '删除图片',
      message: '确定要删除这张图片吗？',
      onConfirm: () => {
        if (imgElement) {
          const parent = imgElement.parentElement;
          if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
            parent.remove();
          } else {
            imgElement.remove();
          }
          // 保存
          const ed = document.querySelector('.rich-editor');
          if (ed) ed.forceSave?.();
        }
        setImageToDelete(null);
        setConfirmModal({ isOpen: false });
      }
    });
  };

  // ========== 画廊功能 ==========
  
  // 开启/关闭画廊
  const toggleGallery = () => {
    if (!currentBook) return;
    const newGallery = currentBook.gallery ? { ...currentBook.gallery, enabled: !currentBook.gallery.enabled } : { enabled: true, images: [] };
    const updatedBook = { ...currentBook, gallery: newGallery };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };

  // ============ 正文模式函数（基于分类） ============
  
  // 移动章节到分卷
  const handleMoveNovelChapter = (chapter, fromVolumeId, toVolumeId) => {
    if (!currentBook || !currentEntry) return;
    if (fromVolumeId === toVolumeId) return; // 没有变化
    
    // 深拷贝entries
    const cloneEntries = JSON.parse(JSON.stringify(currentBook.entries));
    
    // 找到currentEntry
    const findAndUpdate = (entries, targetId, updateFn) => {
      return entries.map(e => {
        if (e.id === targetId) {
          return updateFn(e);
        }
        if (e.children?.length) {
          return { ...e, children: findAndUpdate(e.children, targetId, updateFn) };
        }
        return e;
      });
    };
    
    // 更新当前正文分类
    const updatedEntries = findAndUpdate(cloneEntries, currentEntry.id, (novelEntry) => {
      let newChildren = [...(novelEntry.children || [])];
      
      // 1. 从原位置移除章节
      if (fromVolumeId) {
        // 从分卷中移除
        newChildren = newChildren.map(child => {
          if (child.id === fromVolumeId && child.isFolder) {
            return {
              ...child,
              children: (child.children || []).filter(ch => ch.id !== chapter.id)
            };
          }
          return child;
        });
      } else {
        // 从独立章节中移除
        newChildren = newChildren.filter(ch => ch.id !== chapter.id);
      }
      
      // 2. 添加到新位置
      if (toVolumeId) {
        // 添加到分卷
        newChildren = newChildren.map(child => {
          if (child.id === toVolumeId && child.isFolder) {
            return {
              ...child,
              children: [...(child.children || []), chapter]
            };
          }
          return child;
        });
      } else {
        // 添加到独立章节
        newChildren.push(chapter);
      }
      
      return { ...novelEntry, children: newChildren };
    });
    
    const updatedBook = { ...currentBook, entries: updatedEntries };
    setCurrentBook(updatedBook);
    const updatedCurrentEntry = findEntryById(updatedEntries, currentEntry.id);
    if (updatedCurrentEntry) setCurrentEntry(updatedCurrentEntry);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };
  
  // 保存novel编辑（新建/编辑 章节/分卷）
  const handleSaveNovelEdit = (item) => {
    if (!currentBook || !currentEntry) return;
    
    if (novelEditItem) {
      // 编辑现有项目
      const updatedEntries = updateEntryInTree(currentBook.entries, novelEditItem.id, { title: item.title });
      const updatedBook = { ...currentBook, entries: updatedEntries };
      setCurrentBook(updatedBook);
      // 更新currentEntry如果需要
      const updatedCurrentEntry = findEntryById(updatedEntries, currentEntry.id);
      if (updatedCurrentEntry) setCurrentEntry(updatedCurrentEntry);
      setData(prev => ({
        ...prev,
        books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
      }));
    } else {
      // 新建
      const newEntry = {
        id: generateId(),
        title: item.title,
        summary: '',
        content: '',
        isFolder: novelEditType === 'volume',
        linkable: false,
        children: []
      };
      const updatedEntries = addEntryToParent(currentBook.entries, currentEntry.id, newEntry);
      const updatedBook = { ...currentBook, entries: updatedEntries };
      setCurrentBook(updatedBook);
      // 更新currentEntry
      const updatedCurrentEntry = findEntryById(updatedEntries, currentEntry.id);
      if (updatedCurrentEntry) setCurrentEntry(updatedCurrentEntry);
      setData(prev => ({
        ...prev,
        books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
      }));
    }
    setShowNovelEditModal(false);
  };

  // 旧的正文模式函数（保留兼容）
  const handleAddStoryVolume = () => {
    setStoryEditType('volume');
    setStoryEditItem(null);
    setShowStoryEditModal(true);
  };

  const handleAddStoryChapter = () => {
    // 如果没有分卷，先创建一个默认分卷
    if (!currentBook.storyMode?.volumes?.length) {
      const defaultVolume = { id: generateId(), title: '正文', chapters: [] };
      const newStoryMode = { 
        ...currentBook.storyMode, 
        volumes: [defaultVolume] 
      };
      const updatedBook = { ...currentBook, storyMode: newStoryMode };
      setCurrentBook(updatedBook);
      setData(prev => ({
        ...prev,
        books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
      }));
    }
    setStoryEditType('chapter');
    setStoryEditItem(null);
    setStoryEditVolId(currentBook.storyMode?.volumes?.[0]?.id || null);
    setShowStoryEditModal(true);
  };

  const handleSaveStoryEdit = (item) => {
    if (!currentBook) return;
    
    let updatedVolumes = [...(currentBook.storyMode?.volumes || [])];
    
    if (storyEditType === 'volume') {
      if (storyEditItem) {
        // 编辑分卷
        updatedVolumes = updatedVolumes.map(v => v.id === item.id ? { ...v, title: item.title } : v);
      } else {
        // 新建分卷
        updatedVolumes.push({ id: generateId(), title: item.title, chapters: [] });
      }
    } else {
      // 章节
      if (storyEditItem) {
        // 编辑章节
        updatedVolumes = updatedVolumes.map(v => 
          v.id === storyEditVolId 
            ? { ...v, chapters: v.chapters.map(c => c.id === item.id ? { ...c, title: item.title } : c) }
            : v
        );
      } else {
        // 新建章节 - 添加到第一个分卷或指定分卷
        const targetVolId = storyEditVolId || updatedVolumes[0]?.id;
        if (targetVolId) {
          const newChapter = { id: generateId(), title: item.title, content: '', wordCount: 0 };
          updatedVolumes = updatedVolumes.map(v => 
            v.id === targetVolId 
              ? { ...v, chapters: [...v.chapters, newChapter] }
              : v
          );
          // 打开编辑器
          setCurrentStoryVolume(targetVolId);
          setCurrentStoryChapter(newChapter);
          setShowStoryEditModal(false);
          setShowStoryChapterEditor(true);
          
          // 先保存
          const newStoryMode = { ...currentBook.storyMode, volumes: updatedVolumes };
          const updatedBook = { ...currentBook, storyMode: newStoryMode };
          setCurrentBook(updatedBook);
          setData(prev => ({
            ...prev,
            books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
          }));
          return;
        }
      }
    }
    
    const newStoryMode = { ...currentBook.storyMode, volumes: updatedVolumes };
    const updatedBook = { ...currentBook, storyMode: newStoryMode };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };

  const handleEditStoryChapter = (volId, chapter) => {
    setStoryEditType('chapter');
    setStoryEditItem(chapter);
    setStoryEditVolId(volId);
    setShowStoryEditModal(true);
  };

  const handleEditStoryVolume = (volume) => {
    setStoryEditType('volume');
    setStoryEditItem(volume);
    setShowStoryEditModal(true);
  };

  const handleDeleteStoryChapter = (volId, chapterId) => {
    if (!currentBook) return;
    const updatedVolumes = currentBook.storyMode.volumes.map(v => 
      v.id === volId 
        ? { ...v, chapters: v.chapters.filter(c => c.id !== chapterId) }
        : v
    );
    const newStoryMode = { ...currentBook.storyMode, volumes: updatedVolumes };
    const updatedBook = { ...currentBook, storyMode: newStoryMode };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };

  const handleDeleteStoryVolume = (volId) => {
    if (!currentBook) return;
    const updatedVolumes = currentBook.storyMode.volumes.filter(v => v.id !== volId);
    const newStoryMode = { ...currentBook.storyMode, volumes: updatedVolumes };
    const updatedBook = { ...currentBook, storyMode: newStoryMode };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };

  const handleSelectStoryChapter = (volId, chapterId) => {
    const volume = currentBook.storyMode?.volumes?.find(v => v.id === volId);
    const chapter = volume?.chapters?.find(c => c.id === chapterId);
    if (chapter) {
      setCurrentStoryVolume(volId);
      setCurrentStoryChapter(chapter);
      setShowStoryReader(true);
    }
  };

  const handleSaveStoryChapter = (volId, chapter) => {
    if (!currentBook) return;
    const updatedVolumes = currentBook.storyMode.volumes.map(v => 
      v.id === volId 
        ? { ...v, chapters: v.chapters.map(c => c.id === chapter.id ? chapter : c) }
        : v
    );
    const newStoryMode = { ...currentBook.storyMode, volumes: updatedVolumes };
    const updatedBook = { ...currentBook, storyMode: newStoryMode };
    setCurrentBook(updatedBook);
    setCurrentStoryChapter(chapter);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
  };

  const handleToggleStoryVolume = (volId) => {
    setStoryCollapsedVolumes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(volId)) {
        newSet.delete(volId);
      } else {
        newSet.add(volId);
      }
      return newSet;
    });
  };

  const handleStoryChapterChange = (volId, chapterId) => {
    const volume = currentBook.storyMode?.volumes?.find(v => v.id === volId);
    const chapter = volume?.chapters?.find(c => c.id === chapterId);
    if (chapter) {
      setCurrentStoryVolume(volId);
      setCurrentStoryChapter(chapter);
    }
  };
  // ============ 正文模式函数结束 ============

  // 上传图片到画廊
  const uploadGalleryImage = async (e) => {
    const files = e.target.files;
    if (!files || !currentBook) return;
    
    const currentImages = currentBook.gallery?.images || [];
    const currentFeaturedCount = currentImages.filter(img => img.featured).length;
    
    const newImages = [];
    for (let i = 0; i < files.length; i++) {
      const compressed = await compressImage(files[i], 800);
      // 前6张自动featured，之后的不自动
      const shouldFeatured = (currentImages.length + i) < 6 && (currentFeaturedCount + newImages.filter(img => img.featured).length) < 6;
      newImages.push({
        id: generateId(),
        src: compressed,
        featured: shouldFeatured
      });
    }
    
    const updatedGallery = {
      ...currentBook.gallery,
      images: [...currentImages, ...newImages]
    };
    const updatedBook = { ...currentBook, gallery: updatedGallery };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
    
    e.target.value = '';
  };

  // 删除画廊图片
  const deleteGalleryImage = (imageId) => {
    setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } });
    setGalleryConfirmModal({
      isOpen: true,
      title: '删除图片',
      message: '确定要删除这张图片吗？',
      onConfirm: () => {
        const updatedGallery = {
          ...currentBook.gallery,
          images: currentBook.gallery.images.filter(img => img.id !== imageId)
        };
        const updatedBook = { ...currentBook, gallery: updatedGallery };
        setCurrentBook(updatedBook);
        setData(prev => ({
          ...prev,
          books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
        }));
        setGalleryConfirmModal({ isOpen: false });
      }
    });
  };

  // 切换精选状态
  const toggleFeatured = (imageId) => {
    const currentImages = currentBook.gallery.images;
    const targetImage = currentImages.find(img => img.id === imageId);
    const currentFeaturedCount = currentImages.filter(img => img.featured).length;
    
    // 如果要设为featured，检查是否已达上限
    if (!targetImage.featured && currentFeaturedCount >= 6) {
      alert('最多只能展示6张图片');
      setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } });
      return;
    }
    
    const updatedGallery = {
      ...currentBook.gallery,
      images: currentImages.map(img => img.id === imageId ? { ...img, featured: !img.featured } : img)
    };
    const updatedBook = { ...currentBook, gallery: updatedGallery };
    setCurrentBook(updatedBook);
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b)
    }));
    setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } });
  };

  // 画廊图片长按
  const handleGalleryImageLongPress = (e, image) => {
    const t = e.touches ? e.touches[0] : e;
    const pos = { x: t.clientX, y: t.clientY };
    if (navigator.vibrate) navigator.vibrate(30);
    setGalleryContextMenu({ isOpen: true, image, position: pos });
  };

  // 打开画廊大图预览
  const openGalleryPreview = (image) => {
    const images = currentBook?.gallery?.images || [];
    const index = images.findIndex(img => img.id === image.id);
    setGalleryViewIndex(index >= 0 ? index : 0);
    setGalleryViewScale(1);
    setGalleryViewPos({ x: 0, y: 0 });
    setGalleryAnimating(true);
    setGalleryPreviewImage(image);
    setTimeout(() => setGalleryAnimating(false), 300);
  };

  // 关闭画廊大图预览
  const closeGalleryPreview = () => {
    setGalleryPreviewImage(null);
    setGalleryViewScale(1);
    setGalleryViewPos({ x: 0, y: 0 });
    setGalleryDragX(0);
    setGalleryViewerMenu(false);
  };

  // 保存用户名
  const saveUserName = (name) => {
    setUserName(name);
    localStorage.setItem('userName', name);
  };

  // 上传头像
  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setUserAvatar(dataUrl);
      localStorage.setItem('userAvatar', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // 上传背景图
  const handleBgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setUserBg(dataUrl);
      localStorage.setItem('userBg', dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // 保存简介
  const saveUserBio = (bio) => {
    setUserBio(bio);
    localStorage.setItem('userBio', bio);
  };

  // 统计数据
  const totalStats = useMemo(() => {
    let totalWords = 0;
    let totalEntries = 0;
    let totalImages = 0;
    data.books.forEach(b => {
      totalWords += countWords(b.entries);
      totalEntries += countEntries(b.entries);
      totalImages += b.gallery?.images?.length || 0;
    });
    return { books: data.books.length, entries: totalEntries, words: totalWords, images: totalImages };
  }, [data.books]);

  // 长按内容区域显示导出菜单
  const handleContentLongPressStart = (e) => {
    if (!isReadOnly) return;
    const t = e.touches ? e.touches[0] : e;
    const pos = { x: t.clientX, y: t.clientY };
    contentLongPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setExportMenuPos(pos);
      setShowExportMenu(true);
    }, 500);
  };
  const handleContentLongPressEnd = () => {
    if (contentLongPressTimer.current) {
      clearTimeout(contentLongPressTimer.current);
      contentLongPressTimer.current = null;
    }
  };

  // 导出长图功能
  const handleExportImage = async () => {
    setShowExportMenu(false);
    const el = exportRef.current;
    if (!el) return;
    
    // 动态加载 html2canvas
    try {
      if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
        
        await new Promise(r => setTimeout(r, 100));
      }
      
      // 临时添加导出样式
      el.style.background = '#fff';
      el.style.borderRadius = '16px';
      el.style.padding = '24px 20px';
      el.style.boxShadow = '0 4px 20px rgba(45,48,71,.1)';
      
      const canvas = await window.html2canvas(el, {
        backgroundColor: '#f5f0e8',
        scale: 2,
        useCORS: true,
        logging: false,
        x: -16,
        y: -16,
        width: el.offsetWidth + 32,
        height: el.offsetHeight + 32
      });
      
      // 移除临时样式
      el.style.background = '';
      el.style.borderRadius = '';
      el.style.padding = '';
      el.style.boxShadow = '';
      
      const link = document.createElement('a');
      link.download = `${currentEntry?.title || '词条'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败，请稍后重试');
    }
  };

  const currentEntries = currentEntry?.children || currentBook?.entries || [];
  
  // 从最新数据中获取当前 entry（确保排序等更新后能同步）
  const liveEntry = currentEntry ? findEntryById(currentBook?.entries || [], currentEntry.id) || currentEntry : null;
  const liveChildContent = liveEntry ? getAllChildContent(liveEntry, currentBook?.entries || []) : [];
  
  const isEditing = !isReadOnly && (viewMode === 'single' || viewMode === 'merged');
  const hasActiveFormat = activeFormats.bold || activeFormats.italic || activeFormats.underline || activeFormats.strike || activeFormats.size !== 'medium';

  if (!currentBook) {
  // 将书籍分页，每页4本
  const booksPerPage = 4;
  const allBooks = [...data.books, { id: 'add-new', isAddButton: true }];
  const totalPages = Math.ceil(allBooks.length / booksPerPage);
  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push(allBooks.slice(i * booksPerPage, (i + 1) * booksPerPage));
  }
  
  return (<div className="app bookshelf-view"><div className="shelf-globe-bg" style={{ transform: `translateX(-50%) translateY(${-shelfOverscroll}px)`, transition: shelfOverscroll === 0 ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none' }} onClick={() => setShowProfile(true)} /><header className="bookshelf-header"><h1>一页穹顶</h1><p className="subtitle">拾起每一颗星星</p><p className="subtitle">便能拥有属于你的宇宙</p><button className="search-star" onClick={() => setShowSearch(true)}>⭐</button></header><div className="bookshelf-carousel" ref={shelfRef} onScroll={(e) => {
    const el = e.target;
    const pageIndex = Math.round(el.scrollLeft / el.clientWidth);
    setShelfPage(pageIndex);
  }} onTouchStart={(e) => {
    shelfTouchStart.current = { y: e.touches[0].clientY };
  }} onTouchMove={(e) => {
    const dy = shelfTouchStart.current.y - e.touches[0].clientY;
    if (dy > 0) {
      const pull = Math.min(dy * 0.3, 80);
      setShelfOverscroll(pull);
    }
  }} onTouchEnd={() => {
    if (shelfOverscroll >= 50) {
      setShowProfile(true);
    }
    setShelfOverscroll(0);
  }}>{pages.map((pageBooks, pageIndex) => (<div key={pageIndex} className="bookshelf-page"><div className="bookshelf-grid">{pageBooks.map(b => b.isAddButton ? (<div key="add" className="book-card add-book" onClick={() => { setEditingBook(null); setShowBookModal(true); }}><div className="book-cover"><span className="add-icon">+</span></div><div className="book-meta"><h2>新建世界</h2></div></div>) : (<div key={b.id} className="book-card" style={{ '--book-color': b.color }} onClick={() => handleBookSelect(b)} onTouchStart={e => { e.stopPropagation(); handleLongPressStart(e, 'book', b); }} onTouchEnd={handleLongPressEnd} onTouchMove={handleLongPressEnd}><div className="book-spine" /><div className="book-cover">{b.coverImage ? <img src={b.coverImage} alt="" className="cover-image" /> : <span className="book-emoji">{b.cover}</span>}</div><div className="book-shadow" /><div className="book-meta"><h2>{b.title}</h2>{b.author && <p>{b.author} 著</p>}</div></div>))}</div></div>))}</div>{totalPages > 1 && (<div className="shelf-page-dots">{pages.map((_, i) => (<span key={i} className={`shelf-dot ${shelfPage === i ? 'active' : ''}`} onClick={() => { shelfRef.current?.scrollTo({ left: i * shelfRef.current.clientWidth, behavior: 'smooth' }); }} />))}</div>)}<BookModal isOpen={showBookModal} onClose={() => { setShowBookModal(false); setEditingBook(null); }} onSave={handleAddBook} editingBook={editingBook} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /><SearchModal isOpen={showSearch} onClose={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} query={searchQuery} setQuery={setSearchQuery} results={searchResults} onSearch={performSearch} onResultClick={handleSearchResultClick} />{showProfile && (<div className={`profile-page ${profileClosing ? 'closing' : ''}`} style={userBg ? { backgroundImage: `url(${userBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}><div className="profile-bg-overlay" /><div className="profile-header"><button className="profile-close" onClick={closeProfile}>×</button><div className="profile-avatar" onClick={() => avatarUploadRef.current?.click()}>{userAvatar ? <img src={userAvatar} alt="" /> : '✨'}</div><input ref={avatarUploadRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} /><input type="text" className="profile-name" value={userName} onChange={e => saveUserName(e.target.value)} placeholder="点击编辑名字" /><textarea className="profile-bio" value={userBio} onChange={e => saveUserBio(e.target.value)} placeholder="写一句简介..." rows={2} /></div><div className="profile-stats"><div className="stat-item"><span className="stat-number">{totalStats.books}</span><span className="stat-label">作品</span></div><div className="stat-item"><span className="stat-number">{totalStats.entries}</span><span className="stat-label">词条</span></div><div className="stat-item"><span className="stat-number">{totalStats.words.toLocaleString()}</span><span className="stat-label">总字数</span></div></div><div className="profile-menu"><div className="profile-menu-item" onClick={closeProfile}><span>📚</span><span>我的书架</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => { closeProfile(); setTimeout(() => setShowLibrary(true), 300); }}><span>📖</span><span>图书馆 ({library.books.length})</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => setShowTotalGallery(true)}><span>🖼️</span><span>画廊 ({totalStats.images})</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => bgUploadRef.current?.click()}><span>🎨</span><span>更换背景</span><span className="menu-arrow">›</span></div><input ref={bgUploadRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} /><div className="profile-menu-item" onClick={() => setShowSettings(true)}><span>⚙️</span><span>设置</span><span className="menu-arrow">›</span></div><div className="profile-menu-item"><span>💡</span><span>关于一页穹顶</span><span className="menu-arrow">›</span></div></div><div className="profile-account-status">{user ? (<div className="logged-in"><span className="sync-indicator" data-status={syncStatus}></span><span>{user.email}</span></div>) : (<button className="login-btn" onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}>登录 / 注册</button>)}</div><div className="profile-footer"><p>一页穹顶 v1.0</p><p>拾起每一颗星星，便能拥有属于你的宇宙</p></div></div>)}{showTotalGallery && (<div className="total-gallery-page"><div className="gallery-header"><button className="gallery-back" onClick={() => setShowTotalGallery(false)}>← 返回</button><h2>画廊</h2><span></span></div><div className="total-gallery-list">{data.books.filter(b => b.gallery?.enabled).map(book => (<div key={book.id} className="total-gallery-book"><div className="total-gallery-book-header" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><span className="book-icon">{book.coverImage ? <img src={book.coverImage} alt="" /> : book.cover}</span><span className="book-title">{book.title}</span><span className="book-count">{book.gallery.images?.length || 0}张</span></div><div className="total-gallery-book-images">{book.gallery.images?.slice(0, 3).map(img => (<div key={img.id} className="total-gallery-thumb" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><img src={img.src} alt="" /></div>))}<label className="total-gallery-add-btn"><input type="file" accept="image/*" multiple onChange={(e) => { const files = e.target.files; if (!files?.length) return; Array.from(files).forEach(file => { const reader = new FileReader(); reader.onload = (ev) => { const newImg = { id: Date.now().toString() + Math.random(), src: ev.target.result, featured: false }; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === book.id ? { ...b, gallery: { ...b.gallery, images: [...(b.gallery.images || []), newImg] } } : b) })); }; reader.readAsDataURL(file); }); e.target.value = ''; }} style={{ display: 'none' }} /><span>+</span></label></div></div>))}{data.books.filter(b => b.gallery?.enabled).length === 0 && (<div className="gallery-empty"><span>🖼️</span><p>还没有任何画廊</p><p>在书籍中开启画廊功能</p></div>)}</div></div>)}{showLibrary && (<div className="library-page"><div className="library-header"><button className="library-back" onClick={() => setShowLibrary(false)}>← 返回</button><h2>图书馆</h2><label className="library-import-btn">{importLoading ? '导入中...' : '📥 导入'}<input ref={libraryUploadRef} type="file" accept=".txt,.epub" onChange={handleImportBook} style={{ display: 'none' }} disabled={importLoading} /></label></div><div className="library-hint">支持导入 txt、epub 格式的电子书</div><div className="library-list">{library.books.map(book => (<div key={book.id} className="library-book-item"><div className="library-book-cover">{book.type === 'epub' ? '📕' : '📄'}{book.bookmark && <span className="library-bookmark-badge">🔖</span>}</div><div className="library-book-info" onClick={() => openLibraryBook(book)}><h3>{book.title}</h3><p>{book.author} · {book.chapters.length}章</p><p className="library-book-time">{new Date(book.importTime).toLocaleDateString()}{book.bookmark && ` · 已读至第${book.bookmark.chapterIndex + 1}章`}</p></div><button className="library-book-delete" onClick={(e) => { e.stopPropagation(); handleDeleteLibraryBook(book.id, book.title); }}>🗑️</button></div>))}{library.books.length === 0 && (<div className="library-empty"><span>📚</span><p>图书馆空空如也</p><p>点击右上角导入电子书</p></div>)}</div><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /></div>)}{showLibraryReader && libraryBook && (<StoryReader book={{ title: libraryBook.title }} chapter={libraryBook.chapters[libraryChapterIndex]} novelModeEntry={null} allChapters={libraryBook.chapters} currentChapterIndex={libraryChapterIndex} onClose={() => setShowLibraryReader(false)} onChangeChapter={(ch) => { const idx = libraryBook.chapters.findIndex(c => c.id === ch.id); if (idx >= 0) setLibraryChapterIndex(idx); }} onEdit={() => {}} settings={storySettings} onChangeSettings={setStorySettings} isLibraryMode={true} isBookmarked={libraryBook.bookmark !== null} onToggleBookmark={toggleLibraryBookmark} initialPage={libraryBook.bookmark?.page || 0} />)}<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} mode={authMode} setMode={setAuthMode} /><SettingsPage isOpen={showSettings} onClose={() => setShowSettings(false)} user={user} onLogout={async () => { await supabase.auth.signOut(); setShowSettings(false); }} myInviteCode={myInviteCode} onGenerateCode={generateInviteCode} syncStatus={syncStatus} lastSyncTime={lastSyncTime} onSyncNow={() => { saveToCloud(data); }} />{(() => { window.useInviteCodeFn = useInviteCode; return null; })()}<style>{styles}</style></div>);
}

  return (<div className="app main-view"><div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}><div className="sidebar-header"><h2>{currentBook.title}</h2><button className="close-sidebar" onClick={() => setIsSidebarOpen(false)}>×</button></div><div className="sidebar-content">{currentBook.entries.map(e => <SidebarItem key={e.id} entry={e} onSelect={handleSidebarSelect} currentId={currentEntry?.id} expandedIds={expandedIds} onToggle={id => setExpandedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} />)}</div></div>{isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}<div className="main-content" onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }} onTouchEnd={e => { const dx = e.changedTouches[0].clientX - touchStartX.current; if (dx > 80) { if (currentEntry || navigationStack.length > 0) { handleBack(); } else { handleBackToShelf(); } } }}><header className="top-bar"><div className="top-left"><button className="icon-btn" onClick={() => setIsSidebarOpen(true)}>☰</button>{(currentEntry || navigationStack.length > 0) && <button className="icon-btn" onClick={handleBack}>←</button>}<button className="icon-btn" onClick={handleBackToShelf}>🏠</button></div><div className="breadcrumb"><span className="book-name">{currentBook.title}</span>{currentEntry && <><span className="separator">/</span><span className="current-title">{currentEntry.title}</span></>}</div><div className="top-right">{(viewMode === 'single' || viewMode === 'merged') && (<div className="read-mode-toggle" onClick={() => { if (!isReadOnly) { const ed = document.querySelector('.rich-editor'); if (ed) ed.forceSave?.(); } else if (viewMode === 'merged' && liveEntry) { initMerged(liveEntry); } setIsReadOnly(!isReadOnly); }}><span className={`toggle-label ${isReadOnly ? 'active' : ''}`}>阅读</span><div className={`toggle-switch ${!isReadOnly ? 'edit-mode' : ''}`}><div className="toggle-knob" /></div><span className={`toggle-label ${!isReadOnly ? 'active' : ''}`}>编辑</span></div>)}</div></header>{!currentEntry && currentBook.showStats && (<div className="book-info-card" onClick={() => { setEditingBook(currentBook); setShowBookModal(true); }}><div className="info-cover">{currentBook.coverImage ? <img src={currentBook.coverImage} alt="" /> : <span>{currentBook.cover}</span>}</div><div className="info-details">{currentBook.author && <p>作者：{currentBook.author}</p>}{currentBook.tags?.length > 0 && <p>标签：{currentBook.tags.join('、')}</p>}<p>词条：{countEntries(currentBook.entries)}条</p><p>字数：{countWords(currentBook.entries).toLocaleString()}字</p></div><span className="info-edit-hint">点击编辑 ›</span></div>)}{!currentEntry && currentBook.gallery?.enabled && (<div className="gallery-preview-strip"><div className="gallery-preview-scroll">{currentBook.gallery.images?.filter(img => img.featured).map(img => (<div key={img.id} className="gallery-strip-item" onClick={() => openGalleryPreview(img)}><img src={img.src} alt="" /></div>))}{(!currentBook.gallery.images?.filter(img => img.featured).length) && (<div className="gallery-strip-empty" onClick={() => setShowGallery(true)}><span>+</span><p>添加展示图片</p></div>)}</div><button className="gallery-enter-btn" onClick={() => setShowGallery(true)}>进入画廊 ›</button></div>)}<main className={`content-area ${slideAnim}`}>{viewMode === 'list' && !isReorderMode && (<>{currentEntry && <div className="list-header"><h1>{currentEntry.title}</h1>{currentEntry.summary && <p className="summary">{currentEntry.summary}</p>}</div>}<p className="swipe-hint">💡 左滑合并视图 · 右滑返回 · 长按编辑</p><div className="entry-list">{currentEntries.map(e => { let tx = 0; return (<div key={e.id} className="entry-card" onClick={() => handleEntryClick(e)} onTouchStart={ev => { tx = ev.touches[0].clientX; handleLongPressStart(ev, 'entry', e); }} onTouchMove={handleLongPressEnd} onTouchEnd={ev => { handleLongPressEnd(); handleEntrySwipe(e, ev.changedTouches[0].clientX - tx); }}><div className="entry-icon">{e.novelMode ? '📖' : e.isFolder ? '📁' : '📄'}</div><div className="entry-info"><h3>{e.title}{e.linkable && <span className="star-badge">⭐</span>}{e.novelMode && <span className="novel-badge">正文</span>}</h3><p>{e.summary}</p></div><span className="entry-arrow">›</span></div>); })}</div>{currentEntries.length === 0 && <div className="empty-state"><span>✨</span><p>点击右下角添加</p></div>}</>)}{viewMode === 'list' && isReorderMode && <ReorderList entries={currentEntries} onReorder={handleReorder} onExit={() => setIsReorderMode(false)} />}{viewMode === 'single' && liveEntry && (<div className="single-view"><div className="export-content" ref={exportRef}><div className="content-header">{isReadOnly ? <h1>{liveEntry.title}</h1> : <input type="text" className="editable-title" defaultValue={liveEntry.title} onBlur={ev => handleTitleChange(liveEntry.id, liveEntry.title, ev.target.value)} key={currentEntry.id + '-title'} />}{isReadOnly ? (liveEntry.summary && <p className="entry-summary">{liveEntry.summary}</p>) : <input type="text" className="editable-summary" defaultValue={liveEntry.summary || ''} placeholder="添加简介..." onBlur={ev => handleSummaryChange(liveEntry.id, ev.target.value)} key={currentEntry.id + '-summary'} />}</div><div onTouchStart={isReadOnly ? handleContentLongPressStart : undefined} onTouchEnd={isReadOnly ? handleContentLongPressEnd : undefined} onTouchMove={isReadOnly ? handleContentLongPressEnd : undefined}>{isReadOnly ? <ContentRenderer content={liveEntry.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} /> : <RichEditor key={currentEntry.id} content={liveEntry.content} onSave={html => saveContent(html)} fontFamily={currentFont} onImageClick={handleImageClick} onResetFormats={() => setActiveFormats({ bold: false, italic: false, underline: false, strike: false, size: 'medium' })} />}</div></div><div className="word-count">{countSingleEntryWords(liveEntry.content).toLocaleString()} 字</div></div>)}{viewMode === 'merged' && currentEntry && (<div className="merged-view">{isReadOnly ? (<div ref={exportRef}><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-read" onTouchStart={handleContentLongPressStart} onTouchEnd={handleContentLongPressEnd} onTouchMove={handleContentLongPressEnd}>{liveChildContent.map((it, i, arr) => (<div key={it.id} className="merged-section"><div className="section-title">• {it.title}</div><ContentRenderer content={it.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} />{i < arr.length - 1 && <div className="section-divider" />}</div>))}</div></div>) : (<><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-edit">{mergedContents.map((it, i) => (<div key={it.id} className="merged-edit-section"><div className="merged-edit-header">• <input type="text" className="merged-title-input" defaultValue={it.title} onBlur={ev => handleMergedChange(i, 'title', ev.target.value)} key={it.id + '-title'} /></div><div className="merged-editor-wrap" contentEditable dangerouslySetInnerHTML={{ __html: it.content }} onBlur={ev => handleMergedChange(i, 'content', ev.target.innerHTML)} onPaste={ev => { ev.preventDefault(); const text = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }} style={{ fontFamily: currentFont }} /></div>))}<button className="add-merged-entry-btn" onClick={handleAddMerged}>+ 添加词条</button></div></>)}<div className="word-count">{liveChildContent.reduce((sum, it) => sum + countSingleEntryWords(it.content), 0).toLocaleString()} 字</div></div>)}{viewMode === 'novel' && liveEntry && (
  <NovelTocView 
    entry={liveEntry}
    onSelectChapter={(ch, parentVolId) => { 
      setCurrentStoryChapter(ch); 
      setCurrentStoryVolume(parentVolId);
      setShowStoryReader(true); 
    }}
    onAddChapter={() => { setNovelEditType('chapter'); setNovelEditItem(null); setShowNovelEditModal(true); }}
    onAddVolume={() => { setNovelEditType('volume'); setNovelEditItem(null); setShowNovelEditModal(true); }}
    onEditItem={(item, type) => { setNovelEditType(type); setNovelEditItem(item); setShowNovelEditModal(true); }}
    onDeleteItem={(item, type, parentId) => { 
      setConfirmModal({ 
        isOpen: true, 
        title: '确认删除', 
        message: `删除「${item.title}」？`, 
        onConfirm: () => { 
          // 需要从正确位置删除
          if (parentId) {
            // 从分卷中删除
            const updatedEntries = updateEntryInTree(currentBook.entries, parentId, (vol) => ({
              ...vol,
              children: (vol.children || []).filter(ch => ch.id !== item.id)
            }));
            const updatedBook = { ...currentBook, entries: updatedEntries };
            setCurrentBook(updatedBook);
            const updatedCurrentEntry = findEntryById(updatedEntries, currentEntry.id);
            if (updatedCurrentEntry) setCurrentEntry(updatedCurrentEntry);
            setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? updatedBook : b) }));
          } else {
            // 从独立章节中删除
            setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: deleteEntryFromTree(b.entries, item.id) } : b) })); 
          }
          setConfirmModal({ isOpen: false }); 
        } 
      }); 
    }}
    onMoveChapter={handleMoveNovelChapter}
    onToggleVolume={(volId) => { setNovelCollapsedVolumes(prev => { const n = new Set(prev); n.has(volId) ? n.delete(volId) : n.add(volId); return n; }); }}
    collapsedVolumes={novelCollapsedVolumes}
    allEntries={currentBook.entries}
  />
)}</main>{viewMode === 'list' && !isReorderMode && (<><button className={`fab ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}><span style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><AddMenu isOpen={showAddMenu} onClose={() => setShowAddMenu(false)} onAddEntry={() => { setEditingEntry(null); setIsCreatingFolder(false); setShowEntryModal(true); }} onAddFolder={() => { setEditingEntry(null); setIsCreatingFolder(true); setShowEntryModal(true); }} onReorder={() => setIsReorderMode(true)} onToggleGallery={toggleGallery} galleryEnabled={currentBook?.gallery?.enabled} /></>)}{isEditing && <EditorToolbar onIndent={handleIndent} onFormat={() => { saveSelection(); setShowFormatMenu(true); }} onAlign={() => { saveSelection(); setShowAlignMenu(true); }} onFont={() => { saveSelection(); setShowFontMenu(true); }} onImage={handleImageUpload} hasActive={hasActiveFormat} />}<TextFormatMenu isOpen={showFormatMenu} onClose={() => { setShowFormatMenu(false); }} activeFormats={activeFormats} onToggleFormat={handleToggleFormat} /><AlignMenu isOpen={showAlignMenu} onClose={() => { setShowAlignMenu(false); restoreSelection(); }} onAlign={handleAlign} /><FontMenu isOpen={showFontMenu} onClose={() => { setShowFontMenu(false); restoreSelection(); }} onSelectFont={setCurrentFont} currentFont={currentFont} /></div><EntryModal isOpen={showEntryModal} onClose={() => { setShowEntryModal(false); setEditingEntry(null); }} onSave={editingEntry ? handleUpdateEntry : handleAddEntry} editingEntry={editingEntry} parentTitle={currentEntry?.title} isFolder={isCreatingFolder} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} />{showGallery && (<div className="gallery-page" onClick={e => e.stopPropagation()}><div className="gallery-header"><button className="gallery-back" onClick={() => { setShowGallery(false); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }}>← 返回</button><h2>{currentBook?.title}</h2><button className="gallery-upload" onClick={() => galleryUploadRef.current?.click()}>+ 添加</button><input ref={galleryUploadRef} type="file" accept="image/*" multiple onChange={uploadGalleryImage} style={{ display: 'none' }} /></div><div className="gallery-grid">{currentBook?.gallery?.images?.map(img => (<div key={img.id} className="gallery-item" onTouchStart={(e) => { e.stopPropagation(); const touch = e.touches[0]; galleryLongPressTimer.current = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); setGalleryContextMenu({ isOpen: true, image: img, position: { x: touch.clientX, y: touch.clientY } }); }, 500); }} onTouchEnd={(e) => { e.stopPropagation(); if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onTouchMove={(e) => { if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onClick={(e) => { e.stopPropagation(); if (!galleryContextMenu.isOpen) openGalleryPreview(img); }}><img src={img.src} alt="" draggable={false} />{img.featured && <span className="featured-star">★</span>}</div>))}{(!currentBook?.gallery?.images || currentBook.gallery.images.length === 0) && (<div className="gallery-empty"><span>🖼️</span><p>还没有图片</p><p>点击右上角添加</p></div>)}</div>{galleryContextMenu.isOpen && (<><div className="gallery-context-overlay" onClick={(e) => { e.stopPropagation(); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }} /><div className="context-menu" style={{ top: galleryContextMenu.position.y, left: Math.min(galleryContextMenu.position.x, window.innerWidth - 180) }}><div className="context-item" onClick={(e) => { e.stopPropagation(); toggleFeatured(galleryContextMenu.image.id); }}><span className="context-icon">{galleryContextMenu.image.featured ? '☆' : '★'}</span>{galleryContextMenu.image.featured ? '取消展示' : '展示'}</div><div className="context-item danger" onClick={(e) => { e.stopPropagation(); deleteGalleryImage(galleryContextMenu.image.id); }}><span className="context-icon">🗑️</span>删除图片</div></div></>)}{galleryConfirmModal.isOpen && (<div className="gallery-confirm-overlay" onClick={(e) => { e.stopPropagation(); setGalleryConfirmModal({ isOpen: false }); }}><div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}><h3>{galleryConfirmModal.title}</h3><p>{galleryConfirmModal.message}</p><div className="modal-actions"><button className="btn-cancel" onClick={() => setGalleryConfirmModal({ isOpen: false })}>取消</button><button className="btn-save" onClick={galleryConfirmModal.onConfirm}>确定</button></div></div></div>)}</div>)}{galleryPreviewImage && (<div className="gallery-viewer" onTouchStart={(e) => {
  e.stopPropagation();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    galleryTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: Math.sqrt(dx*dx + dy*dy), scale: galleryViewScale, time: Date.now() };
  } else {
    galleryTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0, scale: galleryViewScale, time: Date.now() };
    setGalleryIsDragging(true);
  }
}} onTouchMove={(e) => {
  e.stopPropagation();
  if (e.touches.length === 2 && galleryTouchStart.current.dist > 0) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const scale = Math.max(1, Math.min(4, galleryTouchStart.current.scale * (dist / galleryTouchStart.current.dist)));
    setGalleryViewScale(scale);
  } else if (e.touches.length === 1 && galleryViewScale === 1) {
    const dx = e.touches[0].clientX - galleryTouchStart.current.x;
    setGalleryDragX(dx);
  }
}} onTouchEnd={(e) => {
  e.stopPropagation();
  setGalleryIsDragging(false);
  const dx = galleryDragX;
  const images = currentBook?.gallery?.images || [];
  
  if (galleryViewScale === 1 && Math.abs(dx) > 50) {
    // 切换图片
    if (dx < -50 && galleryViewIndex < images.length - 1) {
      setGalleryViewIndex(galleryViewIndex + 1);
      setGalleryPreviewImage(images[galleryViewIndex + 1]);
    } else if (dx > 50 && galleryViewIndex > 0) {
      setGalleryViewIndex(galleryViewIndex - 1);
      setGalleryPreviewImage(images[galleryViewIndex - 1]);
    }
  }
  setGalleryDragX(0);
  if (galleryViewScale < 1.1) setGalleryViewScale(1);
}} onClick={(e) => { e.stopPropagation(); if (Math.abs(galleryDragX) < 10 && galleryViewScale === 1) closeGalleryPreview(); }}><div className="gallery-viewer-counter">{galleryViewIndex + 1} / {currentBook?.gallery?.images?.length || 0}</div>{galleryViewerMenu && (<><div className="gallery-viewer-menu-overlay" onClick={(e) => { e.stopPropagation(); setGalleryViewerMenu(false); }} /><div className="gallery-viewer-menu"><div className="gallery-viewer-menu-item" onClick={(e) => { e.stopPropagation(); const img = currentBook?.gallery?.images?.[galleryViewIndex]; if (img) { const link = document.createElement('a'); link.href = img.src; link.download = `image_${Date.now()}.png`; link.click(); } setGalleryViewerMenu(false); }}>💾 保存到手机</div><div className="gallery-viewer-menu-item" onClick={(e) => { e.stopPropagation(); setGalleryViewerMenu(false); }}>取消</div></div></>)}<div className="gallery-viewer-track" style={{ transform: `translateX(calc(-${galleryViewIndex * 100}% + ${galleryDragX}px))`, transition: galleryIsDragging ? 'none' : 'transform 0.3s ease-out' }}>{currentBook?.gallery?.images?.map((img, idx) => (<div key={img.id} className="gallery-viewer-slide" onTouchStart={(e) => { if (idx === galleryViewIndex && galleryViewScale === 1) { galleryViewerLongPress.current = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); setGalleryViewerMenu(true); }, 500); } }} onTouchEnd={() => { if (galleryViewerLongPress.current) { clearTimeout(galleryViewerLongPress.current); galleryViewerLongPress.current = null; } }} onTouchMove={() => { if (galleryViewerLongPress.current) { clearTimeout(galleryViewerLongPress.current); galleryViewerLongPress.current = null; } }}><img src={img.src} alt="" style={{ transform: `scale(${idx === galleryViewIndex ? galleryViewScale : 1})` }} draggable={false} /></div>))}</div></div>)}{showExportMenu && (<><div className="export-menu-overlay" onClick={() => setShowExportMenu(false)} /><div className="export-menu" style={{ top: exportMenuPos.y - 60, left: Math.min(exportMenuPos.x - 60, window.innerWidth - 140) }}><div className="export-menu-item" onClick={handleExportImage}><span>📷</span><span>导出长图</span></div></div></>)}<BookModal isOpen={showBookModal} onClose={() => { setShowBookModal(false); setEditingBook(null); }} onSave={handleAddBook} editingBook={editingBook} />{showStoryBookPage && currentBook && (
  <StoryBookPage book={currentBook} onClose={() => setShowStoryBookPage(false)} onEnterToc={handleEnterStoryToc} />
)}{showStoryToc && currentBook && (
  <StoryTocPage 
    book={currentBook} 
    onClose={() => setShowStoryToc(false)} 
    onSelectChapter={(volId, chId) => { setCurrentStoryVolume(volId); const vol = currentBook.storyMode?.volumes?.find(v => v.id === volId); const ch = vol?.chapters?.find(c => c.id === chId); if (ch) { setCurrentStoryChapter(ch); setShowStoryToc(false); setShowStoryReader(true); } }}
    onAddChapter={handleAddStoryChapter}
    onAddVolume={handleAddStoryVolume}
    onEditChapter={handleEditStoryChapter}
    onEditVolume={handleEditStoryVolume}
    onDeleteChapter={handleDeleteStoryChapter}
    onDeleteVolume={handleDeleteStoryVolume}
    onToggleVolume={handleToggleStoryVolume}
    collapsedVolumes={storyCollapsedVolumes}
  />
)}{showStoryReader && currentBook && currentStoryChapter && (() => {
  // 收集所有章节
  const getAllNovelChapters = () => {
    if (viewMode === 'novel' && liveEntry) {
      const chapters = [];
      const collect = (items, parentVolId = null) => {
        items.forEach(item => {
          if (item.isFolder) {
            collect(item.children || [], item.id);
          } else {
            chapters.push({ ...item, volumeId: parentVolId });
          }
        });
      };
      collect(liveEntry.children || []);
      return chapters;
    }
    return [];
  };
  const allNovelChapters = getAllNovelChapters();
  const chapterIndex = currentStoryChapter ? allNovelChapters.findIndex(c => c.id === currentStoryChapter.id) : -1;
  // 使用allNovelChapters中的最新章节数据
  const liveChapter = chapterIndex >= 0 ? allNovelChapters[chapterIndex] : currentStoryChapter;
  
  return (
    <StoryReader 
      book={currentBook}
      chapter={liveChapter}
      novelModeEntry={viewMode === 'novel' ? liveEntry : null}
      allChapters={allNovelChapters}
      currentChapterIndex={chapterIndex}
      onClose={() => setShowStoryReader(false)}
      onChangeChapter={(ch) => setCurrentStoryChapter(ch)}
      onEdit={() => {
        // 进入章节编辑模式 - 存储返回信息
        setShowStoryReader(false);
        // 存储完整的返回记录（类似handleLinkClick）
        const returnRecord = { 
          bookId: currentBook.id, 
          entry: currentEntry, 
          viewMode: 'novel',
          fromNovelEdit: true
        };
        setNavigationStack(prev => [...prev, returnRecord]);
        setCurrentEntry(currentStoryChapter);
        setViewMode('single');
        setIsReadOnly(false);
      }}
      settings={storySettings}
      onChangeSettings={setStorySettings}
    />
  );
})()}<NovelEditModal
  isOpen={showNovelEditModal}
  onClose={() => setShowNovelEditModal(false)}
  onSave={handleSaveNovelEdit}
  editType={novelEditType}
  editItem={novelEditItem}
/><StoryEditModal 
  isOpen={showStoryEditModal} 
  onClose={() => setShowStoryEditModal(false)} 
  onSave={handleSaveStoryEdit}
  editingItem={storyEditItem}
  type={storyEditType}
/><style>{styles}</style></div>);
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&family=ZCOOL+XiaoWei&display=swap');
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body,#root{height:100%;overflow:hidden}
.app{height:100%;font-family:'Noto Serif SC',serif;overflow-y:auto;-webkit-overflow-scrolling:touch}
.bookshelf-view{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f0f23 100%);padding:0;min-height:100vh;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;position:relative}
.bookshelf-header{text-align:center;padding:50px 20px 20px;position:relative;z-index:10}
.bookshelf-header h1{font-family:'ZCOOL XiaoWei',serif;font-size:2.5rem;color:#f4e4c1;letter-spacing:.3em;text-shadow:0 0 40px rgba(244,228,193,.3);margin-bottom:16px}
.bookshelf-carousel{flex:1;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;-ms-overflow-style:none;position:relative;z-index:10;padding-bottom:50px}
.bookshelf-carousel::-webkit-scrollbar{display:none}
.bookshelf-page{flex:0 0 100%;width:100%;scroll-snap-align:start;display:flex;align-items:flex-start;justify-content:center;padding:0 20px;box-sizing:border-box}
.bookshelf-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px 16px;justify-items:center;padding-top:5px}
.shelf-page-dots{position:fixed;bottom:60px;left:0;right:0;display:flex;justify-content:center;gap:8px;z-index:10}
.shelf-dot{width:8px;height:8px;border-radius:50%;background:rgba(244,228,193,.3);cursor:pointer;transition:all .3s}
.shelf-dot.active{background:#f4e4c1;transform:scale(1.2)}
.subtitle{color:rgba(244,228,193,.6);font-size:.85rem;letter-spacing:.1em;line-height:1.6}
.search-star{background:none;border:none;font-size:1.5rem;cursor:pointer;margin-top:12px;animation:starPulse 2s ease-in-out infinite;filter:drop-shadow(0 0 10px rgba(255,215,0,.5))}
.search-star:active{transform:scale(1.2)}
@keyframes starPulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 10px rgba(255,215,0,.5))}50%{transform:scale(1.1);filter:drop-shadow(0 0 20px rgba(255,215,0,.8))}}
.book-card{position:relative;width:120px;cursor:pointer;user-select:none}
.book-card:active{transform:scale(.95)}
.book-spine{position:absolute;left:0;top:0;width:12px;height:155px;background:var(--book-color,#2D3047);border-radius:3px 0 0 3px;transform:rotateY(-30deg) translateX(-6px);transform-origin:right center;box-shadow:-5px 0 15px rgba(0,0,0,.3)}
.book-cover{width:100%;height:155px;background:linear-gradient(145deg,var(--book-color,#2D3047) 0%,color-mix(in srgb,var(--book-color,#2D3047) 70%,black) 100%);border-radius:0 8px 8px 0;display:flex;align-items:center;justify-content:center;box-shadow:5px 5px 20px rgba(0,0,0,.4);overflow:hidden;position:relative}
.cover-image{position:absolute;width:100%;height:100%;object-fit:cover}
.book-emoji{font-size:2.5rem}
.book-shadow{position:absolute;bottom:-15px;left:10%;width:80%;height:15px;background:radial-gradient(ellipse,rgba(0,0,0,.4) 0%,transparent 70%)}
.book-meta{text-align:center;padding:10px 4px 0}
.book-meta h2{color:#f4e4c1;font-size:.9rem;margin-bottom:4px}
.book-meta p{color:rgba(244,228,193,.5);font-size:.75rem}
.add-book{opacity:.5}
.add-book .book-cover{border:2px dashed rgba(244,228,193,.3)}
.add-icon{font-size:2.5rem;color:rgba(244,228,193,.5)}
.main-view{background:linear-gradient(180deg,#faf8f3 0%,#f5f0e8 100%);display:flex;flex-direction:column;height:100%;overflow:hidden}
.main-content{flex:1;display:flex;flex-direction:column;overflow:hidden}
.sidebar{position:fixed;left:0;top:0;width:280px;max-width:85vw;height:100%;background:linear-gradient(180deg,#2D3047 0%,#1a1a2e 100%);z-index:1000;transform:translateX(-100%);transition:transform .3s;display:flex;flex-direction:column}
.sidebar.open{transform:translateX(0)}
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999}
.sidebar-header{padding:20px 16px;border-bottom:1px solid rgba(244,228,193,.1);display:flex;justify-content:space-between;align-items:center}
.sidebar-header h2{color:#f4e4c1;font-size:1.2rem;font-family:'ZCOOL XiaoWei',serif}
.close-sidebar{background:none;border:none;color:rgba(244,228,193,.6);font-size:1.5rem;cursor:pointer}
.sidebar-content{flex:1;overflow-y:auto;padding:12px 0}
.sidebar-item{display:flex;align-items:center;padding:12px 16px;color:rgba(244,228,193,.8);cursor:pointer;gap:8px}
.sidebar-item:active,.sidebar-item.active{background:rgba(244,228,193,.1)}
.expand-icon{font-size:.9rem;width:16px;transition:transform .2s}
.expand-icon.expanded{transform:rotate(90deg)}
.sidebar-icon{font-size:.85rem}
.sidebar-title{font-size:.9rem;flex:1}
.link-star{font-size:.65rem;opacity:.7}
.top-bar{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(250,248,243,.95);backdrop-filter:blur(10px);border-bottom:1px solid rgba(45,48,71,.1)}
.top-left{display:flex;gap:4px}
.icon-btn{background:none;border:none;font-size:1.2rem;padding:8px;border-radius:8px;cursor:pointer;color:#2D3047}
.icon-btn:active{background:rgba(45,48,71,.1)}
.breadcrumb{flex:1;text-align:center;font-size:.85rem;color:#666;overflow:hidden}
.book-name{color:#2D3047;font-weight:600}
.separator{margin:0 6px;color:#ccc}
.current-title{color:#8B7355}
.read-mode-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 8px;border-radius:16px;background:rgba(45,48,71,.05)}
.toggle-label{font-size:.75rem;color:#999}
.toggle-label.active{color:#2D3047;font-weight:600}
.toggle-switch{width:36px;height:20px;background:#2D3047;border-radius:10px;position:relative}
.toggle-switch.edit-mode{background:#8B7355}
.toggle-knob{position:absolute;left:2px;top:2px;width:16px;height:16px;background:#f4e4c1;border-radius:50%;transition:transform .3s}
.toggle-switch.edit-mode .toggle-knob{transform:translateX(16px)}
.book-info-card{display:flex;gap:16px;padding:20px;background:#fff;margin:16px;border-radius:12px;box-shadow:0 2px 8px rgba(45,48,71,.08);cursor:pointer;position:relative;transition:all .2s}
.book-info-card:active{transform:scale(0.98);background:#f9f9f9}
.info-edit-hint{position:absolute;right:16px;bottom:16px;font-size:.8rem;color:#999}
.info-cover{width:70px;height:95px;border-radius:6px;overflow:hidden;background:linear-gradient(135deg,#2D3047,#1a1a2e);display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0}
.info-cover img{width:100%;height:100%;object-fit:cover}
.info-details{flex:1;font-size:.85rem;color:#666;display:flex;flex-direction:column;gap:6px}
.content-area{padding:20px 16px 80px;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain}
.content-area.slide-in{animation:slideIn .25s ease-out}
.content-area.slide-out{animation:slideOut .2s ease-in}
@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes slideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}
.list-header{margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid rgba(45,48,71,.1)}
.list-header h1{font-family:'ZCOOL XiaoWei',serif;font-size:1.6rem;color:#2D3047;margin-bottom:6px}
.list-header .summary{color:#8B7355;font-size:.9rem}
.swipe-hint{font-size:.75rem;color:#aaa;text-align:center;margin-bottom:16px}
.entry-list{display:flex;flex-direction:column;gap:10px}
.entry-card{display:flex;align-items:center;gap:12px;padding:16px;background:#fff;border-radius:12px;cursor:pointer;box-shadow:0 2px 8px rgba(45,48,71,.08);user-select:none}
.entry-card:active{transform:scale(.98)}
.entry-icon{font-size:1.3rem}
.entry-info{flex:1;min-width:0}
.entry-info h3{font-size:1rem;color:#2D3047;margin-bottom:2px;font-weight:600;display:flex;align-items:center;gap:6px}
.entry-info p{font-size:.8rem;color:#8B7355;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.star-badge{font-size:.7rem;opacity:.7}
.entry-arrow{font-size:1.3rem;color:#ccc}
.empty-state{text-align:center;padding:60px 20px;color:#999}
.empty-state span{font-size:2.5rem;display:block;margin-bottom:12px}
.single-view,.merged-view{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 4px 20px rgba(45,48,71,.1);min-height:calc(100vh - 200px)}
.content-header{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(45,48,71,.1);display:flex;flex-direction:column;gap:6px}
.content-header h1{font-family:'ZCOOL XiaoWei',serif;font-size:1.5rem;color:#2D3047}
.editable-title{font-family:'ZCOOL XiaoWei',serif;font-size:1.5rem;color:#2D3047;border:none;background:transparent;padding:0;width:100%;outline:none}
.entry-summary{font-size:.9rem;color:#8B7355}
.editable-summary{font-size:.9rem;color:#8B7355;border:none;background:transparent;padding:0;width:100%;outline:none}
.merged-header{text-align:center;display:block}
.merged-hint{color:#8B7355;font-size:.85rem;margin-top:6px}
.content-body{line-height:1.9;color:#333;font-size:16px}
.content-body p{margin-bottom:.5em}
.content-body img{max-width:100%;border-radius:8px;display:block;margin:16px auto}
.keyword{color:#2D3047;font-weight:600}
.keyword.linked{color:#8B7355;background:linear-gradient(180deg,transparent 60%,rgba(139,115,85,.2) 60%);cursor:pointer}
.rich-editor{min-height:50vh;line-height:1.9;font-size:16px;outline:none;color:#333;padding-bottom:40vh}
.rich-editor:empty:before{content:'开始书写...';color:#999}
.rich-editor p{margin-bottom:.5em}
.rich-editor img{max-width:100%;border-radius:8px;display:block;margin:16px auto}
.merged-content-read .merged-section{margin-bottom:32px}
.section-title{font-size:1.1rem;color:#2D3047;font-weight:600;margin-bottom:12px}
.section-divider{height:1px;background:linear-gradient(90deg,transparent,rgba(45,48,71,.15),transparent);margin:32px 0}
.merged-content-edit{display:flex;flex-direction:column;gap:24px}
.merged-edit-section{padding-bottom:20px;border-bottom:1px solid rgba(45,48,71,.1)}
.merged-edit-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:1.1rem;color:#2D3047;font-weight:600}
.merged-title-input{flex:1;background:none;border:none;font-size:1.1rem;font-weight:600;color:#2D3047;padding:4px 0;font-family:'Noto Serif SC',serif}
.merged-title-input:focus{outline:none}
.merged-editor-wrap{min-height:80px;line-height:1.8;font-size:16px;outline:none;color:#333}
.merged-editor-wrap:empty:before{content:'内容...';color:#999}
.add-merged-entry-btn{background:none;border:1px dashed rgba(45,48,71,.2);border-radius:8px;padding:12px;color:#8B7355;font-size:.9rem;cursor:pointer}
.fab{position:fixed;right:24px;bottom:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#2D3047,#1a1a2e);border:none;color:#f4e4c1;font-size:1.8rem;cursor:pointer;box-shadow:0 4px 20px rgba(45,48,71,.4);display:flex;align-items:center;justify-content:center;z-index:50}
.fab:active,.fab.active{transform:scale(.9)}
.add-menu-overlay{position:fixed;inset:0;z-index:48}
.add-menu{position:fixed;right:24px;bottom:90px;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);overflow:hidden;z-index:49}
.add-menu-item{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer}
.add-menu-item:active{background:#f5f5f5}
.add-menu-item:not(:last-child){border-bottom:1px solid #eee}
.editor-toolbar-bottom{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;padding:8px 16px;background:rgba(250,248,243,.98);border-top:1px solid rgba(45,48,71,.08);z-index:50}
.editor-toolbar-bottom button{background:none;border:none;font-size:1rem;padding:8px 14px;cursor:pointer;color:#2D3047;border-radius:6px;display:flex;align-items:center;justify-content:center}
.editor-toolbar-bottom button:active{background:rgba(45,48,71,.08)}
.editor-toolbar-bottom button.has-active{color:#8B7355;background:rgba(139,115,85,.1)}
.format-menu-overlay{position:fixed;inset:0;z-index:58}
.format-menu{position:fixed;left:16px;right:16px;bottom:60px;background:#fff;border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,.1);z-index:59;padding:12px}
.format-hint{font-size:.75rem;color:#999;text-align:center;margin-bottom:10px}
.format-row{display:flex;justify-content:space-around;margin-bottom:8px}
.format-row:last-child{margin-bottom:0}
.format-row button{width:44px;height:44px;border-radius:10px;border:1px solid #eee;background:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.format-row button:active{background:rgba(139,115,85,.15)}
.format-row button.active{background:#8B7355;color:#fff;border-color:#8B7355}
.size-row button{width:auto;padding:0 14px}
.align-menu .format-row{justify-content:center;gap:16px}
.font-menu{position:fixed;left:16px;right:16px;bottom:60px;background:#fff;border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,.1);z-index:59;padding:16px;display:flex;flex-wrap:wrap;gap:8px}
.font-item{padding:10px 14px;border-radius:8px;cursor:pointer;font-size:.9rem;background:#f5f5f5}
.font-item.active{background:rgba(139,115,85,.15);color:#8B7355}
.reorder-mode{padding:0}
.reorder-header{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid rgba(45,48,71,.1);margin-bottom:16px}
.reorder-header h3{font-family:'ZCOOL XiaoWei',serif;font-size:1.3rem;color:#2D3047}
.done-btn{background:#8B7355;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:.9rem;cursor:pointer}
.reorder-hint{font-size:.8rem;color:#999;text-align:center;margin-bottom:16px}
.reorder-list{display:flex;flex-direction:column;gap:8px;position:relative;min-height:200px}
.reorder-item{display:flex;align-items:center;background:#fff;border-radius:12px;overflow:visible;box-shadow:0 2px 8px rgba(45,48,71,.08)}
.reorder-item.dragging{background:#fff;border-radius:12px}
.reorder-content{flex:1;display:flex;align-items:center;gap:12px;padding:14px 16px}
.bookmark-tab{width:40px;height:100%;background:linear-gradient(135deg,#8B7355,#6B5335);display:flex;align-items:center;justify-content:center;color:#f4e4c1;font-size:1.2rem;clip-path:polygon(0 0,100% 0,100% 100%,0 100%,8px 50%)}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-content{background:#fff;border-radius:16px;padding:24px;width:100%;max-width:360px;max-height:80vh;overflow-y:auto}
.modal-content h3{font-family:'ZCOOL XiaoWei',serif;font-size:1.3rem;color:#2D3047;margin-bottom:16px;text-align:center}
.confirm-modal p{text-align:center;color:#666;margin-bottom:20px}
.modal-hint{font-size:.85rem;color:#8B7355;margin-bottom:16px;text-align:center}
.modal-content input[type="text"]{width:100%;padding:12px 16px;border:2px solid rgba(45,48,71,.1);border-radius:10px;font-family:'Noto Serif SC',serif;font-size:1rem;margin-bottom:12px}
.modal-content input:focus{outline:none;border-color:#8B7355}
.checkbox-label{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:.9rem;color:#666;cursor:pointer}
.checkbox-label input{width:18px;height:18px;accent-color:#8B7355}
.section-label{font-size:.85rem;color:#666;margin-bottom:10px}
.cover-section{margin-bottom:16px}
.cover-preview{position:relative;width:100%;height:150px;border-radius:10px;overflow:hidden;margin-bottom:12px}
.cover-preview img{width:100%;height:100%;object-fit:cover}
.remove-cover{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;border:none;font-size:1.2rem;cursor:pointer}
.upload-cover-btn{width:100%;padding:12px;border:2px dashed rgba(45,48,71,.2);border-radius:10px;background:none;color:#666;font-size:.9rem;cursor:pointer;margin-top:12px}
.emoji-picker{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.emoji-option{font-size:1.8rem;padding:8px;border-radius:8px;cursor:pointer}
.emoji-option.selected{background:rgba(139,115,85,.2);transform:scale(1.1)}
.modal-actions{display:flex;gap:12px;margin-top:16px}
.btn-cancel,.btn-save,.btn-danger{flex:1;padding:12px;border-radius:10px;font-family:'Noto Serif SC',serif;font-size:1rem;cursor:pointer}
.btn-cancel{background:none;border:2px solid rgba(45,48,71,.2);color:#666}
.btn-save{background:linear-gradient(135deg,#2D3047,#1a1a2e);border:none;color:#f4e4c1}
.btn-danger{background:#e53935;border:none;color:#fff}
.btn-save:disabled{opacity:.5}
.book-modal{max-width:400px}
.context-overlay{position:fixed;inset:0;z-index:1998}
.context-menu{position:fixed;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);overflow:hidden;z-index:1999;min-width:160px}
.context-item{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;font-size:.95rem}
.context-item:active{background:#f5f5f5}
.context-item.danger{color:#e53935}
.context-item:not(:last-child){border-bottom:1px solid #eee}
.context-icon{font-size:1.1rem}
.search-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;flex-direction:column;backdrop-filter:blur(4px)}
.search-modal{background:linear-gradient(180deg,#faf8f3 0%,#f5f0e8 100%);flex:1;display:flex;flex-direction:column;max-height:100%;animation:slideUp .3s ease}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.search-header{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid rgba(139,115,85,.2);background:#fff}
.search-input-wrap{flex:1;display:flex;align-items:center;background:rgba(139,115,85,.1);border-radius:12px;padding:0 12px}
.search-icon{font-size:1rem;color:#8B7355}
.search-input{flex:1;border:none;background:none;padding:12px 8px;font-size:1rem;font-family:'Noto Serif SC',serif;outline:none;color:#2D3047}
.search-input::placeholder{color:#aaa}
.search-clear{background:none;border:none;font-size:1.2rem;color:#999;cursor:pointer;padding:4px 8px}
.search-cancel{background:none;border:none;color:#8B7355;font-size:1rem;cursor:pointer;font-family:'Noto Serif SC',serif}
.search-results{flex:1;overflow-y:auto;padding:8px}
.search-empty{text-align:center;padding:60px 20px;color:#999}
.search-empty span{font-size:3rem;display:block;margin-bottom:16px}
.search-result-item{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border-radius:12px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,.05);cursor:pointer}
.search-result-item:active{background:#f9f6f1}
.result-icon{font-size:1.5rem}
.result-info{flex:1;min-width:0}
.result-info h4{font-size:1rem;color:#2D3047;margin-bottom:4px;font-weight:600}
.result-path{font-size:.8rem;color:#8B7355;margin-bottom:2px}
.result-summary{font-size:.85rem;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.result-arrow{color:#ccc;font-size:1.2rem}
.word-count{text-align:center;font-size:.8rem;color:#aaa;padding:20px 0;margin-top:20px;border-top:1px solid rgba(45,48,71,.1)}
.export-menu-overlay{position:fixed;inset:0;z-index:1998}
.export-menu{position:fixed;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);overflow:hidden;z-index:1999;min-width:120px}
.export-menu-item{display:flex;align-items:center;gap:10px;padding:14px 18px;cursor:pointer;font-size:.95rem}
.export-menu-item:active{background:#f5f5f5}
.gallery-page{position:fixed;inset:0;background:linear-gradient(180deg,#faf8f3 0%,#f5f0e8 100%);z-index:2500;display:flex;flex-direction:column}
.gallery-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(45,48,71,.1);background:rgba(250,248,243,.95);backdrop-filter:blur(10px)}
.gallery-back{background:none;border:none;color:#2D3047;font-size:1rem;cursor:pointer;font-family:'Noto Serif SC',serif}
.gallery-header h2{font-family:'ZCOOL XiaoWei',serif;font-size:1.3rem;color:#2D3047}
.gallery-upload{background:none;border:none;color:#8B7355;font-size:1rem;cursor:pointer;font-family:'Noto Serif SC',serif}
.gallery-grid{flex:1;overflow-y:auto;padding:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-content:start}
.gallery-item{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer}
.gallery-item img{width:100%;height:100%;object-fit:cover}
.gallery-item:active{transform:scale(.98)}
.gallery-empty{grid-column:1/-1;text-align:center;padding:60px 20px;color:#999}
.gallery-empty span{font-size:3rem;display:block;margin-bottom:16px}
.gallery-context-overlay{position:fixed;inset:0;z-index:100}
.gallery-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2600;display:flex;align-items:center;justify-content:center;padding:20px}
.gallery-viewer{position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:3000;touch-action:none;overflow:hidden}
.gallery-viewer-counter{position:absolute;top:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,.7);font-size:.9rem;background:rgba(0,0,0,.4);padding:6px 16px;border-radius:20px;z-index:10}
.gallery-viewer-menu-overlay{position:absolute;inset:0;z-index:20}
.gallery-viewer-menu{position:absolute;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(40,40,40,.95);border-radius:12px;overflow:hidden;z-index:30;min-width:200px;backdrop-filter:blur(10px)}
.gallery-viewer-menu-item{padding:16px 24px;color:#fff;text-align:center;border-bottom:1px solid rgba(255,255,255,.1);cursor:pointer}
.gallery-viewer-menu-item:last-child{border-bottom:none;color:rgba(255,255,255,.6)}
.gallery-viewer-menu-item:active{background:rgba(255,255,255,.1)}
.gallery-viewer-track{display:flex;height:100%;will-change:transform}
.gallery-viewer-slide{flex:0 0 100%;width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.gallery-viewer-slide img{max-width:100%;max-height:90vh;object-fit:contain;border-radius:4px;transition:transform .15s ease;user-select:none;-webkit-user-drag:none;pointer-events:none}
.gallery-preview-modal{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px}
.gallery-preview-modal img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px}
.gallery-strip-item{width:120px;height:120px;flex-shrink:0;border-radius:12px;overflow:hidden;cursor:pointer}
.gallery-strip-item img{width:100%;height:100%;object-fit:cover}
.gallery-strip-item:active{transform:scale(.97)}
.gallery-preview-strip{margin:0 16px 16px;padding:16px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(45,48,71,.08)}
.gallery-preview-strip .gallery-preview-scroll{display:flex;gap:10px;overflow-x:auto;padding:4px 0 12px;scrollbar-width:none;-ms-overflow-style:none}
.gallery-preview-strip .gallery-preview-scroll::-webkit-scrollbar{display:none}
.gallery-strip-empty{width:120px;height:120px;flex-shrink:0;border-radius:12px;border:2px dashed rgba(139,115,85,.3);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#8B7355;cursor:pointer;gap:4px}
.gallery-strip-empty span{font-size:2rem}
.gallery-strip-empty p{font-size:.75rem;margin:0}
.gallery-enter-btn{display:block;width:100%;background:none;border:none;color:#8B7355;font-size:.9rem;cursor:pointer;text-align:center;padding:8px 0 0;font-family:'Noto Serif SC',serif}
.shelf-globe-bg{position:fixed;bottom:-550px;left:50%;width:300vw;height:600px;border-radius:50%;background:linear-gradient(180deg,#D4A84B 0%,#C9A227 40%,#B8960B 100%);box-shadow:0 -40px 100px 50px rgba(212,168,75,.3);z-index:1;cursor:pointer;pointer-events:auto}
.featured-star{position:absolute;top:6px;right:6px;color:#FFD700;font-size:1.2rem;text-shadow:0 0 8px rgba(255,215,0,.8),0 2px 4px rgba(0,0,0,.3)}
.profile-page{position:fixed;inset:0;background:#1a1d2e;z-index:3000;display:flex;flex-direction:column;overflow-y:auto;animation:slideUpProfile .3s ease-out}
.profile-page.closing{animation:slideDownProfile .28s ease-in forwards}
@keyframes slideUpProfile{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes slideDownProfile{from{transform:translateY(0)}to{transform:translateY(100%)}}
.profile-bg-overlay{position:absolute;inset:0;background:linear-gradient(180deg,rgba(45,48,71,.85) 0%,rgba(26,29,46,.95) 100%);pointer-events:none}
.profile-header{position:relative;z-index:1}
.profile-avatar{width:80px;height:80px;border-radius:50%;background:rgba(244,228,193,.1);display:flex;align-items:center;justify-content:center;font-size:2.5rem;margin:0 auto 15px;overflow:hidden;cursor:pointer;border:2px solid rgba(244,228,193,.3)}
.profile-avatar img{width:100%;height:100%;object-fit:cover}
.profile-bio{width:80%;max-width:280px;margin:10px auto 0;background:rgba(255,255,255,.08);border:none;border-radius:8px;padding:10px;color:#f4e4c1;font-size:.9rem;text-align:center;resize:none;outline:none}
.profile-bio::placeholder{color:rgba(244,228,193,.4)}
.profile-stats{position:relative;z-index:1}
.profile-menu{position:relative;z-index:1}
.profile-footer{position:relative;z-index:1}
.total-gallery-page{position:fixed;inset:0;background:linear-gradient(180deg,#2D3047 0%,#1a1d2e 100%);z-index:3100;display:flex;flex-direction:column;overflow-y:auto;animation:slideUpProfile .3s ease-out}
.total-gallery-list{padding:20px;display:flex;flex-direction:column;gap:20px}
.total-gallery-book{background:rgba(255,255,255,.05);border-radius:12px;padding:15px;overflow:hidden}
.total-gallery-book-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;padding:5px;margin:-5px;border-radius:8px;transition:background .2s}
.total-gallery-book-header:active{background:rgba(255,255,255,.05)}
.total-gallery-book-header .book-icon{width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;overflow:hidden;border-radius:4px}
.total-gallery-book-header .book-icon img{width:100%;height:100%;object-fit:cover}
.total-gallery-book-header .book-title{flex:1;color:#f4e4c1;font-size:1rem;font-weight:500}
.total-gallery-book-header .book-count{color:rgba(244,228,193,.5);font-size:.85rem}
.total-gallery-book-images{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.total-gallery-thumb{aspect-ratio:1;border-radius:6px;overflow:hidden;cursor:pointer;transition:transform .2s}
.total-gallery-thumb:active{transform:scale(0.95)}
.total-gallery-thumb img{width:100%;height:100%;object-fit:cover}
.total-gallery-more{aspect-ratio:1;border-radius:6px;background:rgba(244,228,193,.1);display:flex;align-items:center;justify-content:center;color:#f4e4c1;font-size:.9rem}
.total-gallery-add-btn{aspect-ratio:1;border-radius:6px;background:rgba(244,228,193,.1);display:flex;align-items:center;justify-content:center;color:rgba(244,228,193,.5);font-size:1.5rem;cursor:pointer;transition:all .2s;border:2px dashed rgba(244,228,193,.2)}
.total-gallery-add-btn:active{background:rgba(244,228,193,.2);color:#f4e4c1}
.profile-header{text-align:center;padding:60px 20px 30px;position:relative}
.profile-close{position:absolute;top:20px;right:20px;background:none;border:none;color:#f4e4c1;font-size:1.8rem;cursor:pointer;opacity:.7}

.profile-name{background:none;border:none;color:#f4e4c1;font-size:1.3rem;text-align:center;width:100%;font-family:'ZCOOL XiaoWei',serif;padding:8px}
.profile-name:focus{outline:none;border-bottom:1px solid rgba(244,228,193,.3)}
.profile-name::placeholder{color:rgba(244,228,193,.5)}
.profile-stats{display:flex;justify-content:center;gap:40px;padding:20px;border-bottom:1px solid rgba(244,228,193,.1)}
.stat-item{text-align:center}
.stat-number{display:block;font-size:1.5rem;color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif}
.stat-label{font-size:.8rem;color:rgba(244,228,193,.6)}
.profile-menu{padding:20px}
.profile-menu-item{display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.05);border-radius:12px;margin-bottom:10px;color:#f4e4c1;cursor:pointer}
.profile-menu-item:active{background:rgba(255,255,255,.1)}
.profile-menu-item span:first-child{font-size:1.3rem}
.profile-menu-item span:nth-child(2){flex:1}
.menu-arrow{color:rgba(244,228,193,.4);font-size:1.2rem}
.profile-footer{text-align:center;padding:30px 20px;color:rgba(244,228,193,.4);font-size:.85rem}
.profile-footer p{margin:4px 0}

/* ============ 正文模式样式 ============ */
.story-add-menu .story-menu-icon{font-size:1.3rem}
.story-add-menu .chapter-icon{opacity:0.9}
.story-add-menu .volume-icon{opacity:0.9}

/* 底部书脊预览条 */
.story-spine-strip{position:fixed;bottom:0;left:16px;right:16px;background:linear-gradient(180deg,#8B7355 0%,#6B5344 100%);border-radius:12px 12px 0 0;padding:16px 20px 20px;box-shadow:0 -4px 20px rgba(0,0,0,.2);z-index:100;transition:transform .2s ease-out}
.spine-content{display:flex;flex-direction:column;align-items:center;gap:8px}
.spine-book-top{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%}
.spine-decoration{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.spine-line{width:30px;height:2px;background:rgba(244,228,193,.3);border-radius:1px}
.spine-dot{width:6px;height:6px;background:rgba(244,228,193,.5);border-radius:50%}
.spine-title{color:#f4e4c1;font-size:1.1rem;font-family:'ZCOOL XiaoWei',serif;text-shadow:0 1px 2px rgba(0,0,0,.3)}
.spine-stats{color:rgba(244,228,193,.6);font-size:.8rem}
.spine-pull-hint{color:rgba(244,228,193,.5);font-size:.75rem;display:flex;align-items:center;gap:4px;margin-top:4px}
.spine-pull-hint span{display:inline-block;font-size:1rem;transform:rotate(270deg)}

/* 书本中心页 */
.story-book-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#2D3047 50%,#1a1d2e 100%);z-index:2600;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.story-book-close{position:absolute;top:20px;right:20px;background:none;border:none;color:rgba(244,228,193,.7);font-size:2rem;cursor:pointer}
.story-book-center{display:flex;flex-direction:column;align-items:center;gap:20px;cursor:pointer}
.story-book-cover{position:relative;width:160px;height:220px;background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%);border-radius:0 8px 8px 0;box-shadow:0 10px 40px rgba(0,0,0,.5),-5px 0 15px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;overflow:hidden}
.story-book-cover img{width:100%;height:100%;object-fit:cover}
.story-book-emoji{font-size:4rem}
.story-book-spine{position:absolute;left:0;top:0;bottom:0;width:15px;background:linear-gradient(90deg,rgba(0,0,0,.3) 0%,rgba(0,0,0,.1) 50%,rgba(255,255,255,.1) 100%)}
.story-book-info{text-align:center;color:#f4e4c1}
.story-book-info h2{font-family:'ZCOOL XiaoWei',serif;font-size:1.5rem;margin-bottom:8px}
.story-book-author{color:rgba(244,228,193,.7);font-size:.9rem;margin-bottom:4px}
.story-book-stats{color:rgba(244,228,193,.5);font-size:.85rem}
.story-book-hint{color:rgba(244,228,193,.4);font-size:.8rem;margin-top:10px}

/* 正文目录页 */
.story-toc-page{position:fixed;inset:0;background:#1f1f2e;z-index:2700;display:flex;flex-direction:column;animation:slideUp .3s ease}
.story-toc-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.1)}
.story-toc-tabs{display:flex;gap:20px}
.story-toc-tabs button{background:none;border:none;color:rgba(244,228,193,.5);font-size:1.1rem;font-family:'Noto Serif SC',serif;cursor:pointer;padding:8px 0;position:relative}
.story-toc-tabs button.active{color:#f4e4c1}
.story-toc-tabs button.active::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:#8B7355;border-radius:1px}
.story-toc-sort{background:none;border:none;color:rgba(244,228,193,.5);font-size:1.2rem;cursor:pointer}
.story-toc-content{flex:1;overflow-y:auto;padding:0}
.story-toc-list{padding-bottom:100px}
.story-volume{border-bottom:1px solid rgba(255,255,255,.05)}
.story-volume-header{display:flex;align-items:center;gap:12px;padding:16px 20px;color:#f4e4c1;cursor:pointer}
.story-volume-header:active{background:rgba(255,255,255,.05)}
.volume-arrow{color:rgba(244,228,193,.4);font-size:.7rem;transition:transform .2s}
.volume-arrow.expanded{transform:rotate(90deg)}
.volume-title{flex:1;font-size:1rem}
.volume-count{color:rgba(244,228,193,.4);font-size:.85rem}
.story-chapter-item{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 14px 44px;color:rgba(244,228,193,.8);cursor:pointer}
.story-chapter-item:active{background:rgba(255,255,255,.05)}
.chapter-title{flex:1;font-size:.95rem}
.chapter-words{color:rgba(244,228,193,.4);font-size:.8rem}
.story-toc-empty,.story-related-empty{text-align:center;padding:80px 20px;color:rgba(244,228,193,.4)}
.story-toc-empty span,.story-related-empty span{font-size:3rem;display:block;margin-bottom:16px}
.story-toc-back{position:fixed;bottom:20px;left:20px;background:rgba(255,255,255,.1);border:none;color:#f4e4c1;padding:12px 20px;border-radius:25px;font-family:'Noto Serif SC',serif;cursor:pointer}
.story-toc-page .fab{position:fixed;bottom:20px;right:20px;z-index:10}

/* 翻页阅读器 - 水平翻页 */
.story-reader{position:fixed;inset:0;z-index:2800;display:flex;flex-direction:column;overflow:hidden}
.story-reader.parchment{background:#FAF6F0}
.story-reader.white{background:#fff}
.story-reader.eyecare{background:#C7EDCC}
.story-reader.editor{background:#f5f5f5}
.parchment-texture{position:absolute;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%' height='100%' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");pointer-events:none}

/* 阅读器顶部栏 */
.reader-header{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;padding:12px 16px;background:rgba(255,255,255,.95);border-bottom:1px solid rgba(0,0,0,.08);z-index:10;opacity:0;pointer-events:none;transition:opacity .2s}
.reader-header.show{opacity:1;pointer-events:auto}
.reader-back-btn{background:none;border:none;font-size:1.3rem;color:#333;cursor:pointer;width:40px}
.reader-header-title{flex:1;text-align:center;font-size:1rem;font-weight:500;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 10px}
.reader-edit-btn{background:none;border:none;font-size:1.2rem;cursor:pointer;width:40px;text-align:right}

/* 翻页容器 */
.reader-page-container{flex:1;overflow:hidden;position:relative;z-index:1}
.reader-page-content{
  height:100%;
  box-sizing:border-box;
  padding-top:20px;
  padding-bottom:40px;
  column-fill:auto;
}
.reader-chapter-title{font-size:1.3rem;font-weight:600;text-align:center;margin-bottom:24px;break-after:avoid}
.reader-text{text-align:justify}
.reader-text p{margin-bottom:1em;text-indent:2em;orphans:3;widows:3}
.reader-text p:empty{display:none}

/* 阅读模式底部信息 */
.reader-footer{position:absolute;bottom:12px;left:24px;right:24px;display:flex;justify-content:space-between;font-size:.75rem;opacity:.5;z-index:5;transition:opacity .2s}
.reader-footer.hide{opacity:0}
.reader-footer span:nth-child(2){flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 20px}

/* 阅读控制栏 */
.reader-controls{position:absolute;bottom:0;left:0;right:0;z-index:20;animation:fadeIn .2s}
.reader-controls-top{display:flex;justify-content:space-around;padding:16px 20px;background:rgba(255,255,255,.95);border-top:1px solid rgba(0,0,0,.08)}
.reader-controls-top button{background:none;border:none;color:#333;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.8rem;cursor:pointer}
.reader-controls-top button span:first-child{font-size:1.3rem}

/* 阅读设置面板 */
.story-settings-panel{background:#fff;border-radius:12px;padding:20px;margin:0 16px 16px;box-shadow:0 -4px 20px rgba(0,0,0,.1)}
.settings-row{display:flex;align-items:center;gap:12px;margin-bottom:16px;color:#333}
.settings-label{width:40px;font-size:.85rem;flex-shrink:0}
.settings-row input[type="range"]{flex:1;accent-color:#8B7355}
.settings-value{width:35px;text-align:right;font-size:.85rem}
.settings-reset{background:none;border:none;color:rgba(0,0,0,.3);font-size:1.1rem;cursor:pointer}
.settings-row.themes{flex-wrap:wrap}
.theme-options{display:flex;gap:8px;flex-wrap:wrap}
.theme-btn{padding:8px 14px;border:2px solid #ddd;border-radius:20px;font-size:.8rem;cursor:pointer;font-family:'Noto Serif SC',serif}
.theme-btn.active{border-color:#8B7355}
.theme-btn.editor-theme{background:#f5f5f5}
.theme-btn.white-theme{background:#fff}
.theme-btn.eyecare-theme{background:#C7EDCC}
.theme-btn.parchment-theme{background:#FAF6F0}

/* 目录弹窗 */
.toc-drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2900;animation:fadeIn .2s}
.toc-drawer{position:fixed;bottom:0;left:0;right:0;height:40vh;background:#fff;border-radius:16px 16px 0 0;z-index:2910;display:flex;flex-direction:column;animation:slideUp .3s ease}
.toc-drawer-handle{width:40px;height:4px;background:#ddd;border-radius:2px;margin:10px auto}
.toc-drawer-header{display:flex;align-items:center;justify-content:space-between;padding:8px 20px 16px;border-bottom:1px solid rgba(0,0,0,.08)}
.toc-drawer-header span{font-weight:600;font-size:1.1rem;color:#333}
.toc-drawer-header button{background:none;border:none;font-size:1.5rem;color:#999;cursor:pointer}
.toc-drawer-list{flex:1;overflow-y:auto;padding:0 0 20px}
.toc-drawer-volume{padding:12px 20px;font-weight:600;color:#666;font-size:.9rem;background:#f8f8f8;position:sticky;top:0}
.toc-drawer-chapter{padding:14px 20px 14px 36px;color:#333;font-size:.95rem;border-bottom:1px solid rgba(0,0,0,.03)}
.toc-drawer-chapter:active{background:#f5f5f5}
.toc-drawer-chapter.active{color:#8B7355;font-weight:500}

/* 移至分卷弹窗 */
.move-volume-modal{max-height:70vh}
.move-volume-modal h3{margin-bottom:16px}
.volume-select-list{max-height:50vh;overflow-y:auto;margin:-10px -20px;padding:0}
.volume-select-item{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid rgba(0,0,0,.05);cursor:pointer}
.volume-select-item:active{background:#f5f5f5}
.volume-select-item.current{background:#f8f5f0}
.volume-select-item span:first-child{font-size:1.2rem}
.volume-select-item span:nth-child(2){flex:1}
.current-mark{font-size:.75rem;color:#8B7355;background:rgba(139,115,85,.1);padding:2px 8px;border-radius:10px}

/* 章节编辑器 */
.story-chapter-editor{position:fixed;inset:0;background:#faf8f3;z-index:2900;display:flex;flex-direction:column}
.chapter-editor-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(45,48,71,.1);background:#fff}
.chapter-editor-header button{background:none;border:none;color:#2D3047;font-size:1rem;cursor:pointer;font-family:'Noto Serif SC',serif}
.chapter-editor-header span{font-size:.9rem;color:#666}
.chapter-editor-content{flex:1;overflow-y:auto;padding:20px}
.chapter-title-input{width:100%;border:none;background:none;font-size:1.3rem;font-weight:600;color:#2D3047;padding:10px 0;margin-bottom:20px;font-family:'Noto Serif SC',serif;outline:none}
.chapter-title-input::placeholder{color:#aaa}
.chapter-content-editor{min-height:300px;outline:none;font-size:1rem;line-height:1.8;color:#333}
.chapter-content-editor:empty::before{content:'开始创作...';color:#aaa}
.chapter-editor-footer{text-align:center;padding:15px;color:#999;font-size:.85rem;border-top:1px solid rgba(45,48,71,.1)}

/* Novel Mode (基于分类的正文模式) */
.novel-toc-view{padding:0 16px 100px;flex:1;overflow-y:auto}
.novel-toc-stats{display:flex;align-items:center;justify-content:center;gap:8px;padding:16px 0;color:#888;font-size:.85rem}
.novel-toc-list{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.novel-volume{border-bottom:1px solid rgba(0,0,0,.05)}
.novel-volume:last-child{border-bottom:none}
.novel-volume-header{display:flex;align-items:center;padding:14px 16px;background:#f8f8f8;cursor:pointer;user-select:none}
.novel-volume-header:active{background:#f0f0f0}
.volume-arrow{color:#999;font-size:.7rem;margin-right:10px;transition:transform .2s}
.volume-arrow.expanded{transform:rotate(90deg)}
.volume-title{flex:1;font-weight:600;color:#2D3047}
.volume-count{color:#999;font-size:.8rem}
.novel-chapter-item{display:flex;align-items:center;padding:14px 16px 14px 36px;border-bottom:1px solid rgba(0,0,0,.03);cursor:pointer}
.novel-chapter-item:active{background:#f5f5f5}
.novel-chapter-item:last-child{border-bottom:none}
.novel-chapter-item.standalone{padding-left:16px}
.chapter-title{flex:1;color:#333}
.chapter-words{color:#aaa;font-size:.8rem}
.novel-toc-empty{padding:60px 20px;text-align:center;color:#999}
.novel-toc-empty span{font-size:3rem;display:block;margin-bottom:16px;opacity:.5}
.novel-toc-empty p{margin:8px 0;font-size:.9rem}
.novel-badge{font-size:.65rem;background:#8B7355;color:#fff;padding:2px 6px;border-radius:3px;margin-left:6px;font-weight:normal;vertical-align:middle}
.novel-header{padding:20px 0 10px;text-align:center}
.novel-header h1{font-size:1.4rem;color:#2D3047;margin-bottom:8px}
.novel-header p{color:#888;font-size:.9rem}

/* 图书馆页面 */
.library-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#2D3047 100%);z-index:2500;display:flex;flex-direction:column;overflow:hidden}
.library-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(244,228,193,.1)}
.library-back{background:none;border:none;color:#f4e4c1;font-size:1rem;cursor:pointer;padding:8px 0}
.library-header h2{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.3rem}
.library-import-btn{background:linear-gradient(135deg,#8B7355,#6B5335);color:#f4e4c1;border:none;padding:8px 16px;border-radius:8px;font-size:.9rem;cursor:pointer;display:flex;align-items:center;gap:6px}
.library-import-btn:active{opacity:.8}
.library-hint{color:rgba(244,228,193,.5);font-size:.8rem;text-align:center;padding:12px}
.library-list{flex:1;overflow-y:auto;padding:16px}
.library-book-item{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.05);border-radius:12px;padding:16px;margin-bottom:12px}
.library-book-item:active{background:rgba(255,255,255,.1)}
.library-book-cover{font-size:2.5rem;width:50px;height:70px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);border-radius:4px}
.library-book-info{flex:1;cursor:pointer}
.library-book-info h3{color:#f4e4c1;font-size:1rem;margin-bottom:4px;font-family:'Noto Serif SC',serif}
.library-book-info p{color:rgba(244,228,193,.6);font-size:.85rem;margin:2px 0}
.library-book-time{font-size:.75rem!important;color:rgba(244,228,193,.4)!important}
.library-book-delete{background:none;border:none;font-size:1.2rem;opacity:.5;cursor:pointer;padding:8px}
.library-book-delete:active{opacity:1}
.library-empty{text-align:center;padding:80px 20px;color:rgba(244,228,193,.5)}
.library-empty span{font-size:4rem;display:block;margin-bottom:20px;opacity:.5}
.library-empty p{margin:8px 0}
.library-bookmark-badge{position:absolute;top:-4px;right:-4px;font-size:.8rem}
.library-book-cover{position:relative}

/* 阅读器书签按钮 */
.reader-controls-top button.bookmarked{color:#f4a100}
.reader-controls-top button.bookmarked span:first-child{transform:scale(1.2)}

/* 目录抽屉空状态 */
.toc-drawer-empty{padding:40px 20px;text-align:center;color:#999;font-size:.9rem}

/* 认证弹窗 */
.auth-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px}
.auth-modal{max-width:320px;padding:30px;background:#fff;border-radius:16px;position:relative}
.auth-modal h3{text-align:center;margin-bottom:24px;color:#2D3047;font-family:'ZCOOL XiaoWei',serif}
.auth-modal form{display:flex;flex-direction:column;gap:14px}
.auth-modal input{padding:14px;border:1px solid #ddd;border-radius:8px;font-size:1rem;outline:none;transition:border-color .2s}
.auth-modal input:focus{border-color:#8B7355}
.auth-error{color:#e74c3c;font-size:.85rem;text-align:center;margin:0}
.auth-submit-btn{padding:14px;background:linear-gradient(135deg,#8B7355,#6B5335);color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.auth-submit-btn:disabled{opacity:.6}
.auth-switch{text-align:center;margin-top:16px;color:#666;font-size:.9rem}
.auth-switch span{color:#8B7355;cursor:pointer;margin-left:4px}
.modal-close-btn{position:absolute;top:12px;right:12px;background:none;border:none;font-size:1.5rem;color:#999;cursor:pointer}

/* 设置页面 */
.settings-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#2D3047 100%);z-index:3200;display:flex;flex-direction:column;overflow-y:auto;animation:slideUpProfile .3s ease-out}
.settings-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(244,228,193,.1)}
.settings-header button{background:none;border:none;color:#f4e4c1;font-size:1rem;cursor:pointer}
.settings-header h2{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.2rem}
.settings-content{padding:20px}
.settings-section{background:rgba(255,255,255,.05);border-radius:12px;padding:20px;margin-bottom:20px}
.settings-section h3{color:#f4e4c1;font-size:1rem;margin-bottom:12px;font-family:'ZCOOL XiaoWei',serif}
.settings-hint{color:rgba(244,228,193,.5);font-size:.85rem;margin-bottom:12px}
.settings-btn{background:linear-gradient(135deg,#8B7355,#6B5335);color:#f4e4c1;border:none;padding:10px 20px;border-radius:8px;font-size:.9rem;cursor:pointer;margin-right:10px;margin-top:8px}
.settings-btn:active{opacity:.8}
.settings-btn.logout-btn{background:rgba(231,76,60,.8)}
.settings-account{color:#f4e4c1}
.account-email{font-size:.95rem;margin-bottom:12px;word-break:break-all}
.sync-status{display:flex;align-items:center;gap:8px;font-size:.85rem;color:rgba(244,228,193,.7);margin-bottom:12px}
.sync-dot{width:8px;height:8px;border-radius:50%;background:#888}
.sync-dot.syncing{background:#f39c12;animation:pulse 1s infinite}
.sync-dot.success{background:#27ae60}
.sync-dot.error{background:#e74c3c}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.sync-time{color:rgba(244,228,193,.4);font-size:.8rem}
.invite-code-display{display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.2);padding:12px 16px;border-radius:8px;margin-top:12px}
.invite-code-display .code{font-size:1.4rem;font-family:monospace;color:#f4e4c1;letter-spacing:2px;flex:1}
.invite-code-display button{background:rgba(255,255,255,.15);color:#f4e4c1;border:none;padding:8px 14px;border-radius:6px;font-size:.85rem;cursor:pointer}
.settings-divider{height:1px;background:rgba(244,228,193,.1);margin:20px 0}
.invite-input-row{display:flex;gap:8px;margin-top:12px}
.invite-input-row input{flex:1;padding:10px 14px;border:1px solid rgba(244,228,193,.2);border-radius:8px;background:rgba(0,0,0,.2);color:#f4e4c1;font-size:1rem;text-transform:uppercase;letter-spacing:2px}
.invite-input-row input::placeholder{color:rgba(244,228,193,.3);text-transform:none;letter-spacing:0}
.invite-input-row button{padding:10px 14px;border-radius:8px;border:none;font-size:.9rem;cursor:pointer;background:rgba(255,255,255,.15);color:#f4e4c1}

/* 个人主页账号状态 */
.profile-account-status{padding:16px 24px;margin-top:auto}
.profile-account-status .logged-in{display:flex;align-items:center;gap:8px;color:rgba(244,228,193,.6);font-size:.85rem}
.profile-account-status .sync-indicator{width:6px;height:6px;border-radius:50%;background:#27ae60}
.profile-account-status .sync-indicator[data-status="syncing"]{background:#f39c12;animation:pulse 1s infinite}
.profile-account-status .sync-indicator[data-status="error"]{background:#e74c3c}
.profile-account-status .login-btn{width:100%;padding:14px;background:linear-gradient(135deg,#8B7355,#6B5335);color:#f4e4c1;border:none;border-radius:10px;font-size:1rem;cursor:pointer}
.profile-account-status .login-btn:active{opacity:.8}
`;
