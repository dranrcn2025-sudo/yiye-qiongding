import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

// Capacitor 文件系统（移动端导出用）
let Filesystem = null;
let Directory = null;
let Share = null;

// 动态加载 Capacitor 模块
const loadCapacitor = async () => {
  if (Filesystem) return true;
  try {
    const fsModule = await import('@capacitor/filesystem');
    Filesystem = fsModule.Filesystem;
    Directory = fsModule.Directory;
    const shareModule = await import('@capacitor/share');
    Share = shareModule.Share;
    return true;
  } catch (e) {
    console.log('Capacitor not available, using web fallback');
    return false;
  }
};

// 检测是否在 Capacitor 环境
const isCapacitor = () => {
  return window.Capacitor?.isNativePlatform?.() || false;
};

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
const CharacterDetailPage = ({ entry, onClose, onSave, isReadOnly, cardStyle, allTitlesMap, onLinkClick, bookName }) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [content, setContent] = useState('');
  const contentRef = useRef(null);
  
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
  
  return (
    <div className="character-detail-page">
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
      
      <div className="character-detail-content">
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
                {content ? (
                  <div ref={contentRef} className="detail-body" />
                ) : (
                  <p className="empty-hint">暂无详细设定，切换到编辑模式添加内容</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
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

// ============ 时间轴模式组件 ============

// 时间轴纪年设置弹窗
const AddEraModal = ({ isOpen, onClose, onSave, editingEra }) => {
  const [name, setName] = useState('');
  const [startLabel, setStartLabel] = useState('');
  const [months, setMonths] = useState(12);
  const [days, setDays] = useState(30);
  const [monthNames, setMonthNames] = useState('');
  const [gapFromPrevious, setGapFromPrevious] = useState(0);
  
  useEffect(() => {
    if (isOpen) {
      if (editingEra) {
        setName(editingEra.name || '');
        setStartLabel(editingEra.startLabel || '');
        setMonths(editingEra.months || 12);
        setDays(editingEra.days || 30);
        setMonthNames(editingEra.monthNames?.join('、') || '');
        setGapFromPrevious(editingEra.gapFromPrevious || 0);
      } else {
        setName('');
        setStartLabel('');
        setMonths(12);
        setDays(30);
        setMonthNames('');
        setGapFromPrevious(0);
      }
    }
  }, [isOpen, editingEra]);
  
  const handleSave = () => {
    if (!name.trim()) return;
    const monthNameList = monthNames.trim() ? monthNames.split(/[,，、\s]+/).filter(m => m.trim()) : null;
    onSave({
      id: editingEra?.id || generateId(),
      name: name.trim(),
      startLabel: startLabel.trim() || '1年',
      months: parseInt(months) || 12,
      days: parseInt(days) || 30,
      monthNames: monthNameList,
      gapFromPrevious: parseInt(gapFromPrevious) || 0,
      order: editingEra?.order || Date.now()
    });
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content era-modal" onClick={e => e.stopPropagation()}>
        <h3>{editingEra ? '编辑纪年' : '创建纪年'}</h3>
        <div className="form-field">
          <label>纪年名称</label>
          <input type="text" placeholder="如：大明、贞观、第一纪元" value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-field">
          <label>第一年怎么称呼？</label>
          <input type="text" placeholder="如：元年、1年（留空默认1年）" value={startLabel} onChange={e => setStartLabel(e.target.value)} />
        </div>
        <div className="era-number-row">
          <div className="era-number-field">
            <label>一年几个月</label>
            <input type="number" value={months} onChange={e => setMonths(e.target.value)} min="1" max="100" />
          </div>
          <div className="era-number-field">
            <label>一个月几天</label>
            <input type="number" value={days} onChange={e => setDays(e.target.value)} min="1" max="100" />
          </div>
        </div>
        <div className="form-field">
          <label>月份名称（可选）</label>
          <input type="text" placeholder="用顿号分隔，如：正月、二月...留空用数字" value={monthNames} onChange={e => setMonthNames(e.target.value)} />
        </div>
        <div className="era-gap-row">
          <label>与上一纪年间隔</label>
          <input type="number" value={gapFromPrevious} onChange={e => setGapFromPrevious(e.target.value)} min="0" />
          <span>年</span>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!name.trim()}>{editingEra ? '保存' : '创建'}</button>
        </div>
      </div>
    </div>
  );
};

// 添加时间节点弹窗
const AddEventModal = ({ isOpen, onClose, onSave, editingEvent, eras, years, allTitlesMap }) => {
  const [eraId, setEraId] = useState('');
  const [yearId, setYearId] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [content, setContent] = useState('');
  const [showOnMain, setShowOnMain] = useState(true);
  
  // 根据选中的纪年过滤年份
  const filteredYears = eraId ? years.filter(y => y.eraId === eraId) : [];
  
  useEffect(() => {
    if (isOpen) {
      if (editingEvent) {
        // 编辑模式：从yearId找到对应的year，再找到eraId
        const eventYear = years.find(y => y.id === editingEvent.yearId);
        if (eventYear) {
          setEraId(eventYear.eraId);
          setYearId(editingEvent.yearId);
        } else {
          // 如果找不到对应的year，使用最后一个纪年的最后一个年份
          const lastEra = eras[eras.length - 1];
          setEraId(lastEra?.id || '');
          const eraYears = years.filter(y => y.eraId === lastEra?.id);
          setYearId(eraYears[eraYears.length - 1]?.id || '');
        }
        setMonth(editingEvent.month?.toString() || '');
        setDay(editingEvent.day?.toString() || '');
        setContent(editingEvent.content || '');
        setShowOnMain(editingEvent.showOnMain !== false);
      } else {
        // 新建模式：默认选中【最后一个】纪年的【最后一个】年份
        const lastEra = eras[eras.length - 1];
        setEraId(lastEra?.id || '');
        const eraYears = years.filter(y => y.eraId === lastEra?.id);
        setYearId(eraYears[eraYears.length - 1]?.id || '');
        setMonth('');
        setDay('');
        setContent('');
        setShowOnMain(true);
      }
    }
  }, [isOpen, editingEvent, eras, years]);
  
  // 当纪年变化时，自动选中该纪年的最后一个年份（仅新建模式）
  useEffect(() => {
    if (eraId && !editingEvent && isOpen) {
      const eraYears = years.filter(y => y.eraId === eraId);
      const lastYearId = eraYears[eraYears.length - 1]?.id || '';
      setYearId(lastYearId);
    }
  }, [eraId]);
  
  const canSave = () => {
    return content.trim() && yearId;
  };
  
  const handleSave = () => {
    if (!canSave()) return;
    
    onSave({
      id: editingEvent?.id || generateId(),
      yearId,
      month: month ? parseInt(month) : null,
      day: day ? parseInt(day) : null,
      content: content.trim(),
      showOnMain,
      subTimelineId: editingEvent?.subTimelineId || null,
      order: editingEvent?.order || Date.now(),
      createdAt: editingEvent?.createdAt || Date.now(),
      updatedAt: Date.now()
    });
    onClose();
  };
  
  const selectedEra = eras.find(e => e.id === eraId);
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content event-modal" onClick={e => e.stopPropagation()}>
        <h3>{editingEvent ? '编辑事件' : '添加事件'}</h3>
        
        <div className="time-selector">
          <div className="time-row era-year-row">
            <select value={eraId} onChange={e => setEraId(e.target.value)} className="era-select">
              <option value="">选择纪年</option>
              {eras.map(era => <option key={era.id} value={era.id}>{era.name}</option>)}
            </select>
            <select value={yearId} onChange={e => setYearId(e.target.value)} className="year-select">
              <option value="">选择年份</option>
              {filteredYears.map(year => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </div>
          {selectedEra && (
            <div className="time-row month-day-row">
              <select value={month} onChange={e => setMonth(e.target.value)}>
                <option value="">月（可选）</option>
                {Array.from({ length: selectedEra.months || 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {selectedEra.monthNames?.[i] || `${i + 1}月`}
                  </option>
                ))}
              </select>
              <input type="number" placeholder="日" value={day} onChange={e => setDay(e.target.value)} min="1" max={selectedEra?.days || 30} />
            </div>
          )}
        </div>
        
        <div className="content-input">
          <label>发生了什么？</label>
          <textarea 
            placeholder="描述事件，可用【词条名】链接" 
            value={content} 
            onChange={e => setContent(e.target.value)}
            rows={3}
            autoFocus
          />
        </div>
        
        <label className="checkbox-label">
          <input type="checkbox" checked={showOnMain} onChange={e => setShowOnMain(e.target.checked)} />
          <span>同时显示在主时间轴</span>
        </label>
        
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!canSave()}>保存</button>
        </div>
      </div>
    </div>
  );
};

// 添加年份弹窗
const AddYearModal = ({ isOpen, onClose, onSave, editingYear, eras }) => {
  const [eraId, setEraId] = useState('');
  const [label, setLabel] = useState('');
  const [gapLabel, setGapLabel] = useState('');
  
  useEffect(() => {
    if (isOpen) {
      if (editingYear) {
        setEraId(editingYear.eraId || '');
        setLabel(editingYear.label || '');
        setGapLabel(editingYear.gapLabel || '');
      } else {
        setEraId(eras[0]?.id || '');
        setLabel('');
        setGapLabel('');
      }
    }
  }, [isOpen, editingYear, eras]);
  
  const handleSave = () => {
    if (!eraId || !label.trim()) return;
    
    onSave({
      id: editingYear?.id || generateId(),
      eraId,
      label: label.trim(),
      gapLabel: gapLabel.trim() || null, // 如"间隔3个月"，留空则不显示
      order: editingYear?.order || Date.now(),
      createdAt: editingYear?.createdAt || Date.now()
    });
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content year-modal" onClick={e => e.stopPropagation()}>
        <h3>{editingYear ? '编辑年份' : '添加年份'}</h3>
        
        {eras.length > 1 && (
          <div className="form-field">
            <label>所属纪年</label>
            <select value={eraId} onChange={e => setEraId(e.target.value)}>
              {eras.map(era => <option key={era.id} value={era.id}>{era.name}</option>)}
            </select>
          </div>
        )}
        
        <div className="form-field">
          <label>年份名称</label>
          <input 
            type="text" 
            placeholder="如：2年、贞观二年" 
            value={label} 
            onChange={e => setLabel(e.target.value)} 
            autoFocus 
          />
        </div>
        
        <div className="form-field">
          <label>与上一年的间隔（可选）</label>
          <input 
            type="text" 
            placeholder="如：3个月后、半年后（留空则连续）" 
            value={gapLabel} 
            onChange={e => setGapLabel(e.target.value)} 
          />
        </div>
        
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!label.trim()}>保存</button>
        </div>
      </div>
    </div>
  );
};

// 添加子时间轴弹窗
const AddSubTimelineModal = ({ isOpen, onClose, onSave, eras, characters }) => {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📜');
  const [linkedCharacterId, setLinkedCharacterId] = useState('');
  const [startEraId, setStartEraId] = useState('');
  const [startYear, setStartYear] = useState('');
  const [endEraId, setEndEraId] = useState('');
  const [endYear, setEndYear] = useState('');
  
  const icons = ['📜', '👤', '⚔️', '🏰', '🌍', '📖', '🗡️', '💫', '🔮', '👑'];
  
  useEffect(() => {
    if (isOpen) {
      setName('');
      setIcon('📜');
      setLinkedCharacterId('');
      setStartEraId(eras[0]?.id || '');
      setStartYear('');
      setEndEraId(eras[0]?.id || '');
      setEndYear('');
    }
  }, [isOpen, eras]);
  
  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: generateId(),
      name: name.trim(),
      icon,
      linkedCharacterId: linkedCharacterId || null,
      rangeStart: startEraId && startYear ? { eraId: startEraId, year: parseInt(startYear) } : null,
      rangeEnd: endEraId && endYear ? { eraId: endEraId, year: parseInt(endYear) } : null,
      createdAt: Date.now()
    });
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content sub-timeline-modal" onClick={e => e.stopPropagation()}>
        <h3>新建子时间轴</h3>
        <div className="icon-selector">
          {icons.map(i => (
            <span key={i} className={`icon-option ${icon === i ? 'selected' : ''}`} onClick={() => setIcon(i)}>{i}</span>
          ))}
        </div>
        <input type="text" placeholder="子轴名称（如：莉莉安的一生）" value={name} onChange={e => setName(e.target.value)} autoFocus />
        
        {characters && characters.length > 0 && (
          <select value={linkedCharacterId} onChange={e => setLinkedCharacterId(e.target.value)}>
            <option value="">关联人物（可选）</option>
            {characters.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        
        <div className="range-section">
          <label>时间范围（可选）</label>
          <div className="range-row">
            <select value={startEraId} onChange={e => setStartEraId(e.target.value)}>
              {eras.map(era => <option key={era.id} value={era.id}>{era.name}</option>)}
            </select>
            <input type="number" placeholder="起始年" value={startYear} onChange={e => setStartYear(e.target.value)} />
            <span>—</span>
            <select value={endEraId} onChange={e => setEndEraId(e.target.value)}>
              {eras.map(era => <option key={era.id} value={era.id}>{era.name}</option>)}
            </select>
            <input type="number" placeholder="结束年" value={endYear} onChange={e => setEndYear(e.target.value)} />
          </div>
        </div>
        
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={handleSave} disabled={!name.trim()}>创建</button>
        </div>
      </div>
    </div>
  );
};

// 时间轴+菜单
const TimelineAddMenu = ({ isOpen, onClose, onAddEvent, onAddYear, onAddEra, onManageSubTimelines, onReorder, isReordering }) => {
  if (!isOpen) return null;
  return (
    <>
      <div className="add-menu-overlay" onClick={onClose} />
      <div className="add-menu timeline-add-menu">
        <div className="add-menu-item" onClick={() => { onAddEvent(); onClose(); }}>
          <span className="menu-icon">📌</span>
          <span>添加事件</span>
        </div>
        <div className="add-menu-item" onClick={() => { onAddYear(); onClose(); }}>
          <span className="menu-icon">📆</span>
          <span>添加年份</span>
        </div>
        <div className="add-menu-item" onClick={() => { onAddEra(); onClose(); }}>
          <span className="menu-icon">📅</span>
          <span>添加纪年</span>
        </div>
        <div className="add-menu-item" onClick={() => { onManageSubTimelines(); onClose(); }}>
          <span className="menu-icon">📜</span>
          <span>子时间轴</span>
        </div>
        <div className={`add-menu-item ${isReordering ? 'active' : ''}`} onClick={() => { onReorder(); onClose(); }}>
          <span className="menu-icon">↕️</span>
          <span>{isReordering ? '完成排序' : '调整顺序'}</span>
        </div>
      </div>
    </>
  );
};

// 子时间轴列表页
const SubTimelineListPage = ({ isOpen, onClose, subTimelines, eras, onSelect, onAdd, onDelete }) => {
  const [confirmDelete, setConfirmDelete] = useState(null);
  
  if (!isOpen) return null;
  
  const getEraName = (eraId) => eras.find(e => e.id === eraId)?.name || '';
  
  const handleDelete = (st, e) => {
    e.stopPropagation();
    setConfirmDelete(st);
  };
  
  return (
    <div className="sub-timeline-page">
      <div className="sub-timeline-header">
        <button className="back-btn" onClick={onClose}>←</button>
        <h2>子时间轴</h2>
        <button className="add-btn" onClick={onAdd}>+</button>
      </div>
      <div className="sub-timeline-list">
        {subTimelines.length === 0 ? (
          <div className="empty-hint">
            <span>📜</span>
            <p>还没有子时间轴</p>
            <p>子轴可以记录某个角色或事件线的专属时间线</p>
          </div>
        ) : (
          subTimelines.map(st => (
            <div key={st.id} className="sub-timeline-card" onClick={() => onSelect(st)}>
              <span className="st-icon">{st.icon || '📜'}</span>
              <div className="st-info">
                <h3>{st.name}</h3>
                {st.rangeStart && st.rangeEnd && (
                  <p>{getEraName(st.rangeStart.eraId)}{st.rangeStart.year}年 — {getEraName(st.rangeEnd.eraId)}{st.rangeEnd.year}年</p>
                )}
              </div>
              <button className="st-delete" onClick={(e) => handleDelete(st, e)}>×</button>
            </div>
          ))
        )}
      </div>
      
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>删除子时间轴</h3>
            <p>确定要删除「{confirmDelete.name}」吗？</p>
            <p className="warning">该子轴下的专属事件将失去归属，但不会被删除</p>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="btn-delete" onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 时间轴主视图
const TimelineView = ({ 
  entry, 
  onAddEvent, 
  onEditEvent, 
  onDeleteEvent,
  onAddYear,
  onEditYear,
  onDeleteYear,
  onAddEra, 
  onEditEra, 
  onDeleteEra,
  expandedYears, 
  onToggleYear, 
  allTitlesMap, 
  onLinkClick,
  currentSubTimeline,
  onExitSubTimeline,
  isReordering,
  onReorderEvent
}) => {
  const config = entry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
  const eras = config.eras || [];
  const allYears = config.years || [];
  const allEvents = config.events || [];
  
  // 根据当前视图过滤事件
  const events = currentSubTimeline 
    ? allEvents.filter(e => e.subTimelineId === currentSubTimeline.id || e.showOnMain)
    : allEvents.filter(e => !e.subTimelineId || e.showOnMain);
  
  // 按order排序
  const sortedEras = [...eras].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  // 获取某纪年下的年份列表
  const getYearsForEra = (eraId) => {
    return allYears
      .filter(y => y.eraId === eraId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  
  // 获取某年份下的事件列表
  const getEventsForYear = (yearId) => {
    return events
      .filter(e => e.yearId === yearId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  };
  
  // 渲染事件内容（支持【】链接）
  const renderEventContent = (content) => {
    const parts = content.split(/(【[^】]+】)/g);
    return parts.map((part, i) => {
      const match = part.match(/【([^】]+)】/);
      if (match) {
        const keyword = match[1];
        const targets = allTitlesMap?.get?.(keyword);
        if (targets?.length) {
          return <span key={i} className="event-link" onClick={(e) => { e.stopPropagation(); onLinkClick(keyword, targets[0].bookId, targets[0].entry.id); }}>【{keyword}】</span>;
        }
        return <span key={i} className="event-link broken">【{keyword}】</span>;
      }
      return part;
    });
  };
  
  // 长按事件
  const [eventContextMenu, setEventContextMenu] = useState({ show: false, event: null, x: 0, y: 0 });
  const eventLongPress = useRef(null);
  
  const handleEventLongPress = (e, event) => {
    if (isReordering) return;
    const touch = e.touches?.[0] || e;
    eventLongPress.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setEventContextMenu({ show: true, event, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  
  const clearEventLongPress = () => {
    if (eventLongPress.current) {
      clearTimeout(eventLongPress.current);
      eventLongPress.current = null;
    }
  };
  
  // 长按纪年
  const [eraContextMenu, setEraContextMenu] = useState({ show: false, era: null, x: 0, y: 0 });
  const eraLongPress = useRef(null);
  
  const handleEraLongPress = (e, era) => {
    if (isReordering) return;
    const touch = e.touches?.[0] || e;
    eraLongPress.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setEraContextMenu({ show: true, era, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  
  const clearEraLongPress = () => {
    if (eraLongPress.current) {
      clearTimeout(eraLongPress.current);
      eraLongPress.current = null;
    }
  };
  
  // 长按年份
  const [yearContextMenu, setYearContextMenu] = useState({ show: false, year: null, x: 0, y: 0 });
  const yearLongPress = useRef(null);
  
  const handleYearLongPress = (e, year) => {
    if (isReordering) return;
    const touch = e.touches?.[0] || e;
    yearLongPress.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setYearContextMenu({ show: true, year, x: touch.clientX, y: touch.clientY });
    }, 500);
  };
  
  const clearYearLongPress = () => {
    if (yearLongPress.current) {
      clearTimeout(yearLongPress.current);
      yearLongPress.current = null;
    }
  };
  
  // 拖拽排序
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  
  const handleDragStart = (e, event) => {
    dragItem.current = event;
    e.target.style.opacity = '0.5';
  };
  
  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    if (dragItem.current && dragOverItem.current && dragItem.current.id !== dragOverItem.current.id) {
      onReorderEvent(dragItem.current.id, dragOverItem.current.id);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };
  
  const handleDragOver = (e, event) => {
    e.preventDefault();
    dragOverItem.current = event;
  };
  
  if (eras.length === 0) {
    return (
      <div className="timeline-empty">
        <span>📅</span>
        <h3>开始你的编年史</h3>
        <p>首先创建一个纪年来开始记录时间</p>
        <button onClick={onAddEra}>+ 创建纪年</button>
      </div>
    );
  }
  
  return (
    <div className={`timeline-view ${isReordering ? 'reordering' : ''}`}>
      {currentSubTimeline && (
        <div className="sub-timeline-banner">
          <span>{currentSubTimeline.icon}</span>
          <span>{currentSubTimeline.name}</span>
          <button onClick={onExitSubTimeline}>返回主轴</button>
        </div>
      )}
      
      {isReordering && (
        <div className="reorder-hint">拖拽事件卡片调整顺序</div>
      )}
      
      <div className="timeline-content">
        {sortedEras.map((era, eraIndex) => {
          const eraYears = getYearsForEra(era.id);
          
          return (
            <div key={era.id} className="timeline-era">
              {eraIndex > 0 && era.gapFromPrevious > 0 && (
                <div className="era-gap">
                  <span>间隔 {era.gapFromPrevious} 年</span>
                </div>
              )}
              
              <div 
                className="era-header"
                onTouchStart={(e) => handleEraLongPress(e, era)}
                onTouchEnd={clearEraLongPress}
                onTouchMove={clearEraLongPress}
              >
                <div className="era-name">{era.name}</div>
              </div>
              
              <div className="timeline-track">
                {eraYears.length === 0 ? (
                  <div className="no-events-hint">
                    <p className="hint-text">该纪年还没有年份</p>
                    <button className="add-first-event" onClick={() => onAddYear(era.id)}>+ 添加第一个年份</button>
                  </div>
                ) : (
                  eraYears.map((year, yearIndex) => {
                    const yearEvents = getEventsForYear(year.id);
                    const isExpanded = expandedYears.has(year.id);
                    
                    return (
                      <React.Fragment key={year.id}>
                        {yearIndex > 0 && year.gapLabel && (
                          <div className="year-gap">
                            <span>── {year.gapLabel} ──</span>
                          </div>
                        )}
                        
                        <div className="year-node">
                          <div 
                            className="year-marker"
                            onClick={() => yearEvents.length > 1 && onToggleYear(year.id)}
                            onTouchStart={(e) => handleYearLongPress(e, year)}
                            onTouchEnd={clearYearLongPress}
                            onTouchMove={clearYearLongPress}
                          >
                            <span className="node-dot">○</span>
                            <span className="node-year">{year.label}</span>
                            {yearEvents.length > 1 && (
                              <span className="event-count">
                                {isExpanded ? '▲' : `${yearEvents.length}个事件 ▼`}
                              </span>
                            )}
                          </div>
                          
                          <div className="year-events">
                            {yearEvents.length === 0 ? (
                              <button className="add-event-btn" onClick={() => onAddEvent(year.id)}>
                                + 添加事件
                              </button>
                            ) : (yearEvents.length === 1 || isExpanded) ? (
                              <>
                                {yearEvents.map(event => (
                                  <div 
                                    key={event.id} 
                                    className={`event-item ${isReordering ? 'draggable' : ''}`}
                                    draggable={isReordering}
                                    onDragStart={(e) => handleDragStart(e, event)}
                                    onDragEnd={handleDragEnd}
                                    onDragOver={(e) => handleDragOver(e, event)}
                                    onTouchStart={(e) => handleEventLongPress(e, event)}
                                    onTouchEnd={clearEventLongPress}
                                    onTouchMove={clearEventLongPress}
                                  >
                                    {isReordering && <span className="drag-handle">⋮⋮</span>}
                                    {event.month && (
                                      <span className="event-time">
                                        {era.monthNames?.[event.month - 1] || `${event.month}月`}
                                        {event.day && ` ${event.day}日`}
                                      </span>
                                    )}
                                    <span className="event-content">{renderEventContent(event.content)}</span>
                                    {event.subTimelineId && <span className="from-sub">📜</span>}
                                  </div>
                                ))}
                                <button className="add-event-btn inline" onClick={() => onAddEvent(year.id)}>
                                  + 添加
                                </button>
                              </>
                            ) : (
                              <div className="events-collapsed" onClick={() => onToggleYear(year.id)}>
                                <span className="first-event">{renderEventContent(yearEvents[0].content)}</span>
                                <span className="more-hint">...点击展开</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* 事件长按菜单 */}
      {eventContextMenu.show && (
        <>
          <div className="context-overlay" onClick={() => setEventContextMenu({ show: false })} />
          <div 
            className="context-menu"
            style={{ top: eventContextMenu.y, left: Math.min(eventContextMenu.x, window.innerWidth - 150) }}
          >
            <div className="context-item" onClick={() => { onEditEvent(eventContextMenu.event); setEventContextMenu({ show: false }); }}>
              <span className="context-icon">✏️</span>编辑
            </div>
            <div className="context-item danger" onClick={() => { onDeleteEvent(eventContextMenu.event.id); setEventContextMenu({ show: false }); }}>
              <span className="context-icon">🗑️</span>删除
            </div>
          </div>
        </>
      )}
      
      {/* 纪年长按菜单 */}
      {eraContextMenu.show && (
        <>
          <div className="context-overlay" onClick={() => setEraContextMenu({ show: false })} />
          <div 
            className="context-menu"
            style={{ top: eraContextMenu.y, left: Math.min(eraContextMenu.x, window.innerWidth - 150) }}
          >
            <div className="context-item" onClick={() => { onEditEra(eraContextMenu.era); setEraContextMenu({ show: false }); }}>
              <span className="context-icon">✏️</span>编辑纪年
            </div>
            <div className="context-item danger" onClick={() => { 
              if (window.confirm(`确定删除纪年「${eraContextMenu.era.name}」？\n该纪年下的所有年份和事件都会被删除！`)) {
                onDeleteEra(eraContextMenu.era.id); 
              }
              setEraContextMenu({ show: false }); 
            }}>
              <span className="context-icon">🗑️</span>删除纪年
            </div>
          </div>
        </>
      )}
      
      {/* 年份长按菜单 */}
      {yearContextMenu.show && (
        <>
          <div className="context-overlay" onClick={() => setYearContextMenu({ show: false })} />
          <div 
            className="context-menu"
            style={{ top: yearContextMenu.y, left: Math.min(yearContextMenu.x, window.innerWidth - 150) }}
          >
            <div className="context-item" onClick={() => { onEditYear(yearContextMenu.year); setYearContextMenu({ show: false }); }}>
              <span className="context-icon">✏️</span>编辑年份
            </div>
            <div className="context-item danger" onClick={() => { 
              if (window.confirm(`确定删除年份「${yearContextMenu.year.label}」？\n该年份下的所有事件都会被删除！`)) {
                onDeleteYear(yearContextMenu.year.id); 
              }
              setYearContextMenu({ show: false }); 
            }}>
              <span className="context-icon">🗑️</span>删除年份
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ============ 时间轴模式组件结束 ============

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
const AuthModal = ({ isOpen, onClose, mode, setMode, showToast }) => {
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
        showToast('注册成功！');
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
                  <button onClick={() => {
                    navigator.clipboard?.writeText(myInviteCode);
                    showToast('坐标已复制');
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

// 火箭坐标输入弹窗
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

  const handleInput1 = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    setCoord1(val);
    if (val.length === 3) {
      input2Ref.current?.focus();
    }
  };

  const handleInput2 = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    setCoord2(val);
  };

  const handleFly = async () => {
    const fullCode = coord1 + coord2;
    if (fullCode.length !== 6) {
      showToast('请输入完整的6位坐标');
      return;
    }
    setLoading(true);
    
    // 调用onFly，传入回调函数
    const result = await onFly(fullCode, () => {
      // 数据准备好了，开始飞行动画
      setLoading(false);
      setFlying(true);
      if (onLaunchStart) {
        onLaunchStart();
      }
    });
    
    if (result.error) {
      setLoading(false);
      showToast(result.error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`rocket-modal-overlay ${flying ? 'flying' : ''}`} onClick={flying ? undefined : onClose}>
      <div className={`rocket-modal ${flying ? 'flying' : ''}`} onClick={e => e.stopPropagation()}>
        {flying ? (
          <>
            <div className="rocket-modal-icon flying">🚀</div>
            <p className="rocket-modal-title">正在穿越星际...</p>
            <div className="flying-dots">
              <span></span><span></span><span></span>
            </div>
          </>
        ) : (
          <>
            <div className="rocket-modal-icon">🚀</div>
            <p className="rocket-modal-title">输入坐标，前往Ta的世界</p>
            <div className="rocket-coord-input">
              <span className="coord-prefix">α-</span>
              <input
                ref={input1Ref}
                type="text"
                value={coord1}
                onChange={handleInput1}
                placeholder="___"
                maxLength={3}
                className="coord-input"
              />
              <span className="coord-dot">·</span>
              <span className="coord-prefix">β-</span>
              <input
                ref={input2Ref}
                type="text"
                value={coord2}
                onChange={handleInput2}
                placeholder="___"
                maxLength={3}
                className="coord-input"
              />
            </div>
            <button 
              className="rocket-fly-btn" 
              onClick={handleFly}
              disabled={loading || coord1.length + coord2.length < 6}
            >
              {loading ? '连接中...' : '启航'}
            </button>
            <button className="rocket-cancel-btn" onClick={onClose}>取消</button>
          </>
        )}
      </div>
    </div>
  );
};
const ContextMenu = ({ isOpen, position, onClose, options }) => {
  const [expandedSubmenu, setExpandedSubmenu] = useState(null);
  
  useEffect(() => {
    if (!isOpen) setExpandedSubmenu(null);
  }, [isOpen]);
  
  if (!isOpen) return null;
  const menuH = options.length * 50 + 20;
  const spaceBelow = window.innerHeight - position.y;
  const top = spaceBelow < menuH ? Math.max(10, position.y - menuH) : position.y;
  
  return (
    <>
      <div className="context-overlay" onClick={onClose} />
      <div className="context-menu" style={{ top, left: Math.min(position.x, window.innerWidth - 180) }}>
        {options.map((o, i) => (
          o.submenu ? (
            <div key={i} className="context-item-wrapper">
              <div 
                className={`context-item has-submenu ${expandedSubmenu === i ? 'expanded' : ''}`} 
                onClick={() => setExpandedSubmenu(expandedSubmenu === i ? null : i)}
              >
                <span className="context-icon">{o.icon}</span>
                {o.label}
                <span className="submenu-arrow">{expandedSubmenu === i ? '▼' : '▶'}</span>
              </div>
              {expandedSubmenu === i && (
                <div className="context-submenu">
                  {o.submenu.map((sub, j) => (
                    <div 
                      key={j} 
                      className={`context-item submenu-item ${sub.active ? 'active' : ''}`} 
                      onClick={() => { sub.action(); onClose(); }}
                    >
                      <span className="context-icon">{sub.icon}</span>
                      {sub.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key={i} className={`context-item ${o.danger ? 'danger' : ''}`} onClick={() => { o.action(); onClose(); }}>
              <span className="context-icon">{o.icon}</span>{o.label}
            </div>
          )
        ))}
      </div>
    </>
  );
};

const EntryModal = ({ isOpen, onClose, onSave, editingEntry, parentTitle, isFolder }) => {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [createAsFolder, setCreateAsFolder] = useState(false);
  useEffect(() => { if (editingEntry) { setTitle(editingEntry.title || ''); setSummary(editingEntry.summary || ''); } else { setTitle(''); setSummary(''); setCreateAsFolder(isFolder || false); } }, [editingEntry, isOpen, isFolder]);
  if (!isOpen) return null;
  return (<div className="modal-overlay" onClick={onClose}><div className="modal-content" onClick={e => e.stopPropagation()}><h3>{editingEntry ? '编辑词条' : (createAsFolder ? '新建分类' : '新建词条')}</h3>{parentTitle && <p className="modal-hint">添加到: {parentTitle}</p>}<input type="text" placeholder="标题" value={title} onChange={e => setTitle(e.target.value)} autoFocus /><input type="text" placeholder="简介（可选）" value={summary} onChange={e => setSummary(e.target.value)} />{!editingEntry && <label className="checkbox-label"><input type="checkbox" checked={createAsFolder} onChange={e => setCreateAsFolder(e.target.checked)} /><span>创建为分类文件夹</span></label>}<div className="modal-actions"><button className="btn-cancel" onClick={onClose}>取消</button><button className="btn-save" onClick={() => { if (title.trim()) { onSave({ title: title.trim(), summary: summary.trim(), isFolder: createAsFolder }); onClose(); } }} disabled={!title.trim()}>{editingEntry ? '保存' : '创建'}</button></div></div></div>);
};

// 移动词条弹窗
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

const BookModal = ({ isOpen, onClose, onSave, editingBook }) => {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [tags, setTags] = useState('');
  const [emoji, setEmoji] = useState('📖');
  const [coverImage, setCoverImage] = useState(null);
  const [showStats, setShowStats] = useState(true);
  const [coverColor, setCoverColor] = useState('#8B7355');
  const fileRef = useRef(null);
  const emojis = ['📖', '🌙', '⭐', '🏯', '🗡️', '🌸', '🔮', '🐉', '🦋', '🌊', '🔥', '💎'];
  const colors = ['#8B7355', '#6B5344', '#5D4E6D', '#4A5568', '#2D3748', '#744210', '#285E61', '#702459', '#1A365D', '#22543D'];
  useEffect(() => { if (editingBook) { setTitle(editingBook.title); setAuthor(editingBook.author || ''); setTags(editingBook.tags?.join(', ') || ''); setEmoji(editingBook.cover); setCoverImage(editingBook.coverImage); setShowStats(editingBook.showStats !== false); setCoverColor(editingBook.color || '#8B7355'); } else { setTitle(''); setAuthor(''); setTags(''); setEmoji('📖'); setCoverImage(null); setShowStats(true); setCoverColor('#8B7355'); } }, [editingBook, isOpen]);
  if (!isOpen) return null;
  return (<div className="modal-overlay" onClick={onClose}><div className="modal-content book-modal" onClick={e => e.stopPropagation()}><h3>{editingBook ? '编辑书籍' : '新建世界'}</h3><input type="text" placeholder="书名" value={title} onChange={e => setTitle(e.target.value)} autoFocus /><input type="text" placeholder="作者（可选）" value={author} onChange={e => setAuthor(e.target.value)} /><input type="text" placeholder="标签，逗号分隔" value={tags} onChange={e => setTags(e.target.value)} /><label className="checkbox-label"><input type="checkbox" checked={showStats} onChange={e => setShowStats(e.target.checked)} /><span>显示字数统计</span></label><div className="cover-section"><p className="section-label">封面</p>{coverImage ? (<div className="cover-preview"><img src={coverImage} alt="" /><button className="remove-cover" onClick={() => setCoverImage(null)}>×</button></div>) : (<><div className="emoji-picker">{emojis.map(e => <span key={e} className={`emoji-option ${emoji === e ? 'selected' : ''}`} onClick={() => setEmoji(e)}>{e}</span>)}</div><p className="section-label" style={{marginTop:'12px'}}>封面底色</p><div className="color-picker">{colors.map(c => <span key={c} className={`color-option ${coverColor === c ? 'selected' : ''}`} style={{background:c}} onClick={() => setCoverColor(c)} />)}<label className="color-custom"><input type="color" value={coverColor} onChange={e => setCoverColor(e.target.value)} /><span style={{background:coverColor}}>+</span></label></div></>)}<button className="upload-cover-btn" onClick={() => fileRef.current?.click()}>📷 上传封面</button><input ref={fileRef} type="file" accept="image/*" onChange={async e => { const f = e.target.files[0]; if (f) setCoverImage(await compressImage(f, 400)); }} style={{ display: 'none' }} /></div><div className="modal-actions"><button className="btn-cancel" onClick={onClose}>取消</button><button className="btn-save" onClick={() => { if (title.trim()) { onSave({ title: title.trim(), author, tags: tags.split(',').map(t => t.trim()).filter(Boolean), emoji, coverImage, showStats, color: coverColor }); onClose(); } }} disabled={!title.trim()}>保存</button></div></div></div>);
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
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTarget, setMoveTarget] = useState(null); // 要移动的词条
  const avatarUploadRef = useRef(null);
  const bgUploadRef = useRef(null);
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '创作者');
  const [userShelfTitle, setUserShelfTitle] = useState(() => localStorage.getItem('userShelfTitle') || '');
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
  const touchStartY = useRef(0);
  const editorRef = useRef(null);
  const savedSelection = useRef(null);
  
  // 图书馆状态（导入的电子书）
  const [library, setLibrary] = useState(() => loadLibrary());
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryClosing, setLibraryClosing] = useState(false);
  const [libraryBook, setLibraryBook] = useState(null); // 当前阅读的图书馆书籍
  const [libraryChapterIndex, setLibraryChapterIndex] = useState(0);
  const [showLibraryReader, setShowLibraryReader] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const libraryUploadRef = useRef(null);
  
  // 画廊关闭状态
  const [galleryClosing, setGalleryClosing] = useState(false);
  // 设置关闭状态
  const [settingsClosing, setSettingsClosing] = useState(false);

  // 认证状态
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // login | register
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | success | error
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [myInviteCode, setMyInviteCode] = useState(null);
  // 坐标飞行相关
  const [showRocketModal, setShowRocketModal] = useState(false); // 火箭输入弹窗
  const [visitingBookshelf, setVisitingBookshelf] = useState(null); // 正在访问的书架数据
  const [visitingProfile, setVisitingProfile] = useState(null); // 正在访问的用户资料
  const [showRocketBtn, setShowRocketBtn] = useState(() => localStorage.getItem('showRocketBtn') !== 'false');
  const [characterCardStyle, setCharacterCardStyle] = useState(() => localStorage.getItem('characterCardStyle') || 'dark');
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [showCharacterDetail, setShowCharacterDetail] = useState(null);
  const [showRelationNetwork, setShowRelationNetwork] = useState(false);
  const [showCharacterAddMenu, setShowCharacterAddMenu] = useState(false);
  // 时间轴模式状态
  const [showTimelineSettings, setShowTimelineSettings] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [showSubTimelines, setShowSubTimelines] = useState(false);
  const [currentSubTimeline, setCurrentSubTimeline] = useState(null);
  const [expandedYears, setExpandedYears] = useState(new Set());
  const [editingEvent, setEditingEvent] = useState(null);
  const [showTimelineAddMenu, setShowTimelineAddMenu] = useState(false);
  const [showAddSubTimelineModal, setShowAddSubTimelineModal] = useState(false);
  const [showAddEraModal, setShowAddEraModal] = useState(false);
  const [editingEra, setEditingEra] = useState(null);
  const [showAddYearModal, setShowAddYearModal] = useState(false);
  const [editingYear, setEditingYear] = useState(null);
  const [isTimelineReordering, setIsTimelineReordering] = useState(false);
  // 书籍排序相关
  const [isBookReorderMode, setIsBookReorderMode] = useState(false);
  const [draggingBookId, setDraggingBookId] = useState(null);
  // Toast提示
  const [toast, setToast] = useState({ show: false, message: '' });
  const showToast = (message, duration = 2000) => {
    setToast({ show: true, message });
    setTimeout(() => setToast({ show: false, message: '' }), duration);
  };

  // 导出书籍为.yyd文件
  const exportBook = async (book) => {
    try {
      const exportData = {
        version: '1.0',
        type: 'yyd-book',
        exportTime: new Date().toISOString(),
        book: {
          title: book.title,
          author: book.author,
          cover: book.cover,
          color: book.color,
          coverImage: book.coverImage,
          entries: book.entries,
          gallery: book.gallery,
          settings: book.settings
        }
      };
      
      const jsonStr = JSON.stringify(exportData, null, 2);
      const fileName = `${book.title}.yyd`;
      
      // 移动端使用 Capacitor
      if (isCapacitor()) {
        await loadCapacitor();
        if (Filesystem && Share) {
          // 先保存到缓存目录
          const result = await Filesystem.writeFile({
            path: fileName,
            data: btoa(unescape(encodeURIComponent(jsonStr))),
            directory: Directory.Cache
          });
          
          // 然后触发分享（让用户选择保存位置）
          await Share.share({
            title: `导出「${book.title}」`,
            text: `一页穹顶书籍文件`,
            url: result.uri,
            dialogTitle: '保存书籍文件'
          });
          
          showToast(`已导出「${book.title}」`);
        } else {
          throw new Error('Capacitor modules not loaded');
        }
      } else {
        // 网页端使用下载
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`已导出「${book.title}」`);
      }
    } catch (err) {
      console.error('导出失败:', err);
      showToast('导出失败');
    }
  };

  // 递归重新生成所有ID
  const regenerateIds = (entries, idMap = new Map()) => {
    return entries.map(entry => {
      const oldId = entry.id;
      const newId = generateId();
      idMap.set(oldId, newId);
      
      const newEntry = {
        ...entry,
        id: newId
      };
      
      // 处理人物关系中的ID引用
      if (entry.characterRelations) {
        newEntry.characterRelations = entry.characterRelations.map(rel => ({
          ...rel,
          id: generateId(),
          from: idMap.get(rel.from) || rel.from,
          to: idMap.get(rel.to) || rel.to
        }));
      }
      
      // 处理时间轴配置中的ID
      if (entry.timelineConfig) {
        const eraIdMap = new Map();
        const yearIdMap = new Map();
        
        newEntry.timelineConfig = {
          eras: (entry.timelineConfig.eras || []).map(era => {
            const newEraId = generateId();
            eraIdMap.set(era.id, newEraId);
            return { ...era, id: newEraId };
          }),
          years: (entry.timelineConfig.years || []).map(year => {
            const newYearId = generateId();
            yearIdMap.set(year.id, newYearId);
            return { 
              ...year, 
              id: newYearId,
              eraId: eraIdMap.get(year.eraId) || year.eraId
            };
          }),
          events: (entry.timelineConfig.events || []).map(event => ({
            ...event,
            id: generateId(),
            yearId: yearIdMap.get(event.yearId) || event.yearId
          })),
          subTimelines: (entry.timelineConfig.subTimelines || []).map(st => ({
            ...st,
            id: generateId()
          }))
        };
      }
      
      // 递归处理子条目
      if (entry.children?.length > 0) {
        newEntry.children = regenerateIds(entry.children, idMap);
      }
      
      return newEntry;
    });
  };

  // 导入书籍文件的ref
  const importBookRef = useRef(null);

  // 导入书籍
  const handleImportYYD = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      // 校验文件格式
      if (importData.type !== 'yyd-book' || !importData.book) {
        showToast('文件格式不正确');
        return;
      }
      
      const bookData = importData.book;
      
      // 检查是否已存在同名书籍
      const existingBook = data.books.find(b => b.title === bookData.title);
      if (existingBook) {
        if (!window.confirm(`已存在「${bookData.title}」，是否覆盖？\n选择"取消"将创建副本。`)) {
          bookData.title = `${bookData.title} (导入)`;
        } else {
          // 覆盖：删除旧书
          setData(prev => ({
            ...prev,
            books: prev.books.filter(b => b.id !== existingBook.id)
          }));
        }
      }
      
      // 重新生成所有ID
      const newEntries = regenerateIds(bookData.entries || []);
      
      // 处理画廊图片ID
      let newGallery = bookData.gallery;
      if (newGallery?.images) {
        newGallery = {
          ...newGallery,
          images: newGallery.images.map(img => ({
            ...img,
            id: generateId()
          }))
        };
      }
      
      const newBook = {
        id: generateId(),
        title: bookData.title,
        author: bookData.author || '',
        cover: bookData.cover || '📚',
        color: bookData.color || '#8B7355',
        coverImage: bookData.coverImage || null,
        entries: newEntries,
        gallery: newGallery || { enabled: false, images: [] },
        settings: bookData.settings || {}
      };
      
      setData(prev => ({
        ...prev,
        books: [...prev.books, newBook]
      }));
      
      showToast(`已导入「${newBook.title}」`);
    } catch (err) {
      console.error('导入失败:', err);
      showToast('导入失败，请检查文件格式');
    }
    
    // 清空input以允许重复选择同一文件
    e.target.value = '';
  };

  // 返航动画
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const [returnAnimating, setReturnAnimating] = useState(false); // false | 'up' | 'down'
  const [launchAnimating, setLaunchAnimating] = useState(false); // false | 'up' | 'down'
  const lastUserId = useRef(null); // 追踪上一个用户ID

  // 初始化认证状态
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      lastUserId.current = session?.user?.id ?? null;
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      const newUserId = newUser?.id ?? null;
      
      // 如果用户变了（包括登出），清空本地数据
      if (lastUserId.current !== newUserId) {
        // 清空本地存储
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem('lastUpdated');
        
        if (!newUser) {
          // 登出：重置为初始数据
          setData(initialData);
        }
        // 登录：数据会在 loadCloudData 中加载
        
        lastUserId.current = newUserId;
      }
      
      setUser(newUser);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 处理浏览器/手机返回键
  useEffect(() => {
    const handlePopState = (e) => {
      // 阻止默认退出行为，执行应用内返回
      if (showCharacterDetail) {
        setShowCharacterDetail(null);
      } else if (showRelationNetwork) {
        setShowRelationNetwork(false);
      } else if (showGallery) {
        setGalleryClosing(true);
        setTimeout(() => { setShowGallery(false); setGalleryClosing(false); }, 280);
      } else if (showSettings) {
        setSettingsClosing(true);
        setTimeout(() => { setShowSettings(false); setSettingsClosing(false); }, 280);
      } else if (showLibrary) {
        setLibraryClosing(true);
        setTimeout(() => { setShowLibrary(false); setLibraryClosing(false); }, 280);
      } else if (showStoryReader) {
        setShowStoryReader(false);
      } else if (showStoryToc) {
        setShowStoryToc(false);
      } else if (currentEntry || navigationStack.length > 0) {
        handleBack();
      } else if (currentBook) {
        handleBackToShelf();
      }
      // 重新push一个state，保持history栈
      window.history.pushState({ app: true }, '');
    };
    
    // 初始push一个state
    window.history.pushState({ app: true }, '');
    window.addEventListener('popstate', handlePopState);
    
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentBook, currentEntry, navigationStack, showCharacterDetail, showRelationNetwork, showGallery, showSettings, showLibrary, showStoryReader, showStoryToc]);

  // 用户登录后加载云端数据
  useEffect(() => {
    if (user) {
      loadCloudData();
      loadMyInviteCode();
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
        // 直接使用云端数据，不比较时间戳
        setData(cloudData.data);
        saveToStorage(cloudData.data);
        localStorage.setItem('lastUpdated', new Date(cloudData.updated_at).getTime().toString());
        setLastSyncTime(new Date(cloudData.updated_at));
        
        // 恢复用户资料到localStorage和state
        if (cloudData.data.profile) {
          const profile = cloudData.data.profile;
          if (profile.name) {
            localStorage.setItem('userName', profile.name);
            setUserName(profile.name);
          }
          if (profile.bio !== undefined) {
            localStorage.setItem('userBio', profile.bio);
            setUserBio(profile.bio);
          }
          if (profile.shelfTitle !== undefined) {
            localStorage.setItem('userShelfTitle', profile.shelfTitle);
            setUserShelfTitle(profile.shelfTitle);
          }
        }
      } else {
        // 云端没有数据，使用初始数据并上传
        setData(initialData);
        saveToStorage(initialData);
        await saveToCloud(initialData);
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
      // 构建完整的云端数据，包含用户资料
      const cloudData = {
        ...dataToSave,
        profile: {
          name: localStorage.getItem('userName') || '创作者',
          bio: localStorage.getItem('userBio') || '',
          shelfTitle: localStorage.getItem('userShelfTitle') || ''
        }
      };
      
      const { error } = await supabase
        .from('user_data')
        .upsert({
          user_id: user.id,
          data: cloudData,
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
      showToast('生成失败：' + error.message);
      return;
    }
    
    setMyInviteCode(code);
  };

  // 重置邀请码（旧码失效）
  const resetInviteCode = async () => {
    if (!user || !myInviteCode) return;
    
    // 删除旧邀请码
    await supabase
      .from('invitations')
      .delete()
      .eq('owner_id', user.id);
    
    // 生成新邀请码
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await supabase
      .from('invitations')
      .insert({ code: newCode, owner_id: user.id });
    
    if (error) {
      showToast('重置失败：' + error.message);
      return;
    }
    
    setMyInviteCode(newCode);
    showToast('坐标已重置！旧坐标已失效');
  };

  // 格式化坐标显示 (A7G2K9 -> α-A7G · β-2K9)
  const formatCoordinate = (code) => {
    if (!code || code.length !== 6) return code;
    return `α-${code.slice(0, 3)} · β-${code.slice(3, 6)}`;
  };

  // 通过坐标飞行到目标书架
  const flyToCoordinate = async (code, onDataReady) => {
    if (!code || code.length !== 6) {
      return { success: false, error: '请输入完整的6位坐标' };
    }
    
    // 查找邀请码
    const { data: invitation, error } = await supabase
      .from('invitations')
      .select('owner_id')
      .eq('code', code.toUpperCase())
      .single();
    
    if (error || !invitation) {
      return { success: false, error: '坐标无效或不存在' };
    }
    
    if (user && invitation.owner_id === user.id) {
      return { success: false, error: '这是你自己的坐标哦' };
    }
    
    // 加载目标用户的书架
    const { data: userData } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', invitation.owner_id)
      .single();
    
    if (!userData?.data) {
      return { success: false, error: '目标世界暂无数据' };
    }
    
    const bookshelfData = userData.data;
    // 过滤掉锁定的书籍
    bookshelfData.books = bookshelfData.books?.filter(b => !b.locked) || [];
    
    const profile = bookshelfData.profile || { name: '神秘旅人', bio: '', shelfTitle: '' };
    
    // 通知数据已准备好，可以开始动画
    if (onDataReady) {
      onDataReady();
    }
    
    // 等待星球升起动画完成后再切换数据
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    setVisitingBookshelf(bookshelfData);
    setVisitingProfile(profile);
    setShowRocketModal(false);
    
    // 开始星球降下动画
    setLaunchAnimating('down');
    setTimeout(() => {
      setLaunchAnimating(false);
    }, 1200);
    
    return { success: true };
  };

  // 返航确认和动画
  const confirmReturn = () => {
    setShowReturnConfirm(false);
    setReturnAnimating('up'); // 第一阶段：球升起
    
    // 球升起动画完成后（1.2秒）
    setTimeout(() => {
      // 趁星球挡住屏幕时切换数据
      setVisitingBookshelf(null);
      setVisitingProfile(null);
      setReturnAnimating('down'); // 第二阶段：球降下
      
      // 球降下动画完成后（1.2秒）
      setTimeout(() => {
        setReturnAnimating(false);
      }, 1200);
    }, 1200);
  };

  // 旧的返航函数保留兼容
  const returnHome = () => {
    setShowReturnConfirm(true);
  };

  // 切换火箭按钮显示
  const toggleRocketBtn = (show) => {
    setShowRocketBtn(show);
    localStorage.setItem('showRocketBtn', show.toString());
  };

  const changeCardStyle = (style) => {
    setCharacterCardStyle(style);
    localStorage.setItem('characterCardStyle', style);
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
    // 防抖保存到云端（访问他人书架时不保存）
    if (user && !visitingBookshelf) {
      const timer = setTimeout(() => {
        saveToCloud(data);
      }, 2000); // 2秒防抖
      return () => clearTimeout(timer);
    }
  }, [data, user, visitingBookshelf]);
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
        showToast('不支持的文件格式，请选择txt或epub文件');
        setImportLoading(false);
        return;
      }
      
      setLibrary(prev => ({
        ...prev,
        books: [...prev.books, book]
      }));
      
      showToast(`《${book.title}》导入成功！共${book.chapters.length}章`);
    } catch (err) {
      console.error('导入失败:', err);
      showToast('导入失败: ' + err.message);
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
  
  // 关闭图书馆（带动画）
  const closeLibrary = () => {
    setLibraryClosing(true);
    setTimeout(() => {
      setShowLibrary(false);
      setLibraryClosing(false);
    }, 280);
  };
  
  // 关闭画廊（带动画）
  const closeGallery = () => {
    setGalleryClosing(true);
    setTimeout(() => {
      setShowTotalGallery(false);
      setGalleryClosing(false);
    }, 280);
  };
  
  // 关闭设置（带动画）
  const closeSettings = () => {
    setSettingsClosing(true);
    setTimeout(() => {
      setShowSettings(false);
      setSettingsClosing(false);
    }, 280);
  };
  
  const allTitlesMap = useMemo(() => {
    const booksSource = visitingBookshelf ? visitingBookshelf.books : data.books;
    return collectAllLinkableTitles(booksSource);
  }, [data.books, visitingBookshelf]);
  
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
        // 如果是文件夹，添加特殊模式选项（正文/人设/时间轴互斥）
        if (item.isFolder) {
          const currentMode = item.novelMode ? 'novel' : item.characterMode ? 'character' : item.timelineMode ? 'timeline' : null;
          opts.push({ 
            icon: currentMode ? '✓' : '📋', 
            label: currentMode === 'novel' ? '正文模式 ✓' : currentMode === 'character' ? '人设模式 ✓' : currentMode === 'timeline' ? '时间轴模式 ✓' : '开启特殊模式',
            submenu: [
              { 
                icon: currentMode === 'novel' ? '✓' : '📖', 
                label: '正文模式',
                active: currentMode === 'novel',
                action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, item.id, { novelMode: currentMode !== 'novel', characterMode: false, timelineMode: false }) } : b) }))
              },
              { 
                icon: currentMode === 'character' ? '✓' : '👤', 
                label: '人设模式',
                active: currentMode === 'character',
                action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, item.id, { novelMode: false, characterMode: currentMode !== 'character', timelineMode: false, characterRelations: item.characterRelations || [] }) } : b) }))
              },
              { 
                icon: currentMode === 'timeline' ? '✓' : '📅', 
                label: '时间轴模式',
                active: currentMode === 'timeline',
                action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, item.id, { novelMode: false, characterMode: false, timelineMode: currentMode !== 'timeline', timelineConfig: item.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] } }) } : b) }))
              }
            ]
          });
        }
        opts.push({ icon: '📁', label: '移动到...', action: () => { setMoveTarget(item); setShowMoveModal(true); } });
        opts.push({ icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: `删除「${item.title}」？`, onConfirm: () => { setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: deleteEntryFromTree(b.entries, item.id) } : b) })); if (currentEntry?.id === item.id) handleBack(); setConfirmModal({ isOpen: false }); } }) });
      } else if (type === 'book') { 
        opts = [
          { icon: '✏️', label: '编辑', action: () => { setEditingBook(item); setShowBookModal(true); } }, 
          { icon: '↕️', label: '移动', action: () => { setIsBookReorderMode(true); setDraggingBookId(item.id); } },
          { icon: '📤', label: '导出书籍', action: () => exportBook(item) },
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
      } else if (e.characterMode) {
        // 人设模式
        setViewMode('character');
      } else if (e.timelineMode) {
        // 时间轴模式
        setViewMode('timeline');
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
    
    // 访问模式下使用visitingBookshelf，否则使用data
    const booksSource = visitingBookshelf ? visitingBookshelf.books : data.books;
    const tb = booksSource.find(b => b.id === tbid); 
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
  }, [currentBook, currentEntry, viewMode, data.books, visitingBookshelf, initMerged]);

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
  
  // 移动词条到新位置
  const handleMoveEntry = (entryId, targetParentId) => {
    if (!currentBook) return;
    
    // 找到要移动的词条
    const entryToMove = findEntryById(currentBook.entries, entryId);
    if (!entryToMove) return;
    
    // 复制词条（深拷贝）
    const entryCopy = JSON.parse(JSON.stringify(entryToMove));
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => {
        if (b.id !== currentBook.id) return b;
        
        // 先从原位置删除
        let newEntries = deleteEntryFromTree(b.entries, entryId);
        
        // 再添加到目标位置
        if (targetParentId === null) {
          // 移动到根目录
          newEntries = [...newEntries, entryCopy];
        } else {
          // 移动到某个文件夹内
          newEntries = addEntryToParent(newEntries, targetParentId, entryCopy);
        }
        
        return { ...b, entries: newEntries };
      })
    }));
    
    showToast(`已移动「${entryToMove.title}」`);
  };

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

  // ============ 人设模式函数 ============
  
  // 添加人设
  const handleAddCharacter = (charData) => {
    if (!currentEntry?.characterMode) return;
    
    const newChar = {
      id: generateId(),
      title: charData.title,
      summary: charData.summary || '',
      content: '',
      isFolder: false,
      linkable: false,
      avatar: charData.avatar || null,
      tags: charData.tags || []
    };
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          children: [...(currentEntry.children || []), newChar]
        })
      } : b)
    }));
  };
  
  // 更新人设
  const handleUpdateCharacter = (charData) => {
    if (!editingCharacter) return;
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, editingCharacter.id, {
          title: charData.title,
          summary: charData.summary || '',
          avatar: charData.avatar || null,
          tags: charData.tags || []
        })
      } : b)
    }));
    
    setEditingCharacter(null);
  };
  
  // 添加关系
  const handleAddRelation = (relation) => {
    if (!currentEntry?.characterMode) return;
    
    const currentRelations = currentEntry.characterRelations || [];
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          characterRelations: [...currentRelations, relation]
        })
      } : b)
    }));
  };
  
  // 删除关系
  const handleDeleteRelation = (relationId) => {
    if (!currentEntry?.characterMode) return;
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          characterRelations: (currentEntry.characterRelations || []).filter(r => r.id !== relationId)
        })
      } : b)
    }));
  };
  
  // 更新关系（包括故事备忘）
  const handleUpdateRelation = (updatedRelation) => {
    if (!currentEntry?.characterMode) return;
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          characterRelations: (currentEntry.characterRelations || []).map(r => 
            r.id === updatedRelation.id ? updatedRelation : r
          )
        })
      } : b)
    }));
  };
  
  // 人设卡片点击
  const handleCharacterClick = (char) => {
    setShowCharacterDetail(char);
  };
  
  // 人设卡片长按
  const handleCharacterLongPress = (e, char) => {
    const touch = e.touches?.[0] || e;
    const pos = { x: touch.clientX, y: touch.clientY };
    const opts = [
      { icon: '✏️', label: '编辑', action: () => { setEditingCharacter(char); setShowCharacterModal(true); } },
      { icon: char.linkable ? '🚫' : '⭐', label: char.linkable ? '关闭跳转' : '开启跳转', action: () => setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, char.id, { linkable: !char.linkable }) } : b) })) },
      { icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: `删除人设「${char.title}」？`, onConfirm: () => { setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: deleteEntryFromTree(b.entries, char.id) } : b) })); setConfirmModal({ isOpen: false }); } }) }
    ];
    setContextMenu({ isOpen: true, position: pos, options: opts });
  };
  
  // ============ 人设模式函数结束 ============

  // ============ 时间轴模式函数 ============
  
  // 添加纪年
  const handleAddEra = (eraData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEras = [...(config.eras || []), eraData];
    
    // 同时创建第一个年份
    const firstYear = {
      id: generateId(),
      eraId: eraData.id,
      label: eraData.startLabel || '1年',
      gapLabel: null,
      order: Date.now(),
      createdAt: Date.now()
    };
    const newYears = [...(config.years || []), firstYear];
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: newEras,
            years: newYears,
            events: config.events || [],
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 更新纪年
  const handleUpdateEra = (eraData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEras = (config.eras || []).map(e => e.id === eraData.id ? eraData : e);
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: newEras,
            years: config.years || [],
            events: config.events || [],
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
    setEditingEra(null);
  };
  
  // 删除纪年
  const handleDeleteEra = (eraId) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEras = (config.eras || []).filter(e => e.id !== eraId);
    // 获取该纪年下的所有年份ID
    const yearIdsToDelete = (config.years || []).filter(y => y.eraId === eraId).map(y => y.id);
    // 删除该纪年下的年份
    const newYears = (config.years || []).filter(y => y.eraId !== eraId);
    // 删除这些年份下的所有事件
    const newEvents = (config.events || []).filter(e => !yearIdsToDelete.includes(e.yearId));
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: newEras,
            years: newYears,
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 添加年份
  const handleAddYear = (yearData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newYears = [...(config.years || []), yearData];
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: newYears,
            events: config.events || [],
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 更新年份
  const handleUpdateYear = (yearData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newYears = (config.years || []).map(y => y.id === yearData.id ? yearData : y);
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: newYears,
            events: config.events || [],
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
    setEditingYear(null);
  };
  
  // 删除年份
  const handleDeleteYear = (yearId) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newYears = (config.years || []).filter(y => y.id !== yearId);
    // 删除该年份下的所有事件
    const newEvents = (config.events || []).filter(e => e.yearId !== yearId);
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: newYears,
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 添加事件
  const handleAddTimelineEvent = (eventData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEvents = [...(config.events || []), eventData];
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 更新事件
  const handleUpdateTimelineEvent = (eventData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEvents = (config.events || []).map(e => e.id === eventData.id ? eventData : e);
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
    setEditingEvent(null);
  };
  
  // 删除事件
  const handleDeleteTimelineEvent = (eventId) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newEvents = (config.events || []).filter(e => e.id !== eventId);
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 重排事件顺序
  const handleReorderEvent = (draggedId, targetId) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const events = [...(config.events || [])];
    
    const draggedIndex = events.findIndex(e => e.id === draggedId);
    const targetIndex = events.findIndex(e => e.id === targetId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // 移动事件
    const [draggedEvent] = events.splice(draggedIndex, 1);
    events.splice(targetIndex, 0, draggedEvent);
    
    // 更新order
    const newEvents = events.map((e, i) => ({ ...e, order: i * 1000 }));
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: newEvents,
            subTimelines: config.subTimelines || []
          }
        })
      } : b)
    }));
  };
  
  // 添加子时间轴
  const handleAddSubTimeline = (subTimelineData) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newSubTimelines = [...(config.subTimelines || []), subTimelineData];
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: config.events || [],
            subTimelines: newSubTimelines
          }
        })
      } : b)
    }));
  };
  
  // 删除子时间轴
  const handleDeleteSubTimeline = (subTimelineId) => {
    if (!currentEntry?.timelineMode) return;
    
    const config = currentEntry.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] };
    const newSubTimelines = (config.subTimelines || []).filter(st => st.id !== subTimelineId);
    // 同时清除事件中对该子轴的引用
    const newEvents = (config.events || []).map(e => 
      e.subTimelineId === subTimelineId ? { ...e, subTimelineId: null } : e
    );
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, currentEntry.id, {
          timelineConfig: { 
            eras: config.eras || [],
            years: config.years || [],
            events: newEvents,
            subTimelines: newSubTimelines
          }
        })
      } : b)
    }));
    
    if (currentSubTimeline?.id === subTimelineId) {
      setCurrentSubTimeline(null);
    }
  };
  
  // 切换年份展开
  const handleToggleYear = (yearKey) => {
    setExpandedYears(prev => {
      const newSet = new Set(prev);
      if (newSet.has(yearKey)) {
        newSet.delete(yearKey);
      } else {
        newSet.add(yearKey);
      }
      return newSet;
    });
  };
  
  // ============ 时间轴模式函数结束 ============

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
      showToast('最多只能展示6张图片');
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
    // 延迟触发云同步（防抖）
    if (user) {
      clearTimeout(window.profileSyncTimer);
      window.profileSyncTimer = setTimeout(() => saveToCloud(data), 2000);
    }
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
    // 延迟触发云同步（防抖）
    if (user) {
      clearTimeout(window.profileSyncTimer);
      window.profileSyncTimer = setTimeout(() => saveToCloud(data), 2000);
    }
  };

  // 保存书架标题
  const saveShelfTitle = (title) => {
    setUserShelfTitle(title);
    localStorage.setItem('userShelfTitle', title);
    // 延迟触发云同步（防抖）
    if (user) {
      clearTimeout(window.profileSyncTimer);
      window.profileSyncTimer = setTimeout(() => saveToCloud(data), 2000);
    }
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
    
    showToast('正在生成图片...');
    
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
      
      const fileName = `${currentEntry?.title || '词条'}_${Date.now()}.png`;
      
      // 移动端使用 Capacitor
      if (isCapacitor()) {
        await loadCapacitor();
        if (Filesystem && Share) {
          // 获取 base64 数据（去掉前缀）
          const dataUrl = canvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          
          // 保存到缓存目录
          const result = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache
          });
          
          // 触发分享让用户保存
          await Share.share({
            title: fileName,
            url: result.uri,
            dialogTitle: '保存图片'
          });
          
          showToast('图片已生成');
        } else {
          throw new Error('Capacitor modules not loaded');
        }
      } else {
        // 网页端使用下载
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();
        showToast('图片已保存');
      }
    } catch (err) {
      console.error('导出失败:', err);
      showToast('导出失败，请稍后重试');
    }
  };

  // 保存画廊图片
  const saveGalleryImage = async (imgSrc) => {
    try {
      const fileName = `image_${Date.now()}.png`;
      
      if (isCapacitor()) {
        await loadCapacitor();
        if (Filesystem && Share) {
          // 从 base64 或 URL 获取数据
          let base64Data = imgSrc;
          if (imgSrc.startsWith('data:')) {
            base64Data = imgSrc.replace(/^data:image\/[^;]+;base64,/, '');
          }
          
          const result = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache
          });
          
          await Share.share({
            title: fileName,
            url: result.uri,
            dialogTitle: '保存图片'
          });
          
          showToast('图片已保存');
        }
      } else {
        const link = document.createElement('a');
        link.href = imgSrc;
        link.download = fileName;
        link.click();
        showToast('图片已保存');
      }
    } catch (err) {
      console.error('保存图片失败:', err);
      showToast('保存失败');
    }
  };

  const currentEntries = currentEntry?.children || currentBook?.entries || [];
  
  // 从最新数据中获取当前 entry（确保排序等更新后能同步）
  const liveEntry = currentEntry ? findEntryById(currentBook?.entries || [], currentEntry.id) || currentEntry : null;
  const liveChildContent = liveEntry ? getAllChildContent(liveEntry, currentBook?.entries || []) : [];
  
  // 好友视图时强制只读模式
  const effectiveReadOnly = visitingBookshelf ? true : isReadOnly;
  const isEditing = !effectiveReadOnly && (viewMode === 'single' || viewMode === 'merged');
  const hasActiveFormat = activeFormats.bold || activeFormats.italic || activeFormats.underline || activeFormats.strike || activeFormats.size !== 'medium';
  const isVisitingInBook = !!visitingBookshelf;

  if (!currentBook) {
  // 当前显示的书架数据（自己的或访问的）
  const isVisiting = !!visitingBookshelf;
  const displayData = isVisiting ? visitingBookshelf : data;
  const displayBooks = displayData?.books || [];
  
  // 将书籍分页，每页4本
  const booksPerPage = 4;
  // 访问他人时不显示"新建世界"按钮
  const allBooks = isVisiting ? displayBooks : [...data.books, { id: 'add-new', isAddButton: true }];
  const totalPages = Math.ceil(allBooks.length / booksPerPage);
  const pages = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push(allBooks.slice(i * booksPerPage, (i + 1) * booksPerPage));
  }

  // 书籍移动处理
  const handleMoveBook = (bookId, targetIndex) => {
    setData(prev => {
      const books = [...prev.books];
      const fromIndex = books.findIndex(b => b.id === bookId);
      if (fromIndex === -1 || fromIndex === targetIndex) return prev;
      const [book] = books.splice(fromIndex, 1);
      books.splice(targetIndex, 0, book);
      return { ...prev, books };
    });
    setIsBookReorderMode(false);
    setDraggingBookId(null);
  };

  return (<div className={`app bookshelf-view ${returnAnimating ? 'return-animating' : ''}`}><div className={`shelf-globe-bg ${returnAnimating === 'up' ? 'globe-going-up' : ''} ${returnAnimating === 'down' ? 'globe-coming-down' : ''} ${launchAnimating === 'up' ? 'globe-going-up' : ''} ${launchAnimating === 'down' ? 'globe-coming-down' : ''}`} style={{ transform: `translateX(-50%) translateY(${-shelfOverscroll}px)`, transition: shelfOverscroll === 0 && !returnAnimating && !launchAnimating ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none' }} onClick={() => isVisiting ? setShowReturnConfirm(true) : setShowProfile(true)} />{isVisiting && <div className="visiting-indicator">🚀 {visitingProfile?.name || '神秘旅人'}的世界</div>}<header className="bookshelf-header">{isVisiting ? (<>{visitingProfile?.shelfTitle && <h1>{visitingProfile.shelfTitle}</h1>}{visitingProfile?.bio && <p className="subtitle">{visitingProfile.bio}</p>}</>) : (<>{user && showRocketBtn && <button className="rocket-entry-btn" onClick={() => setShowRocketModal(true)}>🚀</button>}<h1>一页穹顶</h1><p className="subtitle">拾起每一颗星星</p><p className="subtitle">便能拥有属于你的宇宙</p><button className="search-star" onClick={() => setShowSearch(true)}>⭐</button></>)}</header><div className="bookshelf-carousel" ref={shelfRef} onScroll={(e) => {
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
      if (isVisiting) {
        setShowReturnConfirm(true);
      } else {
        setShowProfile(true);
      }
    }
    setShelfOverscroll(0);
  }}>{pages.map((pageBooks, pageIndex) => (<div key={pageIndex} className="bookshelf-page"><div className="bookshelf-grid">{pageBooks.map((b, bookIndexInPage) => { const globalIndex = pageIndex * booksPerPage + bookIndexInPage; return b.isAddButton ? (<div key="add" className="book-card add-book" onClick={() => { setEditingBook(null); setShowBookModal(true); }}><div className="book-cover"><span className="add-icon">+</span></div><div className="book-meta"><h2>新建世界</h2></div></div>) : (<div key={b.id} className={`book-card ${isBookReorderMode && draggingBookId === b.id ? 'dragging' : ''} ${isBookReorderMode ? 'reorder-mode' : ''}`} style={{ '--book-color': b.color || '#8B7355' }} onClick={() => !isBookReorderMode && handleBookSelect(b)} onTouchStart={e => { e.stopPropagation(); if (!isVisiting && !isBookReorderMode) handleLongPressStart(e, 'book', b); }} onTouchEnd={!isVisiting ? handleLongPressEnd : undefined} onTouchMove={!isVisiting ? handleLongPressEnd : undefined}><div className="book-spine" /><div className="book-cover">{b.coverImage ? <img src={b.coverImage} alt="" className="cover-image" /> : <span className="book-emoji">{b.cover}</span>}</div><div className="book-shadow" /><div className="book-meta"><h2>{b.title}</h2>{b.author && <p>{b.author} 著</p>}</div>{isBookReorderMode && draggingBookId !== b.id && (<div className="book-drop-zone" onClick={(e) => { e.stopPropagation(); handleMoveBook(draggingBookId, globalIndex); }}>放这里</div>)}</div>); })}</div></div>))}</div>{isVisiting && <div className="return-hint">↓ 轻触星球返航 ↓</div>}{totalPages > 1 && (<div className="shelf-page-dots">{pages.map((_, i) => (<span key={i} className={`shelf-dot ${shelfPage === i ? 'active' : ''}`} onClick={() => { shelfRef.current?.scrollTo({ left: i * shelfRef.current.clientWidth, behavior: 'smooth' }); }} />))}</div>)}<BookModal isOpen={showBookModal} onClose={() => { setShowBookModal(false); setEditingBook(null); }} onSave={handleAddBook} editingBook={editingBook} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /><SearchModal isOpen={showSearch} onClose={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} query={searchQuery} setQuery={setSearchQuery} results={searchResults} onSearch={performSearch} onResultClick={handleSearchResultClick} />{showProfile && (<div className={`profile-page ${profileClosing ? 'closing' : ''}`} style={userBg ? { backgroundImage: `url(${userBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}><div className="profile-bg-overlay" /><div className="profile-header"><button className="profile-close" onClick={closeProfile}>×</button><div className="profile-avatar" onClick={() => avatarUploadRef.current?.click()}>{userAvatar ? <img src={userAvatar} alt="" /> : '✨'}</div><input ref={avatarUploadRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} /><input type="text" className="profile-name" value={userName} onChange={e => saveUserName(e.target.value)} placeholder="点击编辑名字" /><input type="text" className="profile-shelf-title" value={userShelfTitle} onChange={e => saveShelfTitle(e.target.value)} placeholder="自定义书架标题（访客可见）" /><textarea className="profile-bio" value={userBio} onChange={e => saveUserBio(e.target.value)} placeholder="写一句简介..." rows={2} /></div><div className="profile-stats"><div className="stat-item"><span className="stat-number">{totalStats.books}</span><span className="stat-label">作品</span></div><div className="stat-item"><span className="stat-number">{totalStats.entries}</span><span className="stat-label">词条</span></div><div className="stat-item"><span className="stat-number">{totalStats.words.toLocaleString()}</span><span className="stat-label">总字数</span></div></div><div className="profile-menu"><div className="profile-menu-item" onClick={closeProfile}><span>📚</span><span>我的书架</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => setShowLibrary(true)}><span>📖</span><span>图书馆 ({library.books.length})</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => setShowTotalGallery(true)}><span>🖼️</span><span>画廊 ({totalStats.images})</span><span className="menu-arrow">›</span></div><label className="profile-menu-item"><span>📥</span><span>导入书籍 (.yyd)</span><span className="menu-arrow">›</span><input ref={importBookRef} type="file" accept=".yyd,.json" onChange={handleImportYYD} style={{ display: 'none' }} /></label><div className="profile-menu-item" onClick={() => bgUploadRef.current?.click()}><span>🎨</span><span>更换背景</span><span className="menu-arrow">›</span></div><input ref={bgUploadRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} /><div className="profile-menu-item" onClick={() => setShowSettings(true)}><span>⚙️</span><span>设置</span><span className="menu-arrow">›</span></div><div className="profile-menu-item"><span>💡</span><span>关于一页穹顶</span><span className="menu-arrow">›</span></div></div><div className="profile-bottom-bar"><div className="profile-account-status">{user ? (<div className="logged-in"><span className="sync-indicator" data-status={syncStatus}></span><span>{user.email}</span></div>) : (<button className="login-btn" onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}>登录 / 注册</button>)}</div><div className="profile-version">一页穹顶 v1.0</div></div></div>)}{showTotalGallery && (<div className={`total-gallery-page ${galleryClosing ? "closing" : ""}`}><div className="gallery-header"><button className="gallery-back" onClick={closeGallery}>←</button><h2>画廊</h2><span></span></div><div className="total-gallery-list">{data.books.filter(b => b.gallery?.enabled).map(book => (<div key={book.id} className="total-gallery-book"><div className="total-gallery-book-header" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><span className="book-icon">{book.coverImage ? <img src={book.coverImage} alt="" /> : book.cover}</span><span className="book-title">{book.title}</span><span className="book-count">{book.gallery.images?.length || 0}张</span></div><div className="total-gallery-book-images">{book.gallery.images?.slice(0, 3).map(img => (<div key={img.id} className="total-gallery-thumb" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><img src={img.src} alt="" /></div>))}<label className="total-gallery-add-btn"><input type="file" accept="image/*" multiple onChange={(e) => { const files = e.target.files; if (!files?.length) return; Array.from(files).forEach(file => { const reader = new FileReader(); reader.onload = (ev) => { const newImg = { id: Date.now().toString() + Math.random(), src: ev.target.result, featured: false }; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === book.id ? { ...b, gallery: { ...b.gallery, images: [...(b.gallery.images || []), newImg] } } : b) })); }; reader.readAsDataURL(file); }); e.target.value = ''; }} style={{ display: 'none' }} /><span>+</span></label></div></div>))}{data.books.filter(b => b.gallery?.enabled).length === 0 && (<div className="gallery-empty"><span>🖼️</span><p>还没有任何画廊</p><p>在书籍中开启画廊功能</p></div>)}</div></div>)}{showLibrary && (<div className={`library-page ${libraryClosing ? "closing" : ""}`}><div className="library-header"><button className="library-back" onClick={closeLibrary}>←</button><h2>图书馆</h2><label className="library-import-btn">{importLoading ? '导入中...' : '📥 导入'}<input ref={libraryUploadRef} type="file" accept=".txt,.epub" onChange={handleImportBook} style={{ display: 'none' }} disabled={importLoading} /></label></div><div className="library-hint">支持导入 txt、epub 格式的电子书</div><div className="library-list">{library.books.map(book => (<div key={book.id} className="library-book-item"><div className="library-book-cover">{book.type === 'epub' ? '📕' : '📄'}{book.bookmark && <span className="library-bookmark-badge">🔖</span>}</div><div className="library-book-info" onClick={() => openLibraryBook(book)}><h3>{book.title}</h3><p>{book.author} · {book.chapters.length}章</p><p className="library-book-time">{new Date(book.importTime).toLocaleDateString()}{book.bookmark && ` · 已读至第${book.bookmark.chapterIndex + 1}章`}</p></div><button className="library-book-delete" onClick={(e) => { e.stopPropagation(); handleDeleteLibraryBook(book.id, book.title); }}>🗑️</button></div>))}{library.books.length === 0 && (<div className="library-empty"><span>📚</span><p>图书馆空空如也</p><p>点击右上角导入电子书</p></div>)}</div><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /></div>)}{showLibraryReader && libraryBook && (<StoryReader book={{ title: libraryBook.title }} chapter={libraryBook.chapters[libraryChapterIndex]} novelModeEntry={null} allChapters={libraryBook.chapters} currentChapterIndex={libraryChapterIndex} onClose={() => setShowLibraryReader(false)} onChangeChapter={(ch) => { const idx = libraryBook.chapters.findIndex(c => c.id === ch.id); if (idx >= 0) setLibraryChapterIndex(idx); }} onEdit={() => {}} settings={storySettings} onChangeSettings={setStorySettings} isLibraryMode={true} isBookmarked={libraryBook.bookmark !== null} onToggleBookmark={toggleLibraryBookmark} initialPage={libraryBook.bookmark?.page || 0} />)}<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} mode={authMode} setMode={setAuthMode} showToast={showToast} />{showRocketModal && (<RocketModal isOpen={showRocketModal} onClose={() => setShowRocketModal(false)} onFly={flyToCoordinate} showToast={showToast} onLaunchStart={() => setLaunchAnimating('up')} />)}<SettingsPage isOpen={showSettings} isClosing={settingsClosing} onClose={closeSettings} user={user} onLogout={async () => { await supabase.auth.signOut(); closeSettings(); }} myInviteCode={myInviteCode} onGenerateCode={generateInviteCode} onResetCode={resetInviteCode} formatCoordinate={formatCoordinate} syncStatus={syncStatus} lastSyncTime={lastSyncTime} onSyncNow={() => { saveToCloud(data); }} showRocketBtn={showRocketBtn} onToggleRocketBtn={toggleRocketBtn} showToast={showToast} characterCardStyle={characterCardStyle} onChangeCardStyle={changeCardStyle} />{showReturnConfirm && (<div className="return-confirm-overlay" onClick={() => setShowReturnConfirm(false)}><div className="return-confirm-modal" onClick={e => e.stopPropagation()}><div className="rocket-icon">🚀</div><h3>确认返航？</h3><p>即将返回你自己的书架</p><div className="return-confirm-actions"><button className="stay-btn" onClick={() => setShowReturnConfirm(false)}>再看看</button><button className="go-btn" onClick={confirmReturn}>返航</button></div></div></div>)}{toast.show && <div className="app-toast">{toast.message}</div>}<style>{styles}</style></div>);
}

  return (<div className="app main-view"><div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}><div className="sidebar-header"><h2>{currentBook.title}</h2><button className="close-sidebar" onClick={() => setIsSidebarOpen(false)}>×</button></div><div className="sidebar-content">{currentBook.entries.map(e => <SidebarItem key={e.id} entry={e} onSelect={handleSidebarSelect} currentId={currentEntry?.id} expandedIds={expandedIds} onToggle={id => setExpandedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} />)}</div></div>{isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}<div className="main-content" onTouchStart={e => { touchStartX.current = e.touches[0].clientX; touchStartY.current = e.touches[0].clientY; }} onTouchEnd={e => { const dx = e.changedTouches[0].clientX - touchStartX.current; const dy = e.changedTouches[0].clientY - touchStartY.current; if (dx > 120 && Math.abs(dx) > Math.abs(dy) * 2) { if (currentEntry || navigationStack.length > 0) { handleBack(); } else { handleBackToShelf(); } } }}><header className="top-bar"><div className="top-left"><button className="icon-btn" onClick={() => setIsSidebarOpen(true)}>☰</button>{(currentEntry || navigationStack.length > 0) && <button className="icon-btn" onClick={handleBack}>←</button>}<button className="icon-btn" onClick={handleBackToShelf}>🏠</button></div><div className="breadcrumb">{isVisitingInBook && <span className="friend-view-badge">👤 {visitingProfile?.name}</span>}<span className="book-name">{currentBook.title}</span>{currentEntry && <><span className="separator">/</span><span className="current-title">{currentEntry.title}</span></>}</div><div className="top-right">{isVisitingInBook ? (<span className="readonly-indicator">只读</span>) : ((viewMode === 'single' || viewMode === 'merged') && (<div className="read-mode-toggle" onClick={() => { if (!isReadOnly) { const ed = document.querySelector('.rich-editor'); if (ed) ed.forceSave?.(); } else if (viewMode === 'merged' && liveEntry) { initMerged(liveEntry); } setIsReadOnly(!isReadOnly); }}><span className={`toggle-label ${isReadOnly ? 'active' : ''}`}>阅读</span><div className={`toggle-switch ${!isReadOnly ? 'edit-mode' : ''}`}><div className="toggle-knob" /></div><span className={`toggle-label ${!isReadOnly ? 'active' : ''}`}>编辑</span></div>))}</div></header>{!currentEntry && currentBook.showStats && (<div className="book-info-card" onClick={() => { if (!isVisitingInBook) { setEditingBook(currentBook); setShowBookModal(true); } }}><div className="info-cover">{currentBook.coverImage ? <img src={currentBook.coverImage} alt="" /> : <span>{currentBook.cover}</span>}</div><div className="info-details">{currentBook.author && <p>作者：{currentBook.author}</p>}{currentBook.tags?.length > 0 && <p>标签：{currentBook.tags.join('、')}</p>}<p>词条：{countEntries(currentBook.entries)}条</p><p>字数：{countWords(currentBook.entries).toLocaleString()}字</p></div>{!isVisitingInBook && <span className="info-edit-hint">点击编辑 ›</span>}</div>)}{!currentEntry && currentBook.gallery?.enabled && (<div className="gallery-preview-strip"><div className="gallery-preview-scroll">{currentBook.gallery.images?.filter(img => img.featured).map(img => (<div key={img.id} className="gallery-strip-item" onClick={() => openGalleryPreview(img)}><img src={img.src} alt="" /></div>))}{(!currentBook.gallery.images?.filter(img => img.featured).length) && !isVisitingInBook && (<div className="gallery-strip-empty" onClick={() => setShowGallery(true)}><span>+</span><p>添加展示图片</p></div>)}</div><button className="gallery-enter-btn" onClick={() => setShowGallery(true)}>进入画廊 ›</button></div>)}<main className={`content-area ${slideAnim}`}>{viewMode === 'list' && !isReorderMode && (<>{currentEntry && <div className="list-header"><h1>{currentEntry.title}</h1>{currentEntry.summary && <p className="summary">{currentEntry.summary}</p>}</div>}<p className="swipe-hint">{isVisitingInBook ? '💡 左滑合并视图 · 右滑返回' : '💡 左滑合并视图 · 右滑返回 · 长按编辑'}</p><div className="entry-list">{currentEntries.map(e => { let tx = 0; return (<div key={e.id} className="entry-card" onClick={() => handleEntryClick(e)} onTouchStart={ev => { tx = ev.touches[0].clientX; if (!isVisitingInBook) handleLongPressStart(ev, 'entry', e); }} onTouchMove={!isVisitingInBook ? handleLongPressEnd : undefined} onTouchEnd={ev => { if (!isVisitingInBook) handleLongPressEnd(); handleEntrySwipe(e, ev.changedTouches[0].clientX - tx); }}><div className="entry-icon">{e.characterMode ? '👤' : e.novelMode ? '📖' : e.timelineMode ? '📅' : e.isFolder ? '📁' : '📄'}</div><div className="entry-info"><h3>{e.title}{e.linkable && <span className="star-badge">⭐</span>}{e.novelMode && <span className="novel-badge">正文</span>}{e.characterMode && <span className="character-badge">人设</span>}{e.timelineMode && <span className="timeline-badge">时间轴</span>}</h3><p>{e.summary}</p></div><span className="entry-arrow">›</span></div>); })}</div>{currentEntries.length === 0 && <div className="empty-state"><span>✨</span><p>{isVisitingInBook ? '这里还没有内容' : '点击右下角添加'}</p></div>}</>)}{(viewMode === 'list' || viewMode === 'character') && isReorderMode && <ReorderList entries={currentEntries} onReorder={handleReorder} onExit={() => setIsReorderMode(false)} />}{viewMode === 'single' && liveEntry && (<div className="single-view"><div className="export-content" ref={exportRef}><div className="content-header">{effectiveReadOnly ? <h1>{liveEntry.title}</h1> : <input type="text" className="editable-title" defaultValue={liveEntry.title} onBlur={ev => handleTitleChange(liveEntry.id, liveEntry.title, ev.target.value)} key={currentEntry.id + '-title'} />}{effectiveReadOnly ? (liveEntry.summary && <p className="entry-summary">{liveEntry.summary}</p>) : <input type="text" className="editable-summary" defaultValue={liveEntry.summary || ''} placeholder="添加简介..." onBlur={ev => handleSummaryChange(liveEntry.id, ev.target.value)} key={currentEntry.id + '-summary'} />}</div><div onTouchStart={effectiveReadOnly ? handleContentLongPressStart : undefined} onTouchEnd={effectiveReadOnly ? handleContentLongPressEnd : undefined} onTouchMove={effectiveReadOnly ? handleContentLongPressEnd : undefined}>{effectiveReadOnly ? <ContentRenderer content={liveEntry.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} /> : <RichEditor key={currentEntry.id} content={liveEntry.content} onSave={html => saveContent(html)} fontFamily={currentFont} onImageClick={handleImageClick} onResetFormats={() => setActiveFormats({ bold: false, italic: false, underline: false, strike: false, size: 'medium' })} />}</div></div><div className="word-count">{countSingleEntryWords(liveEntry.content).toLocaleString()} 字</div></div>)}{viewMode === 'merged' && currentEntry && (<div className="merged-view">{effectiveReadOnly ? (<div ref={exportRef}><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-read" onTouchStart={handleContentLongPressStart} onTouchEnd={handleContentLongPressEnd} onTouchMove={handleContentLongPressEnd}>{liveChildContent.map((it, i, arr) => (<div key={it.id} className="merged-section"><div className="section-title">• {it.title}</div><ContentRenderer content={it.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} />{i < arr.length - 1 && <div className="section-divider" />}</div>))}</div></div>) : (<><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-edit">{mergedContents.map((it, i) => (<div key={it.id} className="merged-edit-section"><div className="merged-edit-header">• <input type="text" className="merged-title-input" defaultValue={it.title} onBlur={ev => handleMergedChange(i, 'title', ev.target.value)} key={it.id + '-title'} /></div><div className="merged-editor-wrap" contentEditable dangerouslySetInnerHTML={{ __html: it.content }} onBlur={ev => handleMergedChange(i, 'content', ev.target.innerHTML)} onPaste={ev => { ev.preventDefault(); const text = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }} style={{ fontFamily: currentFont }} /></div>))}<button className="add-merged-entry-btn" onClick={handleAddMerged}>+ 添加词条</button></div></>)}<div className="word-count">{liveChildContent.reduce((sum, it) => sum + countSingleEntryWords(it.content), 0).toLocaleString()} 字</div></div>)}{viewMode === 'character' && currentEntry && !isReorderMode && (<div className="character-view"><div className="character-header"><h1>{currentEntry.title}</h1><p className="character-hint">👤 人设模式 · {currentEntry.children?.length || 0} 位角色</p></div><div className="character-grid">{(currentEntry.children || []).map((char, idx) => (<CharacterCard key={char.id} entry={char} style={characterCardStyle} onClick={handleCharacterClick} onLongPress={!isVisitingInBook ? handleCharacterLongPress : undefined} index={idx} />))}{!isVisitingInBook && <AddCharacterCard style={characterCardStyle} onClick={() => { setEditingCharacter(null); setShowCharacterModal(true); }} />}</div>{currentEntry.children?.length === 0 && <div className="empty-state"><span>👤</span><p>还没有人设</p><p>点击「+」添加角色</p></div>}</div>)}{viewMode === 'timeline' && liveEntry && (<div className="timeline-mode-view"><div className="timeline-header"><h1>{liveEntry.title}</h1><p className="timeline-hint">📅 时间轴模式</p></div><TimelineView entry={liveEntry} onAddEvent={(yearId) => { setEditingEvent(null); setShowAddEventModal(true); }} onEditEvent={(event) => { setEditingEvent(event); setShowAddEventModal(true); }} onDeleteEvent={handleDeleteTimelineEvent} onAddYear={(eraId) => { setEditingYear(null); setShowAddYearModal(true); }} onEditYear={(year) => { setEditingYear(year); setShowAddYearModal(true); }} onDeleteYear={handleDeleteYear} onAddEra={() => { setEditingEra(null); setShowAddEraModal(true); }} onEditEra={(era) => { setEditingEra(era); setShowAddEraModal(true); }} onDeleteEra={handleDeleteEra} expandedYears={expandedYears} onToggleYear={handleToggleYear} allTitlesMap={allTitlesMap} onLinkClick={handleLinkClick} currentSubTimeline={currentSubTimeline} onExitSubTimeline={() => setCurrentSubTimeline(null)} isReordering={isTimelineReordering} onReorderEvent={handleReorderEvent} /></div>)}{viewMode === 'novel' && liveEntry && (
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
)}</main>{viewMode === 'list' && !isReorderMode && !isVisitingInBook && (<><button className={`fab ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}><span style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><AddMenu isOpen={showAddMenu} onClose={() => setShowAddMenu(false)} onAddEntry={() => { setEditingEntry(null); setIsCreatingFolder(false); setShowEntryModal(true); }} onAddFolder={() => { setEditingEntry(null); setIsCreatingFolder(true); setShowEntryModal(true); }} onReorder={() => setIsReorderMode(true)} onToggleGallery={toggleGallery} galleryEnabled={currentBook?.gallery?.enabled} /></>)}{viewMode === 'character' && !isVisitingInBook && (<><button className={`fab ${showCharacterAddMenu ? 'active' : ''}`} onClick={() => setShowCharacterAddMenu(!showCharacterAddMenu)}><span style={{ transform: showCharacterAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><CharacterAddMenu isOpen={showCharacterAddMenu} onClose={() => setShowCharacterAddMenu(false)} onAddCharacter={() => { setEditingCharacter(null); setShowCharacterModal(true); }} onOpenRelationNetwork={() => setShowRelationNetwork(true)} onReorder={() => setIsReorderMode(true)} /></>)}{viewMode === 'timeline' && !isVisitingInBook && (<><button className={`fab ${showTimelineAddMenu ? 'active' : ''}`} onClick={() => setShowTimelineAddMenu(!showTimelineAddMenu)}><span style={{ transform: showTimelineAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><TimelineAddMenu isOpen={showTimelineAddMenu} onClose={() => setShowTimelineAddMenu(false)} onAddEvent={() => { setEditingEvent(null); setShowAddEventModal(true); }} onAddYear={() => { setEditingYear(null); setShowAddYearModal(true); }} onAddEra={() => { setEditingEra(null); setShowAddEraModal(true); }} onManageSubTimelines={() => setShowSubTimelines(true)} onReorder={() => setIsTimelineReordering(!isTimelineReordering)} isReordering={isTimelineReordering} /></>)}{isEditing && <EditorToolbar onIndent={handleIndent} onFormat={() => { saveSelection(); setShowFormatMenu(true); }} onAlign={() => { saveSelection(); setShowAlignMenu(true); }} onFont={() => { saveSelection(); setShowFontMenu(true); }} onImage={handleImageUpload} hasActive={hasActiveFormat} />}<TextFormatMenu isOpen={showFormatMenu} onClose={() => { setShowFormatMenu(false); }} activeFormats={activeFormats} onToggleFormat={handleToggleFormat} /><AlignMenu isOpen={showAlignMenu} onClose={() => { setShowAlignMenu(false); restoreSelection(); }} onAlign={handleAlign} /><FontMenu isOpen={showFontMenu} onClose={() => { setShowFontMenu(false); restoreSelection(); }} onSelectFont={setCurrentFont} currentFont={currentFont} /></div><EntryModal isOpen={showEntryModal} onClose={() => { setShowEntryModal(false); setEditingEntry(null); }} onSave={editingEntry ? handleUpdateEntry : handleAddEntry} editingEntry={editingEntry} parentTitle={currentEntry?.title} isFolder={isCreatingFolder} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><MoveModal isOpen={showMoveModal} onClose={() => { setShowMoveModal(false); setMoveTarget(null); }} entry={moveTarget} entries={currentBook?.entries || []} currentParentId={currentEntry?.id || null} onMove={handleMoveEntry} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} />{showGallery && (<div className="gallery-page" onClick={e => e.stopPropagation()}><div className="gallery-header"><button className="gallery-back" onClick={() => { setShowGallery(false); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }}>←</button><h2>{currentBook?.title}</h2><button className="gallery-upload" onClick={() => galleryUploadRef.current?.click()}>+ 添加</button><input ref={galleryUploadRef} type="file" accept="image/*" multiple onChange={uploadGalleryImage} style={{ display: 'none' }} /></div><div className="gallery-grid">{currentBook?.gallery?.images?.map(img => (<div key={img.id} className="gallery-item" onTouchStart={(e) => { e.stopPropagation(); const touch = e.touches[0]; galleryLongPressTimer.current = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); setGalleryContextMenu({ isOpen: true, image: img, position: { x: touch.clientX, y: touch.clientY } }); }, 500); }} onTouchEnd={(e) => { e.stopPropagation(); if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onTouchMove={(e) => { if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onClick={(e) => { e.stopPropagation(); if (!galleryContextMenu.isOpen) openGalleryPreview(img); }}><img src={img.src} alt="" draggable={false} />{img.featured && <span className="featured-star">★</span>}</div>))}{(!currentBook?.gallery?.images || currentBook.gallery.images.length === 0) && (<div className="gallery-empty"><span>🖼️</span><p>还没有图片</p><p>点击右上角添加</p></div>)}</div>{galleryContextMenu.isOpen && (<><div className="gallery-context-overlay" onClick={(e) => { e.stopPropagation(); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }} /><div className="context-menu" style={{ top: galleryContextMenu.position.y, left: Math.min(galleryContextMenu.position.x, window.innerWidth - 180) }}><div className="context-item" onClick={(e) => { e.stopPropagation(); toggleFeatured(galleryContextMenu.image.id); }}><span className="context-icon">{galleryContextMenu.image.featured ? '☆' : '★'}</span>{galleryContextMenu.image.featured ? '取消展示' : '展示'}</div><div className="context-item danger" onClick={(e) => { e.stopPropagation(); deleteGalleryImage(galleryContextMenu.image.id); }}><span className="context-icon">🗑️</span>删除图片</div></div></>)}{galleryConfirmModal.isOpen && (<div className="gallery-confirm-overlay" onClick={(e) => { e.stopPropagation(); setGalleryConfirmModal({ isOpen: false }); }}><div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}><h3>{galleryConfirmModal.title}</h3><p>{galleryConfirmModal.message}</p><div className="modal-actions"><button className="btn-cancel" onClick={() => setGalleryConfirmModal({ isOpen: false })}>取消</button><button className="btn-save" onClick={galleryConfirmModal.onConfirm}>确定</button></div></div></div>)}</div>)}{galleryPreviewImage && (<div className="gallery-viewer" onTouchStart={(e) => {
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
}} onClick={(e) => { e.stopPropagation(); if (Math.abs(galleryDragX) < 10 && galleryViewScale === 1) closeGalleryPreview(); }}><div className="gallery-viewer-counter">{galleryViewIndex + 1} / {currentBook?.gallery?.images?.length || 0}</div>{galleryViewerMenu && (<><div className="gallery-viewer-menu-overlay" onClick={(e) => { e.stopPropagation(); setGalleryViewerMenu(false); }} /><div className="gallery-viewer-menu"><div className="gallery-viewer-menu-item" onClick={(e) => { e.stopPropagation(); const img = currentBook?.gallery?.images?.[galleryViewIndex]; if (img) { saveGalleryImage(img.src); } setGalleryViewerMenu(false); }}>💾 保存到手机</div><div className="gallery-viewer-menu-item" onClick={(e) => { e.stopPropagation(); setGalleryViewerMenu(false); }}>取消</div></div></>)}<div className="gallery-viewer-track" style={{ transform: `translateX(calc(-${galleryViewIndex * 100}% + ${galleryDragX}px))`, transition: galleryIsDragging ? 'none' : 'transform 0.3s ease-out' }}>{currentBook?.gallery?.images?.map((img, idx) => (<div key={img.id} className="gallery-viewer-slide" onTouchStart={(e) => { if (idx === galleryViewIndex && galleryViewScale === 1) { galleryViewerLongPress.current = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); setGalleryViewerMenu(true); }, 500); } }} onTouchEnd={() => { if (galleryViewerLongPress.current) { clearTimeout(galleryViewerLongPress.current); galleryViewerLongPress.current = null; } }} onTouchMove={() => { if (galleryViewerLongPress.current) { clearTimeout(galleryViewerLongPress.current); galleryViewerLongPress.current = null; } }}><img src={img.src} alt="" style={{ transform: `scale(${idx === galleryViewIndex ? galleryViewScale : 1})` }} draggable={false} /></div>))}</div></div>)}{showExportMenu && (<><div className="export-menu-overlay" onClick={() => setShowExportMenu(false)} /><div className="export-menu" style={{ top: exportMenuPos.y - 60, left: Math.min(exportMenuPos.x - 60, window.innerWidth - 140) }}><div className="export-menu-item" onClick={handleExportImage}><span>📷</span><span>导出长图</span></div></div></>)}<BookModal isOpen={showBookModal} onClose={() => { setShowBookModal(false); setEditingBook(null); }} onSave={handleAddBook} editingBook={editingBook} />{showStoryBookPage && currentBook && (
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
/><CharacterEditModal isOpen={showCharacterModal} onClose={() => { setShowCharacterModal(false); setEditingCharacter(null); }} onSave={editingCharacter ? handleUpdateCharacter : handleAddCharacter} editingEntry={editingCharacter} /><RelationNetworkPage isOpen={showRelationNetwork} onClose={() => setShowRelationNetwork(false)} entries={currentEntry?.children || []} relations={currentEntry?.characterRelations || []} onAddRelation={handleAddRelation} onDeleteRelation={handleDeleteRelation} onUpdateRelation={handleUpdateRelation} bookTitle={currentEntry?.title || ''} cardStyle={characterCardStyle} allTitlesMap={allTitlesMap} onLinkClick={handleLinkClick} /><AddEraModal isOpen={showAddEraModal} onClose={() => { setShowAddEraModal(false); setEditingEra(null); }} onSave={editingEra ? handleUpdateEra : handleAddEra} editingEra={editingEra} /><AddYearModal isOpen={showAddYearModal} onClose={() => { setShowAddYearModal(false); setEditingYear(null); }} onSave={editingYear ? handleUpdateYear : handleAddYear} editingYear={editingYear} eras={currentEntry?.timelineConfig?.eras || []} /><AddEventModal isOpen={showAddEventModal} onClose={() => { setShowAddEventModal(false); setEditingEvent(null); }} onSave={editingEvent ? handleUpdateTimelineEvent : handleAddTimelineEvent} editingEvent={editingEvent} eras={currentEntry?.timelineConfig?.eras || []} years={currentEntry?.timelineConfig?.years || []} allTitlesMap={allTitlesMap} /><AddSubTimelineModal isOpen={showAddSubTimelineModal} onClose={() => setShowAddSubTimelineModal(false)} onSave={handleAddSubTimeline} eras={currentEntry?.timelineConfig?.eras || []} characters={[]} /><SubTimelineListPage isOpen={showSubTimelines} onClose={() => setShowSubTimelines(false)} subTimelines={currentEntry?.timelineConfig?.subTimelines || []} eras={currentEntry?.timelineConfig?.eras || []} onSelect={(st) => { setCurrentSubTimeline(st); setShowSubTimelines(false); }} onAdd={() => { setShowSubTimelines(false); setShowAddSubTimelineModal(true); }} onDelete={handleDeleteSubTimeline} />{showCharacterDetail && (<CharacterDetailPage entry={showCharacterDetail} onClose={() => setShowCharacterDetail(null)} onSave={(updatedEntry) => { setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: updateEntryInTree(b.entries, updatedEntry.id, { content: updatedEntry.content }) } : b) })); setShowCharacterDetail({ ...showCharacterDetail, content: updatedEntry.content }); }} isReadOnly={!!visitingBookshelf} cardStyle={characterCardStyle} allTitlesMap={allTitlesMap} onLinkClick={(kw, bookId, entryId) => { setShowCharacterDetail(null); handleLinkClick(kw, bookId, entryId); }} bookName={currentBook?.title} />)}{toast.show && <div className="app-toast">{toast.message}</div>}<style>{styles}</style></div>);
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
/* 书籍移动模式 */
.book-card.reorder-mode{animation:bookShake .3s ease-in-out}
.book-card.dragging{opacity:.5;transform:scale(.9)}
.book-drop-zone{position:absolute;inset:0;background:rgba(244,228,193,.2);border:2px dashed #f4e4c1;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#f4e4c1;font-size:.85rem;z-index:5;backdrop-filter:blur(4px)}
@keyframes bookShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-2deg)}75%{transform:rotate(2deg)}}
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
.top-bar{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;padding-top:calc(12px + env(safe-area-inset-top));background:rgba(250,248,243,.95);backdrop-filter:blur(10px);border-bottom:1px solid rgba(45,48,71,.1)}
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
.fab{position:fixed;right:24px;bottom:calc(24px + env(safe-area-inset-bottom));width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#2D3047,#1a1a2e);border:none;color:#f4e4c1;font-size:1.8rem;cursor:pointer;box-shadow:0 4px 20px rgba(45,48,71,.4);display:flex;align-items:center;justify-content:center;z-index:50}
.fab:active,.fab.active{transform:scale(.9)}
.add-menu-overlay{position:fixed;inset:0;z-index:48}
.add-menu{position:fixed;right:24px;bottom:calc(90px + env(safe-area-inset-bottom));background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15);overflow:hidden;z-index:49}
.add-menu-item{display:flex;align-items:center;gap:12px;padding:16px 20px;cursor:pointer}
.add-menu-item:active{background:#f5f5f5}
.add-menu-item:not(:last-child){border-bottom:1px solid #eee}
.editor-toolbar-bottom{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-around;padding:8px 16px;padding-bottom:calc(8px + env(safe-area-inset-bottom));background:rgba(250,248,243,.98);border-top:1px solid rgba(45,48,71,.08);z-index:50}
.editor-toolbar-bottom button{background:none;border:none;font-size:1rem;padding:8px 14px;cursor:pointer;color:#2D3047;border-radius:6px;display:flex;align-items:center;justify-content:center}
.editor-toolbar-bottom button:active{background:rgba(45,48,71,.08)}
.editor-toolbar-bottom button.has-active{color:#8B7355;background:rgba(139,115,85,.1)}
.format-menu-overlay{position:fixed;inset:0;z-index:58}
.format-menu{position:fixed;left:16px;right:16px;bottom:calc(60px + env(safe-area-inset-bottom));background:#fff;border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,.1);z-index:59;padding:12px}
.format-hint{font-size:.75rem;color:#999;text-align:center;margin-bottom:10px}
.format-row{display:flex;justify-content:space-around;margin-bottom:8px}
.format-row:last-child{margin-bottom:0}
.format-row button{width:44px;height:44px;border-radius:10px;border:1px solid #eee;background:#fff;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.format-row button:active{background:rgba(139,115,85,.15)}
.format-row button.active{background:#8B7355;color:#fff;border-color:#8B7355}
.size-row button{width:auto;padding:0 14px}
.align-menu .format-row{justify-content:center;gap:16px}
.font-menu{position:fixed;left:16px;right:16px;bottom:calc(60px + env(safe-area-inset-bottom));background:#fff;border-radius:12px;box-shadow:0 -4px 20px rgba(0,0,0,.1);z-index:59;padding:16px;display:flex;flex-wrap:wrap;gap:8px}
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
/* 移动弹窗 */
.move-modal{max-width:340px;padding:20px}
.move-modal h3{margin-bottom:6px;color:#2D3047}
.move-entry-name{color:#8B7355;font-size:.9rem;margin-bottom:16px}
.move-target-list{max-height:320px;overflow-y:auto;margin:-4px -8px;padding:4px 8px}
.move-target-item{display:flex;align-items:center;gap:8px;padding:12px 12px;border-radius:10px;cursor:pointer;transition:background .15s}
.move-target-item:hover{background:rgba(139,115,85,.06)}
.move-target-item:active{background:rgba(139,115,85,.12)}
.move-target-item.current{background:rgba(139,115,85,.08);cursor:default}
.move-target-item.current:hover{background:rgba(139,115,85,.08)}
.move-target-item.root-item{border-bottom:1px solid rgba(139,115,85,.1);margin-bottom:8px;padding-bottom:14px;border-radius:10px 10px 0 0}
.expand-toggle{width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:.65rem;color:#8B7355;transition:transform .2s;cursor:pointer;flex-shrink:0}
.expand-toggle:hover{color:#2D3047}
.expand-toggle.expanded{transform:rotate(90deg)}
.expand-placeholder{width:18px;flex-shrink:0}
.move-target-icon{font-size:1rem;flex-shrink:0}
.move-target-name{color:#2D3047;font-size:.92rem;flex:1}
.current-badge{font-size:.7rem;color:#999;background:rgba(0,0,0,.05);padding:2px 8px;border-radius:8px}
.move-empty{text-align:center;color:#999;padding:20px;font-size:.9rem}
.move-empty{text-align:center;color:#888;padding:30px 0}
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
.color-picker{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.color-option{width:32px;height:32px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .2s}
.color-option.selected{border-color:#f4e4c1;transform:scale(1.1)}
.color-custom{position:relative;width:32px;height:32px}
.color-custom input[type="color"]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
.color-custom span{display:block;width:32px;height:32px;border-radius:50%;border:2px dashed rgba(244,228,193,.4);display:flex;align-items:center;justify-content:center;color:#f4e4c1;font-size:.8rem}
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
.shelf-globe-bg{position:fixed;bottom:-550px;left:50%;width:300vw;height:600px;border-radius:50%;background:linear-gradient(180deg,#D4A84B 0%,#C9A227 40%,#B8960B 100%);box-shadow:0 -40px 100px 50px rgba(212,168,75,.3);z-index:1;cursor:pointer;pointer-events:auto;transition:transform .5s cubic-bezier(0.34, 1.56, 0.64, 1)}
.shelf-globe-bg.globe-going-up,.shelf-globe-bg.globe-coming-down{z-index:100}
.shelf-globe-bg.globe-going-up{animation:globeExpand 1.2s ease-in-out forwards}
.shelf-globe-bg.globe-coming-down{animation:globeShrink 1.2s ease-out forwards}
@keyframes globeExpand{0%{transform:translateX(-50%) translateY(0) scale(1)}100%{transform:translateX(-50%) translateY(-200px) scale(5)}}
@keyframes globeShrink{0%{transform:translateX(-50%) translateY(-200px) scale(5)}100%{transform:translateX(-50%) translateY(0) scale(1)}}
.return-hint{position:fixed;bottom:70px;left:0;right:0;text-align:center;color:rgba(244,228,193,.6);font-size:.8rem;animation:pulse 2s ease-in-out infinite;z-index:10}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:.8}}
.featured-star{position:absolute;top:6px;right:6px;color:#FFD700;font-size:1.2rem;text-shadow:0 0 8px rgba(255,215,0,.8),0 2px 4px rgba(0,0,0,.3)}
.profile-page{position:fixed;inset:0;background:#1a1d2e;z-index:3000;display:flex;flex-direction:column;overflow:hidden;animation:slideUpProfile .3s ease-out}
.profile-page.closing{animation:slideDownProfile .28s ease-in forwards}
.library-page.closing,.total-gallery-page.closing,.settings-page.closing{animation:slideDownProfile .28s ease-in forwards}
@keyframes slideUpProfile{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes slideDownProfile{from{transform:translateY(0)}to{transform:translateY(100%)}}
.profile-bg-overlay{position:fixed;inset:0;background:linear-gradient(180deg,rgba(45,48,71,.85) 0%,rgba(26,29,46,.95) 100%);pointer-events:none}
.profile-header{position:relative;z-index:1;text-align:center;padding:60px 20px 20px;flex-shrink:0}
.profile-avatar{width:80px;height:80px;border-radius:50%;background:rgba(244,228,193,.1);display:flex;align-items:center;justify-content:center;font-size:2.5rem;margin:0 auto 15px;overflow:hidden;cursor:pointer;border:2px solid rgba(244,228,193,.3)}
.profile-avatar img{width:100%;height:100%;object-fit:cover}
.profile-bio{width:80%;max-width:280px;margin:10px auto 0;background:rgba(255,255,255,.08);border:none;border-radius:8px;padding:10px;color:#f4e4c1;font-size:.9rem;text-align:center;resize:none;outline:none}
.profile-bio::placeholder{color:rgba(244,228,193,.4)}
.profile-shelf-title{width:80%;max-width:280px;margin:10px auto 0;background:rgba(255,255,255,.08);border:none;border-radius:8px;padding:10px;color:#f4e4c1;font-size:.85rem;text-align:center;outline:none}
.profile-shelf-title::placeholder{color:rgba(244,228,193,.4)}
.profile-stats{position:relative;z-index:1;display:flex;justify-content:center;gap:40px;padding:20px;border-bottom:1px solid rgba(244,228,193,.1);flex-shrink:0}
.profile-menu{position:relative;z-index:1;flex:1;overflow-y:auto;padding:20px;padding-bottom:60px}
.total-gallery-page{position:fixed;inset:0;background:linear-gradient(180deg,#2D3047 0%,#1a1d2e 100%);z-index:3100;display:flex;flex-direction:column;overflow-y:auto;animation:slideUpProfile .3s ease-out}
.total-gallery-page .gallery-header{background:rgba(0,0,0,.2);border-bottom:1px solid rgba(244,228,193,.1)}
.total-gallery-page .gallery-header h2{color:#f4e4c1}
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
.profile-close{position:absolute;top:20px;right:20px;background:none;border:none;color:#f4e4c1;font-size:1.8rem;cursor:pointer;opacity:.7}

.profile-name{background:none;border:none;color:#f4e4c1;font-size:1.3rem;text-align:center;width:100%;font-family:'ZCOOL XiaoWei',serif;padding:8px}
.profile-name:focus{outline:none;border-bottom:1px solid rgba(244,228,193,.3)}
.profile-name::placeholder{color:rgba(244,228,193,.5)}
.stat-item{text-align:center}
.stat-number{display:block;font-size:1.5rem;color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif}
.stat-label{font-size:.8rem;color:rgba(244,228,193,.6)}
.profile-menu-item{display:flex;align-items:center;gap:14px;padding:16px;background:rgba(255,255,255,.05);border-radius:12px;margin-bottom:10px;color:#f4e4c1;cursor:pointer}
.profile-menu-item:active{background:rgba(255,255,255,.1)}
.profile-menu-item span:first-child{font-size:1.3rem}
.profile-menu-item span:nth-child(2){flex:1}
.menu-arrow{color:rgba(244,228,193,.4);font-size:1.2rem}


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
.library-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#2D3047 100%);z-index:3100;display:flex;flex-direction:column;overflow:hidden;animation:slideUpProfile .3s ease-out}
.library-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(244,228,193,.1)}
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
.profile-account-status{display:flex;align-items:center}
.profile-account-status .logged-in{display:flex;align-items:center;gap:8px;color:rgba(244,228,193,.6);font-size:.85rem}
.profile-account-status .sync-indicator{width:6px;height:6px;border-radius:50%;background:#27ae60}
.profile-account-status .sync-indicator[data-status="syncing"]{background:#f39c12;animation:pulse 1s infinite}
.profile-account-status .sync-indicator[data-status="error"]{background:#e74c3c}
.profile-account-status .login-btn{padding:10px 20px;background:linear-gradient(135deg,#8B7355,#6B5335);color:#f4e4c1;border:none;border-radius:10px;font-size:.9rem;cursor:pointer}
.profile-account-status .login-btn:active{opacity:.8}
.profile-bottom-bar{position:absolute;bottom:16px;left:16px;right:16px;display:flex;justify-content:space-between;align-items:center;z-index:1}
.profile-version{color:rgba(244,228,193,.5);font-size:.8rem}

/* 火箭入口按钮 */
.rocket-entry-btn{position:absolute;left:50px;top:110px;background:none;border:none;font-size:1.5rem;cursor:pointer;filter:drop-shadow(0 0 10px rgba(255,200,100,.5));animation:rocketFloat 3s ease-in-out infinite;z-index:10}
@keyframes rocketFloat{0%,100%{transform:translateY(0) rotate(-15deg)}50%{transform:translateY(-8px) rotate(-15deg)}}

/* 返航确认弹窗 */
.return-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:5000;animation:fadeIn .2s ease-out}
.return-confirm-modal{background:linear-gradient(135deg,#2D3047 0%,#1a1d2e 100%);border-radius:20px;padding:28px 24px;text-align:center;max-width:280px;width:85%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.return-confirm-modal .rocket-icon{font-size:2.5rem;margin-bottom:12px;animation:rocketFloat 2s ease-in-out infinite}
.return-confirm-modal h3{color:#f4e4c1;font-size:1.1rem;margin-bottom:8px;font-family:'ZCOOL XiaoWei',serif}
.return-confirm-modal p{color:rgba(244,228,193,.6);font-size:.85rem;margin-bottom:20px}
.return-confirm-actions{display:flex;gap:12px}
.return-confirm-actions button{flex:1;padding:12px;border-radius:12px;border:none;font-size:.95rem;cursor:pointer}
.return-confirm-actions .stay-btn{background:rgba(255,255,255,.1);color:#f4e4c1}
.return-confirm-actions .go-btn{background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%);color:#f4e4c1}
/* 访问者标识 */
.visiting-indicator{position:absolute;top:16px;left:50%;transform:translateX(-50%);background:rgba(139,115,85,.3);color:#f4e4c1;font-size:.75rem;padding:6px 16px;border-radius:20px;backdrop-filter:blur(10px);z-index:10}
.visiting-badge{display:none}

/* 火箭坐标输入弹窗 */
.rocket-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:6000;transition:background .5s}
.rocket-modal-overlay.flying{background:transparent;pointer-events:none}
.rocket-modal.flying{background:transparent;box-shadow:none}
.rocket-modal-icon.flying{font-size:3rem;animation:rocketFly 1.2s ease-in-out infinite}
.flying-dots{display:flex;gap:8px;justify-content:center;margin-top:20px}
.flying-dots span{width:8px;height:8px;background:rgba(244,228,193,.6);border-radius:50%;animation:dotPulse 1.4s ease-in-out infinite}
.flying-dots span:nth-child(2){animation-delay:.2s}
.flying-dots span:nth-child(3){animation-delay:.4s}
@keyframes rocketFly{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes dotPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
.rocket-modal{background:linear-gradient(135deg,#1a1d2e 0%,#0d1117 100%);border-radius:20px;padding:32px 28px;text-align:center;max-width:320px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1)}
.rocket-modal-icon{font-size:3rem;margin-bottom:16px;animation:rocketFloat 2s ease-in-out infinite}
.rocket-modal-title{color:#f4e4c1;font-size:1rem;margin-bottom:24px;opacity:.9}
.rocket-coord-input{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:24px}
.coord-prefix{color:#8b9dc3;font-size:1.1rem;font-family:'Georgia',serif;font-style:italic}
.coord-input{width:60px;height:44px;background:rgba(255,255,255,.08);border:2px solid rgba(244,228,193,.2);border-radius:10px;color:#f4e4c1;font-size:1.2rem;text-align:center;font-family:monospace;letter-spacing:2px;text-transform:uppercase}
.coord-input:focus{outline:none;border-color:rgba(244,228,193,.5);background:rgba(255,255,255,.12)}
.coord-input::placeholder{color:rgba(244,228,193,.3)}
.coord-dot{color:#8b9dc3;font-size:1.2rem;margin:0 4px}
.rocket-fly-btn{width:100%;padding:14px;background:linear-gradient(135deg,#4a5568 0%,#2d3748 100%);border:none;border-radius:12px;color:#f4e4c1;font-size:1rem;cursor:pointer;transition:all .2s}
.rocket-fly-btn:disabled{opacity:.4;cursor:not-allowed}
.rocket-fly-btn:not(:disabled):active{transform:scale(.98);background:linear-gradient(135deg,#5a6578 0%,#3d4758 100%)}
.rocket-cancel-btn{background:none;border:none;color:rgba(244,228,193,.5);font-size:.9rem;margin-top:16px;cursor:pointer}

/* 设置页面坐标显示 */
.coordinate-display{background:rgba(244,228,193,.08);border-radius:12px;padding:16px;margin-top:12px}
.coordinate-text{display:block;color:#f4e4c1;font-size:1.3rem;font-family:'Georgia',serif;letter-spacing:1px;margin-bottom:12px;text-align:center}
.coordinate-actions{display:flex;gap:8px}
.coordinate-actions button{flex:1;padding:10px;border-radius:8px;border:none;cursor:pointer;font-size:.85rem}
.coordinate-actions button:first-child{background:rgba(244,228,193,.15);color:#f4e4c1}
.coordinate-actions .reset-btn{background:rgba(255,100,100,.15);color:#ff8888}
.generate-coord-btn{background:linear-gradient(135deg,#4a5568 0%,#2d3748 100%)!important;color:#f4e4c1!important}
.settings-toggle-row{display:flex;justify-content:space-between;align-items:center;padding:12px 0}
.settings-toggle-row input[type="checkbox"]{width:20px;height:20px}

/* 书籍内部的好友视图标识 */
.friend-view-badge{background:rgba(139,115,85,.3);color:#f4e4c1;font-size:.75rem;padding:2px 8px;border-radius:10px;margin-right:8px}
.readonly-indicator{background:rgba(244,228,193,.15);color:#f4e4c1;font-size:.75rem;padding:4px 10px;border-radius:12px}

/* 好友列表弹窗 */
.friends-list-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px}
.friends-list-modal{background:#2D3047;border-radius:16px;width:100%;max-width:340px;max-height:70vh;overflow:hidden;display:flex;flex-direction:column}
.friends-list-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(244,228,193,.1)}
.friends-list-header h3{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.1rem;margin:0}
.friends-list-header button{background:none;border:none;color:#f4e4c1;font-size:1.5rem;cursor:pointer;opacity:.7}
.friends-list-content{flex:1;overflow-y:auto;padding:12px}
.friend-item{display:flex;align-items:center;gap:12px;padding:14px;background:rgba(255,255,255,.05);border-radius:10px;margin-bottom:10px;cursor:pointer}
.friend-item:active{background:rgba(255,255,255,.1)}
.friend-avatar{font-size:1.8rem;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:rgba(139,115,85,.3);border-radius:10px}
.friend-info{flex:1;display:flex;flex-direction:column;gap:2px}
.friend-name{color:#f4e4c1;font-size:.95rem}
.friend-books{color:rgba(244,228,193,.5);font-size:.8rem}
.friend-arrow{color:rgba(244,228,193,.4);font-size:1.2rem}
.friends-empty{text-align:center;padding:40px 20px;color:rgba(244,228,193,.5)}
.friends-empty p{margin:8px 0}

/* 好友书架页面 */
.friend-bookshelf-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#2D3047 100%);z-index:4000;display:flex;flex-direction:column;overflow:hidden;animation:slideUpProfile .3s ease-out}
.friend-bookshelf-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(0,0,0,.2);border-bottom:1px solid rgba(244,228,193,.1)}
.friend-bookshelf-header button{background:none;border:none;color:#f4e4c1;font-size:1rem;cursor:pointer}
.friend-bookshelf-header h2{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.2rem;flex:1;text-align:center}
.readonly-badge{background:rgba(244,228,193,.15);color:#f4e4c1;font-size:.75rem;padding:4px 10px;border-radius:20px}
.friend-bookshelf-grid{flex:1;overflow-y:auto;padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:20px;align-content:start}
.friend-book-card{display:flex;flex-direction:column;align-items:center;gap:10px}
.friend-book-cover{width:100px;height:140px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:2.5rem;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.friend-book-cover img{width:100%;height:100%;object-fit:cover;border-radius:4px}
.friend-book-meta{text-align:center}
.friend-book-meta h3{color:#f4e4c1;font-size:.9rem;margin:0 0 4px}
.friend-book-meta p{color:rgba(244,228,193,.5);font-size:.75rem;margin:0}

/* Toast提示 */
.app-toast{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(45,48,71,.95);color:#f4e4c1;padding:12px 24px;border-radius:25px;font-size:.9rem;box-shadow:0 4px 20px rgba(0,0,0,.4);z-index:9999;animation:toastIn .3s ease-out;backdrop-filter:blur(10px)}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* 返航动画 */
.bookshelf-view.returning-home{animation:slideOutLeft .3s ease-in forwards}

@keyframes slideOutLeft{from{transform:translateX(0);opacity:1}to{transform:translateX(-100%);opacity:0}}

/* 统一返回按钮样式 */
.settings-back-btn,.library-back,.gallery-back{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%);border:none;color:#f4e4c1;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.settings-back-btn:active,.library-back:active,.gallery-back:active{transform:scale(.95)}

/* 设置页面toggle卡片 */
.settings-toggle-card{background:rgba(244,228,193,.08);border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between}
.toggle-card-content{display:flex;align-items:center;gap:12px}
.toggle-card-icon{font-size:1.5rem}
.toggle-card-text{display:flex;flex-direction:column;gap:2px}
.toggle-card-title{color:#f4e4c1;font-size:.95rem}
.toggle-card-desc{color:rgba(244,228,193,.5);font-size:.75rem}
.toggle-switch-label{position:relative;display:inline-block;width:50px;height:28px}
.toggle-switch-label input{opacity:0;width:0;height:0}
.toggle-switch-slider{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,.15);border-radius:28px;transition:.3s}
.toggle-switch-slider:before{position:absolute;content:'';height:22px;width:22px;left:3px;bottom:3px;background:#f4e4c1;border-radius:50%;transition:.3s}
.toggle-switch-label input:checked+.toggle-switch-slider{background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%)}
.toggle-switch-label input:checked+.toggle-switch-slider:before{transform:translateX(22px)}

/* 图书馆页面作为overlay */



/* 设置页面确认弹窗 */
.settings-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:3300}
.settings-confirm-modal{background:linear-gradient(135deg,#2D3047 0%,#1a1d2e 100%);border-radius:16px;padding:24px;width:90%;max-width:300px;text-align:center}
.settings-confirm-modal h3{color:#f4e4c1;font-size:1.1rem;margin-bottom:12px;font-family:'ZCOOL XiaoWei',serif}
.settings-confirm-modal p{color:rgba(244,228,193,.7);font-size:.9rem;margin-bottom:20px}
.settings-confirm-actions{display:flex;gap:12px}
.settings-confirm-actions button{flex:1;padding:12px;border-radius:10px;border:none;font-size:.95rem;cursor:pointer}
.settings-confirm-actions .cancel-btn{background:rgba(255,255,255,.1);color:#f4e4c1}
.settings-confirm-actions .confirm-btn{background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%);color:#f4e4c1}

/* ============ 人设模式样式 ============ */

/* 人设badge */
.character-badge{background:rgba(139,115,85,.3);color:#D4A84B;font-size:.65rem;padding:2px 6px;border-radius:8px;margin-left:6px;font-weight:normal}

/* 人设视图 */
.character-view{padding:16px;padding-bottom:100px}
.character-header{margin-bottom:20px;text-align:center}
.character-header h1{color:#8B7355;font-family:'ZCOOL XiaoWei',serif;font-size:1.4rem;margin-bottom:8px}
.character-hint{color:rgba(139,115,85,.6);font-size:.85rem}
.character-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}

/* 深色工牌卡片 */
.character-card.dark{background:linear-gradient(145deg,#3a3d52 0%,#2a2d3e 100%);border-radius:12px;padding:16px 12px;position:relative;cursor:pointer;transition:all .3s ease;border:1px solid rgba(244,228,193,.15)}
.character-card.dark::before{content:'';position:absolute;top:-8px;left:50%;transform:translateX(-50%);width:20px;height:12px;background:linear-gradient(180deg,#8B7355 0%,#6B5344 100%);border-radius:4px 4px 0 0}
.character-card.dark::after{content:'';position:absolute;top:-4px;left:50%;transform:translateX(-50%);width:8px;height:4px;background:#1a1d2e;border-radius:2px}
.character-card.dark:active{transform:scale(.98);border-color:rgba(212,168,75,.4)}
.character-card .card-avatar{width:80px;height:80px;margin:8px auto 12px;border-radius:8px;overflow:hidden;border:2px solid rgba(244,228,193,.2);background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;position:relative}
.character-card .card-avatar img{width:100%;height:100%;object-fit:cover}
.character-card .card-avatar .placeholder{font-size:2rem;color:rgba(244,228,193,.3)}
.character-card .card-number{position:absolute;top:4px;right:4px;background:rgba(139,115,85,.8);color:#f4e4c1;font-size:.6rem;padding:2px 6px;border-radius:4px;font-family:monospace}
.character-card .card-name{text-align:center;color:#f4e4c1;font-size:1.1rem;font-family:'ZCOOL XiaoWei',serif;margin-bottom:10px;letter-spacing:2px}
.character-card .card-tags{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:12px;min-height:24px}
.character-card .tag{background:rgba(244,228,193,.1);color:rgba(244,228,193,.7);font-size:.7rem;padding:3px 8px;border-radius:10px;border:1px solid rgba(244,228,193,.15)}
.character-card .tag.highlight{background:rgba(212,168,75,.2);color:#D4A84B;border-color:rgba(212,168,75,.3)}
.character-card .card-footer{display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px dashed rgba(244,228,193,.15)}
.character-card .card-footer .divider{flex:1;height:1px;background:repeating-linear-gradient(90deg,rgba(244,228,193,.2) 0px,rgba(244,228,193,.2) 4px,transparent 4px,transparent 8px)}
.character-card .card-footer .arrow{color:rgba(244,228,193,.4);font-size:.9rem;margin-left:8px}
.character-card .stamp{position:absolute;bottom:8px;left:8px;width:28px;height:28px;border:2px solid rgba(180,80,80,.4);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.6rem;color:rgba(180,80,80,.5);transform:rotate(-15deg)}

/* 深色工牌新建卡片 */
.character-card.dark.add-new{border:2px dashed rgba(244,228,193,.2);background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px}
.character-card.dark.add-new::before,.character-card.dark.add-new::after{display:none}
.character-card.dark.add-new:active{border-color:rgba(212,168,75,.5);background:rgba(212,168,75,.05)}
.character-card .add-icon{font-size:2.5rem;color:rgba(244,228,193,.3);margin-bottom:8px}
.character-card .add-text{color:rgba(244,228,193,.4);font-size:.85rem}

/* 复古档案卡片 */
.character-card-v2{background:linear-gradient(180deg,#f4e4c1 0%,#e8d5a8 100%);border-radius:4px;overflow:hidden;cursor:pointer;transition:all .3s ease;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.character-card-v2:active{transform:scale(.98)}
.character-card-v2 .card-v2-header{background:linear-gradient(135deg,#8B7355 0%,#6B5344 100%);padding:8px 12px;display:flex;justify-content:space-between;align-items:center}
.character-card-v2 .card-v2-header .label{color:#f4e4c1;font-size:.65rem;letter-spacing:2px}
.character-card-v2 .card-v2-header .code{color:rgba(244,228,193,.7);font-size:.6rem;font-family:monospace}
.character-card-v2 .card-v2-body{padding:12px;display:flex;gap:12px}
.character-card-v2 .card-v2-avatar{width:60px;height:72px;border:1px solid #8B7355;background:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.character-card-v2 .card-v2-avatar img{width:100%;height:100%;object-fit:cover}
.character-card-v2 .card-v2-avatar .placeholder{color:#ccc;font-size:1.5rem}
.character-card-v2 .card-v2-info{flex:1;min-width:0}
.character-card-v2 .card-v2-name{color:#2D3047;font-size:1rem;font-family:'ZCOOL XiaoWei',serif;margin-bottom:6px;border-bottom:1px solid rgba(45,48,71,.2);padding-bottom:4px}
.character-card-v2 .card-v2-tags{display:flex;flex-wrap:wrap;gap:4px}
.character-card-v2 .card-v2-tags .tag{background:rgba(45,48,71,.1);color:#2D3047;font-size:.65rem;padding:2px 6px;border-radius:2px;border:none}
.character-card-v2 .card-v2-footer{padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-top:1px dashed rgba(139,115,85,.3)}
.character-card-v2 .card-v2-stamp{width:32px;height:32px;border:2px solid rgba(180,60,60,.5);border-radius:4px;display:flex;align-items:center;justify-content:center;color:rgba(180,60,60,.6);font-size:.5rem;transform:rotate(-8deg);font-weight:bold}
.character-card-v2 .card-v2-arrow{color:#8B7355;font-size:.8rem}

/* 复古档案新建卡片 */
.character-card-v2.add-new{background:transparent;border:2px dashed rgba(139,115,85,.3);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:150px;box-shadow:none}
.character-card-v2.add-new .add-icon{font-size:2rem;color:rgba(139,115,85,.4)}
.character-card-v2.add-new .add-text{color:rgba(139,115,85,.5);font-size:.8rem;margin-top:8px}

/* 人设编辑弹窗 */
.character-edit-modal{max-width:340px}
.character-modal-overlay{z-index:6100}
.character-edit-modal h3{color:#2D3047}
.character-edit-modal .avatar-upload{width:100px;height:100px;margin:0 auto 20px;border-radius:12px;border:2px dashed rgba(139,115,85,.4);display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;background:rgba(139,115,85,.1)}
.character-edit-modal .avatar-upload img{width:100%;height:100%;object-fit:cover}
.character-edit-modal .avatar-upload .upload-placeholder{color:#8B7355;font-size:.85rem;text-align:center}
.character-edit-modal input,.character-edit-modal textarea{width:100%;padding:12px;background:rgba(255,255,255,.9);border:1px solid rgba(139,115,85,.3);border-radius:10px;color:#2D3047;font-size:.95rem;margin-bottom:12px;box-sizing:border-box}
.character-edit-modal input:focus,.character-edit-modal textarea:focus{outline:none;border-color:#8B7355}
.character-edit-modal input::placeholder,.character-edit-modal textarea::placeholder{color:rgba(45,48,71,.4)}

/* 人设详情页 */
.character-detail-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#252839 100%);z-index:6000;display:flex;flex-direction:column;animation:slideUpProfile .3s ease-out}
.character-detail-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;padding-top:calc(16px + env(safe-area-inset-top));background:rgba(0,0,0,.15);border-bottom:1px solid rgba(244,228,193,.06)}
.character-detail-header .back-btn{background:none;border:none;color:#f4e4c1;font-size:1.3rem;cursor:pointer;padding:8px}
.character-detail-header h2{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.1rem}
.character-detail-header .read-mode-toggle{display:flex;align-items:center;gap:6px}
.character-detail-content{flex:1;overflow-y:auto;padding:20px;padding-bottom:calc(40px + env(safe-area-inset-bottom))}

/* 人物档案卡片 - 米棕色风格 */
.char-profile-card{border-radius:16px;overflow:hidden;margin-bottom:24px}
.char-profile-card.dark{background:linear-gradient(145deg,#3a3d52 0%,#2a2d3e 100%);border:1px solid rgba(244,228,193,.15)}
.char-profile-card.light{background:linear-gradient(180deg,#f4e4c1 0%,#e8d5a8 100%);border:none}
.profile-main{padding:20px;display:flex;gap:18px;align-items:flex-start}
.profile-avatar{width:85px;height:105px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.char-profile-card.dark .profile-avatar{background:rgba(0,0,0,.25);border:2px solid rgba(244,228,193,.15)}
.char-profile-card.light .profile-avatar{background:#fff;border:2px solid #8B7355}
.profile-avatar img{width:100%;height:100%;object-fit:cover}
.profile-avatar .avatar-placeholder{font-size:2.2rem}
.char-profile-card.dark .avatar-placeholder{color:rgba(244,228,193,.25)}
.char-profile-card.light .avatar-placeholder{color:#ccc}
.profile-info{flex:1;min-width:0}
.profile-name{font-size:1.4rem;font-family:'ZCOOL XiaoWei',serif;margin-bottom:12px;font-weight:400}
.char-profile-card.dark .profile-name{color:#f4e4c1}
.char-profile-card.light .profile-name{color:#2D3047}
.profile-tags{display:flex;flex-wrap:wrap;gap:8px}
.profile-tag{padding:5px 14px;border-radius:14px;font-size:.82rem}
.char-profile-card.dark .profile-tag{background:rgba(244,228,193,.08);color:rgba(244,228,193,.75);border:1px solid rgba(244,228,193,.08)}
.char-profile-card.light .profile-tag{background:rgba(45,48,71,.08);color:#2D3047;border:1px solid rgba(45,48,71,.1)}
.profile-summary{padding:0 20px 16px;border-top:1px solid rgba(0,0,0,.08);margin-top:-4px;padding-top:16px}
.summary-label{font-size:.75rem;margin-bottom:6px}
.char-profile-card.dark .summary-label{color:rgba(244,228,193,.4)}
.char-profile-card.light .summary-label{color:rgba(45,48,71,.5)}
.profile-summary p{font-size:.9rem;line-height:1.65;margin:0}
.char-profile-card.dark .profile-summary p{color:rgba(244,228,193,.7)}
.char-profile-card.light .profile-summary p{color:#2D3047}
.profile-stamp{text-align:center;padding:10px;border-top:1px dashed rgba(0,0,0,.1);font-size:.72rem;letter-spacing:3px}
.char-profile-card.dark .profile-stamp{color:rgba(180,80,80,.4)}
.char-profile-card.light .profile-stamp{color:rgba(180,60,60,.5)}

/* 详细设定区 - 有背景边框 */
.char-detail-section{margin-top:8px}
.detail-title{color:rgba(244,228,193,.6);font-size:.88rem;margin-bottom:12px;padding-left:2px}
.detail-box{background:rgba(255,255,255,.04);border:1px solid rgba(244,228,193,.1);border-radius:12px;padding:16px;min-height:200px}
.detail-editor{width:100%;min-height:280px;padding:0;background:transparent;border:none;color:#f4e4c1;font-size:.95rem;line-height:1.9;resize:none;font-family:'Noto Serif SC',serif;overflow:hidden}
.detail-editor:focus{outline:none}
.detail-editor::placeholder{color:rgba(244,228,193,.3)}
.detail-content{min-height:100px}
.detail-body{color:#f4e4c1;font-size:.95rem;line-height:1.9}
.detail-content .empty-hint{color:rgba(244,228,193,.35);text-align:center;padding:50px 0}

/* 人物档案页链接样式 - 亮金色 */
.detail-body .char-link{color:#D4A84B;background:linear-gradient(180deg,transparent 65%,rgba(212,168,75,.2) 65%);cursor:pointer}
.detail-body .char-link.broken{color:rgba(244,228,193,.35);background:none}

/* 关系网页面 - 全新设计 */
.relation-network-page{position:fixed;inset:0;background:linear-gradient(180deg,#1a1d2e 0%,#252839 100%);z-index:6000;display:flex;flex-direction:column;animation:slideUpProfile .3s ease-out}
.network-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:rgba(0,0,0,.15);border-bottom:1px solid rgba(244,228,193,.08)}
.network-header .back-btn{background:none;border:none;color:#f4e4c1;font-size:1.3rem;cursor:pointer;padding:4px}
.network-header h2{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.1rem;flex:1;text-align:center}
.network-header .add-relation-btn{background:rgba(212,168,75,.15);border:1px solid rgba(212,168,75,.3);color:#D4A84B;padding:8px 14px;border-radius:20px;font-size:.8rem;cursor:pointer}
.relation-list-container{flex:1;overflow-y:auto;padding:16px}

/* 头像栏 */
.relation-avatars{display:flex;gap:8px;padding:12px;overflow-x:auto;background:rgba(0,0,0,.12);border-radius:16px;margin-bottom:20px}
.relation-avatar-item{display:flex;flex-direction:column;align-items:center;gap:6px;flex-shrink:0;cursor:pointer;padding:8px 10px;border-radius:12px;transition:all .2s;min-width:70px}
.relation-avatar-item:active{transform:scale(.95)}
.relation-avatar-item.selected{background:rgba(212,168,75,.15)}
.relation-avatar-item.selected .avatar-circle{border-color:#D4A84B;box-shadow:0 0 16px rgba(212,168,75,.35)}
.relation-avatar-item .avatar-circle{width:48px;height:48px;border-radius:50%;overflow:hidden;background:rgba(244,228,193,.08);display:flex;align-items:center;justify-content:center;font-size:1.4rem;border:2px solid rgba(244,228,193,.2);transition:all .25s}
.relation-avatar-item .avatar-circle img{width:100%;height:100%;object-fit:cover}
.relation-avatar-item .avatar-name{color:rgba(244,228,193,.85);font-size:.75rem;max-width:65px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* 关系列表 */
.relation-list{min-height:200px}
.relation-empty{text-align:center;padding:60px 20px;color:rgba(244,228,193,.4)}
.relation-empty span{font-size:3rem;display:block;margin-bottom:16px;opacity:.6}
.relation-empty p{margin:6px 0;font-size:.9rem}

/* 关系卡片 - 全新布局 */
.relation-card{background:rgba(255,255,255,.04);border-radius:14px;margin-bottom:12px;overflow:hidden;border:1px solid rgba(244,228,193,.06);transition:all .2s}
.relation-card.expanded{background:rgba(255,255,255,.06);border-color:rgba(244,228,193,.12)}
.relation-card-main{display:flex;align-items:center;padding:14px 12px;cursor:pointer;gap:10px}
.relation-card-main:active{background:rgba(255,255,255,.03)}

/* 人物信息 */
.relation-person{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:70px;flex-shrink:0}
.person-avatar{width:42px;height:42px;border-radius:50%;overflow:hidden;background:rgba(244,228,193,.08);display:flex;align-items:center;justify-content:center;font-size:1.2rem}
.person-avatar img{width:100%;height:100%;object-fit:cover}
.person-name{color:#f4e4c1;font-size:.8rem;max-width:70px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2}

/* 关系连接器 - 支持换行 */
.relation-connector{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:60px;padding:0 4px}
.connector-line{position:relative;width:100%;min-height:24px;display:flex;align-items:center;justify-content:center}
.connector-label{background:rgba(30,33,48,.9);padding:4px 10px;color:rgba(244,228,193,.95);font-size:.78rem;text-align:center;border-radius:10px;border:1px solid rgba(244,228,193,.12);line-height:1.4;word-break:break-all;max-width:120px}
.connector-arrow{color:rgba(244,228,193,.45);font-size:1rem;margin-top:2px}

/* 展开指示 */
.expand-indicator{color:rgba(244,228,193,.3);font-size:.7rem;margin-left:auto;padding-left:8px}

/* 展开内容 */
.relation-card-expand{padding:0 14px 14px;border-top:1px solid rgba(244,228,193,.06)}
.story-section{margin-top:12px}
.story-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.story-header span{color:rgba(244,228,193,.6);font-size:.85rem}
.story-header button{background:rgba(244,228,193,.08);border:none;color:rgba(244,228,193,.7);padding:5px 12px;border-radius:6px;font-size:.75rem;cursor:pointer}
.story-content{background:rgba(0,0,0,.15);border-radius:10px;padding:12px 14px;color:rgba(244,228,193,.75);font-size:.85rem;line-height:1.7;min-height:50px;white-space:pre-wrap}
.story-content .no-story{color:rgba(244,228,193,.35);font-style:italic}
.story-editor textarea{width:100%;min-height:100px;padding:12px;background:rgba(255,255,255,.92);border:none;border-radius:10px;color:#2D3047;font-size:.9rem;line-height:1.6;resize:vertical;font-family:inherit}
.story-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:10px}
.story-btns .cancel{background:none;border:1px solid rgba(244,228,193,.25);color:rgba(244,228,193,.6);padding:7px 16px;border-radius:8px;font-size:.8rem;cursor:pointer}
.story-btns .save{background:#D4A84B;border:none;color:#1a1d2e;padding:7px 16px;border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:500}

/* 统计 */
.relation-stats{text-align:center;padding:20px;color:rgba(244,228,193,.4);font-size:.8rem}

/* 关系网长按菜单 */
.relation-context-overlay{position:fixed;inset:0;z-index:6100}
.relation-context-menu{position:fixed;z-index:6200;background:#fff;border-radius:12px;overflow:hidden;min-width:140px;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.relation-context-menu button{display:flex;align-items:center;gap:10px;width:100%;padding:14px 18px;background:none;border:none;color:#2D3047;font-size:.9rem;cursor:pointer;text-align:left}
.relation-context-menu button:active{background:#f5f5f5}
.relation-context-menu button.danger{color:#e53935}
.relation-context-menu button:not(:last-child){border-bottom:1px solid #eee}
.relation-context-menu button span{font-size:1rem}

/* 添加关系弹窗 */
.relation-modal{max-width:360px}
.relation-modal-overlay{z-index:6200}
.relation-modal h3{color:#2D3047}
.relation-form{margin-bottom:20px}
.relation-people{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.relation-select-wrap{flex:1}
.relation-select-wrap select{width:100%;padding:12px;background:#fff;border:1px solid rgba(139,115,85,.3);border-radius:10px;color:#2D3047;font-size:.95rem;font-family:'Noto Serif SC',serif;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238B7355' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}
.relation-select-wrap select:focus{outline:none;border-color:#8B7355}
.relation-select-wrap select option{padding:10px;font-family:'Noto Serif SC',serif}
.relation-arrow{color:#8B7355;font-size:1.4rem;font-weight:bold}
.relation-form input{width:100%;padding:12px;background:#fff;border:1px solid rgba(139,115,85,.3);border-radius:10px;color:#2D3047;font-size:.9rem;margin-bottom:12px;box-sizing:border-box}
.relation-form input:focus{outline:none;border-color:#8B7355}
.relation-form input::placeholder{color:rgba(45,48,71,.4)}
.relation-options{display:flex;flex-direction:column;gap:12px}
.option-group{display:flex;align-items:center;gap:12px}
.option-group>span{color:#8B7355;font-size:.85rem;min-width:40px}
.option-buttons{display:flex;gap:8px}
.option-buttons button{padding:6px 14px;background:#fff;border:1px solid rgba(139,115,85,.3);border-radius:6px;color:#2D3047;font-size:.85rem;cursor:pointer}
.option-buttons button.active{background:rgba(139,115,85,.2);border-color:#8B7355;color:#8B7355}
.option-group input[type="range"]{flex:1;accent-color:#8B7355}
.color-options{display:flex;gap:8px;flex-wrap:wrap}
.color-dot{width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:all .2s}
.color-dot.active{border-color:#f4e4c1;transform:scale(1.1)}

/* 人设模式+菜单 */
.character-add-menu{bottom:80px}

/* 设置页卡片风格选择 */
.card-style-options{display:flex;gap:12px;margin-top:12px}
.card-style-option{flex:1;padding:12px;background:rgba(255,255,255,.05);border:2px solid transparent;border-radius:12px;cursor:pointer;text-align:center;transition:all .2s}
.card-style-option.active{border-color:rgba(212,168,75,.5);background:rgba(212,168,75,.1)}
.style-preview{width:60px;height:70px;margin:0 auto 8px;border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.style-preview.dark-preview{background:linear-gradient(145deg,#3a3d52 0%,#2a2d3e 100%)}
.style-preview.light-preview{background:linear-gradient(180deg,#f4e4c1 0%,#e8d5a8 100%)}
.style-preview .preview-avatar{font-size:1.2rem}
.style-preview.dark-preview .preview-name{color:#f4e4c1;font-size:.5rem}
.style-preview.light-preview .preview-name{color:#2D3047;font-size:.5rem}
.style-label{color:rgba(244,228,193,.7);font-size:.8rem}

/* 时间轴标签 */
.timeline-badge{display:inline-block;font-size:.6rem;background:linear-gradient(135deg,#D4A84B,#C9A227);color:#1a1a2e;padding:2px 6px;border-radius:8px;margin-left:6px;vertical-align:middle}

/* 时间轴模式视图 */
.timeline-mode-view{padding:0 16px 100px}
.timeline-header{text-align:center;padding:20px 0}
.timeline-header h1{font-family:'ZCOOL XiaoWei',serif;font-size:1.5rem;color:#2D3047;margin-bottom:8px}
.timeline-hint{color:#8B7355;font-size:.85rem}

/* 时间轴空状态 */
.timeline-empty{text-align:center;padding:80px 20px}
.timeline-empty span{font-size:4rem;display:block;margin-bottom:20px}
.timeline-empty h3{font-family:'ZCOOL XiaoWei',serif;font-size:1.3rem;color:#2D3047;margin-bottom:12px}
.timeline-empty p{color:#888;margin-bottom:24px}
.timeline-empty button{background:linear-gradient(135deg,#D4A84B,#C9A227);color:#1a1a2e;border:none;padding:12px 24px;border-radius:24px;font-size:1rem;cursor:pointer;font-family:'Noto Serif SC',serif}

/* 时间轴视图 */
.timeline-view{padding-bottom:20px}
.timeline-content{position:relative;padding-left:20px}

/* 子轴横幅 */
.sub-timeline-banner{display:flex;align-items:center;gap:10px;background:rgba(212,168,75,.1);border:1px solid rgba(212,168,75,.3);border-radius:12px;padding:10px 16px;margin-bottom:20px}
.sub-timeline-banner span:first-child{font-size:1.2rem}
.sub-timeline-banner span:nth-child(2){flex:1;color:#8B7355;font-weight:500}
.sub-timeline-banner button{background:none;border:1px solid #8B7355;color:#8B7355;padding:6px 12px;border-radius:16px;font-size:.8rem;cursor:pointer}

/* 纪年区块 */
.timeline-era{margin-bottom:32px}
.era-gap{text-align:center;padding:12px 0;color:#999;font-size:.8rem;border-left:2px dashed rgba(139,115,85,.3);margin-left:8px}
.era-header{background:linear-gradient(135deg,#2D3047,#1a1a2e);padding:12px 20px;border-radius:12px;margin-bottom:16px;cursor:pointer}
.era-name{color:#f4e4c1;font-family:'ZCOOL XiaoWei',serif;font-size:1.2rem;letter-spacing:2px}

/* 时间轴轨道 */
.timeline-track{position:relative;border-left:2px solid rgba(139,115,85,.4);margin-left:8px;padding-left:24px}

/* 年份跳过 */
.year-skip{display:flex;align-items:center;gap:10px;padding:8px 0;margin:8px 0}
.skip-line{color:#999;font-size:.75rem;letter-spacing:1px}
.skip-add{background:rgba(139,115,85,.1);border:1px dashed #8B7355;color:#8B7355;width:24px;height:24px;border-radius:50%;font-size:.9rem;cursor:pointer;display:flex;align-items:center;justify-content:center}

/* 年份间隔 */
.year-gap{text-align:center;padding:12px 0;color:#8B7355;font-size:.8rem}
.year-gap span{display:inline-block;padding:4px 16px;background:rgba(139,115,85,.08);border-radius:12px}

/* 年份节点 */
.year-node{position:relative;margin-bottom:16px}
.year-marker{display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0}
.node-dot{position:absolute;left:-33px;width:16px;height:16px;background:#D4A84B;border-radius:50%;border:3px solid #faf8f3}
.node-year{color:#2D3047;font-weight:600;font-size:.95rem}
.event-count{color:#8B7355;font-size:.8rem;margin-left:auto}

/* 年份事件 */
.year-events{padding:8px 0 0 4px}
.add-event-btn{background:none;border:1px dashed rgba(139,115,85,.4);color:#8B7355;padding:8px 16px;border-radius:16px;font-size:.85rem;cursor:pointer;width:100%}
.add-event-btn:active{background:rgba(139,115,85,.1)}
.event-item{background:rgba(255,255,255,.8);border-radius:10px;padding:10px 14px;margin-bottom:8px;box-shadow:0 2px 8px rgba(0,0,0,.05);border-left:3px solid #D4A84B}
.event-item.approximate{border-left-color:#999;background:rgba(255,255,255,.6)}
.event-item.approximate .node-dot{background:#999}
.event-time{display:block;color:#8B7355;font-size:.75rem;margin-bottom:4px}
.event-content{color:#2D3047;font-size:.9rem;line-height:1.6}
.event-link{color:#D4A84B;cursor:pointer;background:linear-gradient(180deg,transparent 65%,rgba(212,168,75,.2) 65%)}
.event-link.broken{color:#999;background:none}
.from-sub{margin-left:6px;font-size:.7rem}

.events-collapsed{padding:8px 0;cursor:pointer}
.first-event{color:#666;font-size:.85rem}
.more-hint{color:#8B7355;font-size:.75rem;margin-left:8px}

/* 无事件提示 */
.no-events-hint{padding:16px 0}
.no-events-hint .hint-text{color:#999;font-size:.85rem;margin-bottom:12px}
.add-first-event{background:none;border:1px dashed rgba(139,115,85,.4);color:#8B7355;padding:10px 20px;border-radius:20px;font-size:.85rem;cursor:pointer}

/* 时代事件区 */
.era-events-section{margin-top:24px;padding-top:24px;border-top:1px dashed rgba(139,115,85,.3)}
.era-event-item{background:rgba(139,115,85,.08);border-radius:10px;padding:12px 16px;margin-bottom:10px}
.era-event-label{display:block;color:#8B7355;font-size:.8rem;margin-bottom:6px;font-style:italic}
.era-event-content{color:#2D3047;font-size:.9rem}

/* 未知时间区 */
.unknown-events-section{margin-top:24px;padding:16px;background:rgba(0,0,0,.03);border-radius:12px;border:1px dashed rgba(0,0,0,.1)}
.unknown-header{color:#999;font-size:.85rem;margin-bottom:12px;text-align:center}
.unknown-event-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0}
.unknown-dot{color:#ccc;font-size:1rem}
.unknown-content{color:#666;font-size:.85rem}

/* 纪年弹窗 */
.era-modal{max-width:360px}
.era-modal .form-field{margin-bottom:14px}
.era-modal .form-field label{display:block;font-size:.85rem;color:#8B7355;margin-bottom:6px;font-weight:500}
.era-modal .form-field input{width:100%;padding:12px 16px;border:2px solid rgba(45,48,71,.1);border-radius:10px;font-family:'Noto Serif SC',serif;font-size:1rem;box-sizing:border-box}
.era-modal .form-field input:focus{outline:none;border-color:#8B7355}
.era-modal .form-field input::placeholder{color:#aaa}

/* 年份弹窗 */
.year-modal{max-width:360px}
.year-modal .form-field{margin-bottom:14px}
.year-modal .form-field label{display:block;font-size:.85rem;color:#8B7355;margin-bottom:6px;font-weight:500}
.year-modal .form-field input,.year-modal .form-field select{width:100%;padding:12px 16px;border:2px solid rgba(45,48,71,.1);border-radius:10px;font-family:'Noto Serif SC',serif;font-size:1rem;box-sizing:border-box}
.year-modal .form-field input:focus,.year-modal .form-field select:focus{outline:none;border-color:#8B7355}
.year-modal .form-field input::placeholder{color:#aaa}
.era-number-row{display:flex;gap:12px;margin-bottom:14px}
.era-number-field{flex:1}
.era-number-field label{display:block;font-size:.8rem;color:#8B7355;margin-bottom:6px}
.era-number-field input{width:100%;padding:10px;border:1px solid rgba(139,115,85,.3);border-radius:8px;font-size:1rem;text-align:center}
.era-gap-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;margin-top:4px}
.era-gap-row label{color:#8B7355;font-size:.85rem;font-weight:500}
.era-gap-row input{width:80px;padding:8px;border:1px solid rgba(139,115,85,.3);border-radius:8px;text-align:center}
.era-gap-row span{color:#666;font-size:.85rem}

/* 事件弹窗 */
.event-modal{max-width:380px}
.event-modal .time-selector{margin-bottom:16px}
.event-modal .time-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.event-modal .era-year-row{display:flex;gap:8px}
.event-modal .era-select{flex:0.9}
.event-modal .year-select{flex:1.1}
.event-modal .month-day-row select{flex:1}
.event-modal .month-day-row input{width:70px;flex:0 0 70px}
.event-modal select,.event-modal input[type="number"]{padding:10px 12px;border:2px solid rgba(45,48,71,.1);border-radius:8px;font-family:'Noto Serif SC',serif;font-size:.9rem}
.event-modal select:focus,.event-modal input:focus{outline:none;border-color:#8B7355}
.content-input{margin-bottom:12px}
.content-input label{display:block;color:#666;font-size:.85rem;margin-bottom:6px}
.content-input textarea{width:100%;padding:12px;border:1px solid rgba(139,115,85,.3);border-radius:10px;font-size:.9rem;resize:vertical;font-family:'Noto Serif SC',serif}

/* 子时间轴弹窗 */
.sub-timeline-modal{max-width:360px}
.icon-selector{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-bottom:16px}
.icon-option{font-size:1.5rem;padding:8px;border-radius:8px;cursor:pointer}
.icon-option.selected{background:rgba(212,168,75,.2)}
.range-section{margin-top:12px}
.range-section label{display:block;color:#666;font-size:.85rem;margin-bottom:8px}
.range-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.range-row select,.range-row input{padding:8px;border:1px solid rgba(139,115,85,.3);border-radius:8px;font-size:.85rem}
.range-row select{flex:1;min-width:80px}
.range-row input{width:60px}
.range-row span{color:#999}

/* 子时间轴列表页 */
.sub-timeline-page{position:fixed;inset:0;background:linear-gradient(180deg,#faf8f3 0%,#f5f0e8 100%);z-index:2500;display:flex;flex-direction:column;animation:slideUpProfile .3s ease-out}
.sub-timeline-header{display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid rgba(45,48,71,.1);background:rgba(250,248,243,.95)}
.sub-timeline-header .back-btn{background:none;border:none;font-size:1.3rem;cursor:pointer;color:#2D3047}
.sub-timeline-header h2{font-family:'ZCOOL XiaoWei',serif;font-size:1.2rem;color:#2D3047}
.sub-timeline-header .add-btn{background:linear-gradient(135deg,#D4A84B,#C9A227);color:#fff;border:none;width:32px;height:32px;border-radius:50%;font-size:1.2rem;cursor:pointer}
.sub-timeline-list{flex:1;overflow-y:auto;padding:16px}
.sub-timeline-list .empty-hint{text-align:center;padding:60px 20px;color:#999}
.sub-timeline-list .empty-hint span{font-size:3rem;display:block;margin-bottom:16px}
.sub-timeline-list .empty-hint p{margin:6px 0;font-size:.9rem}
.sub-timeline-card{display:flex;align-items:center;gap:14px;background:#fff;padding:16px;border-radius:12px;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,.05);cursor:pointer}
.sub-timeline-card:active{background:#f9f6f1}
.st-icon{font-size:1.8rem}
.st-info{flex:1}
.st-info h3{font-size:1rem;color:#2D3047;margin-bottom:4px}
.st-info p{font-size:.8rem;color:#8B7355}
.st-delete{background:none;border:none;color:#999;font-size:1.3rem;cursor:pointer;padding:8px}
.st-delete:hover{color:#e74c3c}

/* 时间类型选择器 */
.time-type-selector{display:flex;gap:8px;margin-bottom:16px}
.time-type-selector button{flex:1;padding:10px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;font-size:.9rem;cursor:pointer}
.time-type-selector button.active{background:#D4A84B;border-color:#D4A84B;color:#fff}
.year-input{flex:1;min-width:0}

/* 排序模式 */
.timeline-view.reordering .event-item{cursor:grab;border:2px dashed #D4A84B}
.timeline-view.reordering .event-item:active{cursor:grabbing;opacity:.8}
.reorder-hint{text-align:center;color:#D4A84B;font-size:.85rem;padding:12px;background:rgba(212,168,75,.1);border-radius:8px;margin-bottom:16px}
.drag-handle{color:#999;margin-right:8px;cursor:grab}
.event-item.draggable{user-select:none}

/* 时间轴+菜单 */
.timeline-add-menu{bottom:80px}
.add-menu-item.active{background:rgba(212,168,75,.2)}

/* 确认删除弹窗 */
.confirm-modal .warning{color:#e74c3c;font-size:.85rem;margin-top:8px}
.btn-delete{background:#e74c3c;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer}

/* 内联添加事件按钮 */
.add-event-btn.inline{width:auto;margin-top:8px;padding:4px 12px;font-size:.8rem;opacity:.7}
.add-event-btn.inline:hover{opacity:1}

/* 上下文菜单子菜单 */
.context-item-wrapper{position:relative}
.context-item.has-submenu{display:flex;justify-content:space-between;align-items:center}
.submenu-arrow{font-size:.7rem;color:#999;margin-left:auto}
.context-submenu{background:#fff;border-top:1px solid #eee;padding:4px 0}
.context-item.submenu-item{padding:12px 20px 12px 36px;font-size:.9rem}
.context-item.submenu-item.active{color:#D4A84B;background:rgba(212,168,75,.1)}

/* 关系网故事链接 */
.story-link{color:#D4A84B;cursor:pointer;font-weight:500}
.story-link:hover{text-decoration:underline}
.story-link.broken{color:#999;cursor:default}
.story-link.broken:hover{text-decoration:none}

@keyframes fadeInUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
`;
