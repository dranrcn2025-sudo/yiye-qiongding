import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { Filesystem, Directory, Share, loadCapacitor, isCapacitor, copyToClipboard } from './utils/clipboard';
import { signInAnonymously, getSession, onAuthStateChange, signIn, signUp, signOut, getUser, loadFromCloud, saveToCloudDb, deleteUserData, upsertInviteCode, findByInviteCode, db } from './utils/cloudbase';
import { STORAGE_KEY, LIBRARY_KEY, DB_NAME, DB_VERSION, TRASH_STORE, openDB, saveTrashToIDB, loadTrashFromIDB, cleanupStorage, saveToStorage, loadFromStorage, saveLibrary, loadLibrary } from './utils/storage';
import { generateId, collectAllLinkableTitles, findEntryPath, findEntryById, getAllChildContent, updateEntryInTree, addEntryToParent, deleteEntryFromTree, reorderEntriesInParent, countWords, countSingleEntryWords, countEntries } from './utils/treeOperations';
import { compressImage } from './utils/imageUtils';
import { parseTxtBook } from './utils/txtParser';
import { parseEpubBook } from './utils/epubParser';
import { initialData } from './data/initialData';
import ConfirmModal from './components/shared/ConfirmModal';
import ContextMenu from './components/shared/ContextMenu';
import AddMenu from './components/shared/AddMenu';
import SidebarItem from './components/shared/SidebarItem';
import BookModal from './components/shared/BookModal';
import EntryModal from './components/shared/EntryModal';
import EditorToolbar from './components/shared/EditorToolbar';
import BlockMenu from './components/shared/BlockMenu';
import { CharacterCard, AddCharacterCard, CharacterDetailPage, CharacterEditModal, RelationNetworkPage, AddRelationModal, CharacterAddMenu } from './components/character/CharacterComponents';
import { TimelineView, AddEraModal, AddYearModal, AddEventModal, TimelineAddMenu } from './components/timeline/TimelineComponents';
import { NovelAddMenu, MoveToVolumeModal, NovelTocView, NovelEditModal, StoryTocPage, StoryReaderSettings, NovelTocDrawer, StoryReader, StoryEditModal, StoryChapterEditor } from './components/novel/NovelComponents';
import { TrashPage, VersionHistoryPage, PaperStackPage, SettingsPage } from './components/overlay/OverlayPages';
import { SpecialModeModal, AuthModal, RocketModal } from './components/overlay/AuthModals';
import { ContentRenderer, RichEditor } from './components/content/EditorComponents';
import { MoveModal, ReorderList, SearchModal, TextFormatMenu, AlignMenu, FontMenu } from './components/shared/RemainingComponents';

// 工具函数已搬迁到 src/utils/ 目录

// txtParser 已搬迁到 src/utils/txtParser.js

// epubParser 已搬迁到 src/utils/epubParser.js

// 工具函数已搬迁到 src/utils/ 目录


// ============ 时间轴模式组件 ============


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
  const [showBlockMenu, setShowBlockMenu] = useState(false);
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
  const [libraryReaderClosing, setLibraryReaderClosing] = useState(false);
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
  const [showLoginGuide, setShowLoginGuide] = useState(false); // 首次登录引导
  // 回收站和版本历史
  const [trashBooks, setTrashBooks] = useState([]);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [versionHistory, setVersionHistory] = useState([]);
  
  // 启动时从IndexedDB加载回收站数据
  useEffect(() => {
    const loadTrash = async () => {
      // 先清理localStorage中的旧数据
      try {
        localStorage.removeItem('versionHistory');
        // 如果localStorage中有旧的trashBooks，迁移到IndexedDB
        const oldTrash = localStorage.getItem('trashBooks');
        if (oldTrash) {
          const oldData = JSON.parse(oldTrash);
          if (oldData.length > 0) {
            await saveTrashToIDB(oldData);
            localStorage.removeItem('trashBooks'); // 迁移后删除
            console.log('已将回收站数据迁移到IndexedDB');
          }
        }
      } catch (e) {}
      
      // 从IndexedDB加载
      const loaded = await loadTrashFromIDB();
      setTrashBooks(loaded);
      setTrashLoaded(true);
    };
    loadTrash();
  }, []);
  const [showTrash, setShowTrash] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [trashClosing, setTrashClosing] = useState(false);
  const [versionClosing, setVersionClosing] = useState(false);
  const [showPaperStack, setShowPaperStack] = useState(false);
  const [paperStackClosing, setPaperStackClosing] = useState(false);
  const [showBigCleanModal, setShowBigCleanModal] = useState(false);
  const [bigCleanStep, setBigCleanStep] = useState(1); // 1: 第一次确认, 2: 第二次确认
  // 坐标飞行相关
  const [showRocketModal, setShowRocketModal] = useState(false); // 火箭输入弹窗
  const [visitingBookshelf, setVisitingBookshelf] = useState(null); // 正在访问的书架数据
  const [visitingProfile, setVisitingProfile] = useState(null); // 正在访问的用户资料
  const [showRocketBtn, setShowRocketBtn] = useState(() => localStorage.getItem('showRocketBtn') !== 'false');
  const [characterCardStyle, setCharacterCardStyle] = useState(() => localStorage.getItem('characterCardStyle') || 'dark');
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(null);
  // 栈格式：[{ entry, animated: boolean }]，animated表示是否已播放过入场动画
  const [characterDetailStack, setCharacterDetailStack] = useState([]);
  const [closingCharacterIndex, setClosingCharacterIndex] = useState(-1);
  const [showRelationNetwork, setShowRelationNetwork] = useState(false);
  const [showCharacterAddMenu, setShowCharacterAddMenu] = useState(false);
  // 特殊模式选择弹窗
  const [showSpecialModeModal, setShowSpecialModeModal] = useState(false);
  const [specialModeTarget, setSpecialModeTarget] = useState(null);
  // 时间轴模式状态
  const [showTimelineSettings, setShowTimelineSettings] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [expandedYears, setExpandedYears] = useState(new Set());
  const [editingEvent, setEditingEvent] = useState(null);
  const [showTimelineAddMenu, setShowTimelineAddMenu] = useState(false);
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

  // 递归重新生成所有ID（两遍处理：先收集映射，再更新引用）
  const regenerateIds = (entries, idMap = new Map()) => {
    // 第一遍：递归收集所有旧ID到新ID的映射
    const collectIds = (items) => {
      items.forEach(entry => {
        const newId = generateId();
        idMap.set(entry.id, newId);
        if (entry.children?.length > 0) {
          collectIds(entry.children);
        }
      });
    };
    collectIds(entries);
    
    // 第二遍：递归更新所有ID和引用
    const updateEntries = (items) => {
      return items.map(entry => {
        const newEntry = {
          ...entry,
          id: idMap.get(entry.id)
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
          newEntry.children = updateEntries(entry.children);
        }
        
        return newEntry;
      });
    };
    
    return updateEntries(entries);
  };

  // 导入书籍文件的ref
  const importBookRef = useRef(null);

  // 导入书籍
  const handleImportYYD = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // 使用 FileReader 来兼容更多设备
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
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
          // 使用自定义确认弹窗
          setConfirmModal({
            isOpen: true,
            title: '书籍已存在',
            message: `已存在「${bookData.title}」，是否覆盖？\n选择"取消"将创建副本。`,
            onConfirm: () => {
              // 覆盖：删除旧书后导入
              importBookData(bookData, existingBook.id);
              setConfirmModal({ isOpen: false });
            },
            onCancel: () => {
              // 创建副本
              bookData.title = `${bookData.title} (导入)`;
              importBookData(bookData, null);
              setConfirmModal({ isOpen: false });
            }
          });
          return;
        }
        
        importBookData(bookData, null);
      } catch (err) {
        console.error('导入失败:', err);
        showToast('导入失败，请检查文件格式');
      }
    };
    
    reader.onerror = () => {
      showToast('读取文件失败');
    };
    
    reader.readAsText(file);
    
    // 清空input以允许重复选择同一文件
    e.target.value = '';
  };

  // 导入书籍数据的辅助函数
  const importBookData = (bookData, existingBookId) => {
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
      tags: bookData.tags || [],
      cover: bookData.cover || '📚',
      color: bookData.color || '#8B7355',
      coverImage: bookData.coverImage || null,
      showStats: bookData.showStats !== false,
      entries: newEntries,
      gallery: newGallery || { enabled: false, images: [] },
      settings: bookData.settings || {}
    };
    
    // 更新数据并立即同步到云端
    setData(prev => {
      let books = prev.books;
      if (existingBookId) {
        books = books.filter(b => b.id !== existingBookId);
      }
      const newData = {
        ...prev,
        books: [...books, newBook]
      };
      // 立即保存到本地和云端，防止被旧数据覆盖
      saveToStorage(newData);
      if (user) {
        saveToCloud(newData);
      }
      return newData;
    });
    
    showToast(`已导入「${newBook.title}」`);
  };

  // 返航动画
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [showReturnConfirm, setShowReturnConfirm] = useState(false);
  const [returnAnimating, setReturnAnimating] = useState(false); // false | 'up' | 'down'
  const [launchAnimating, setLaunchAnimating] = useState(false); // false | 'up' | 'down'
  const lastUserId = useRef(null);
  const manuallyLoggedOut = useRef(false);

  // 初始化认证状态（CloudBase 匿名登录）
  useEffect(() => {
    // 用户手动退出后不自动登录
    if (manuallyLoggedOut.current) {
      setAuthLoading(false);
      return;
    }
    signInAnonymously()
      .then(({ user: anonUser }) => {
        setUser(anonUser);
        lastUserId.current = anonUser?.uid ?? null;
        setAuthLoading(false);
        const hasSeenGuide = localStorage.getItem('hasSeenLoginGuide');
        if (!anonUser && !hasSeenGuide) {
          setTimeout(() => setShowLoginGuide(true), 500);
        }
      })
      .catch((e) => {
        console.warn('匿名登录失败，以离线模式运行:', e.message);
        setUser(null);
        setAuthLoading(false);
      });

    // 监听登录状态变化
    try {
      const unsubscribe = onAuthStateChange((_event, session) => {
        const newUser = session?.user ?? null;
        const newUserId = newUser?.uid ?? null;
        if (lastUserId.current && newUserId && lastUserId.current !== newUserId) {
          console.log('账号切换');
        }
        lastUserId.current = newUserId;
        setUser(newUser);
      });
      return () => { try { if (typeof unsubscribe === 'function') unsubscribe(); } catch(e) {} };
    } catch (e) {
      console.warn('登录监听设置失败，离线模式:', e.message);
    }
  }, []);

  // 注意：不再自动添加引导书，避免与老用户数据冲突
  // 新用户会通过 initialData 获得引导书
  // 老用户如果已删除引导书，可以从「管理员的稿纸堆」->「导入书籍」重新导入

  // 处理浏览器/手机返回键
  useEffect(() => {
    const handlePopState = (e) => {
      // 阻止默认退出行为，执行应用内返回
      if (characterDetailStack.length > 0) {
        // 档案页栈有内容，调用handleBack处理
        handleBack();
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
  }, [currentBook, currentEntry, navigationStack, characterDetailStack, showRelationNetwork, showGallery, showSettings, showLibrary, showStoryReader, showStoryToc]);

  // 用户登录后加载云端数据
  useEffect(() => {
    if (user) {
      loadCloudData();
      loadMyInviteCode();
    }
  }, [user]);

  // 加载云端数据 - 合并本地和云端数据（不覆盖）
  const loadCloudData = async () => {
    if (!user) return;
    setSyncStatus('syncing');
    try {
      const { data: cloudData, error } = await loadFromCloud(user.uid);
      
      if (error && error.code !== 'PGRST116') {
        throw error;
      }
      
      // 获取本地数据
      const localData = loadFromStorage();
      
      // 合并书籍的辅助函数
      const mergeBooks = (localBooks, cloudBooks) => {
        if (!localBooks?.length && !cloudBooks?.length) return [];
        if (!localBooks?.length) return cloudBooks || [];
        if (!cloudBooks?.length) return localBooks || [];
        
        const bookMap = new Map();
        
        // 计算单本书的内容量
        const getBookSize = (book) => {
          if (!book) return 0;
          let size = 0;
          const countRecursive = (entries) => {
            if (!entries) return;
            for (const e of entries) {
              size += 1;
              if (e.content) size += e.content.length;
              if (e.children) countRecursive(e.children);
            }
          };
          countRecursive(book.entries);
          return size;
        };
        
        // 先添加云端的书（以云端为基准）
        for (const book of cloudBooks) {
          bookMap.set(book.id, { book, size: getBookSize(book), source: 'cloud' });
        }
        
        // 再处理本地的书
        for (const book of localBooks) {
          const existing = bookMap.get(book.id);
          if (existing) {
            // 如果已存在，保留内容更多的那个
            const localSize = getBookSize(book);
            if (localSize > existing.size) {
              bookMap.set(book.id, { book, size: localSize, source: 'local' });
            }
          } else {
            // 不存在则添加（本地独有的书）
            bookMap.set(book.id, { book, size: getBookSize(book), source: 'local' });
          }
        }
        
        return Array.from(bookMap.values()).map(v => v.book);
      };
      
      if (cloudData?.data) {
        // 云端有数据，进行合并
        const cloudBooks = cloudData.data?.books || [];
        const localBooks = localData?.books || [];
        
        console.log('合并数据 - 本地:', localBooks.length, '本书, 云端:', cloudBooks.length, '本书');
        
        // 合并书籍
        const mergedBooks = mergeBooks(localBooks, cloudBooks);
        const mergedData = { books: mergedBooks };
        
        console.log('合并后:', mergedBooks.length, '本书');
        
        // 更新本地和云端
        setData(mergedData);
        saveToStorage(mergedData);
        await saveToCloud(mergedData);
        
        // 恢复用户资料（优先使用云端）
        const profile = cloudData.data.profile || localData?.profile;
        if (profile) {
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
        
        setLastSyncTime(new Date());
        showToast('数据已合并同步');
      } else {
        // 云端没有数据
        if (localData && localData.books?.length > 0) {
          // 本地有数据，上传到云端
          console.log('云端无数据，上传本地数据');
          await saveToCloud(localData);
          showToast('本地数据已上传到云端');
        } else {
          // 本地也没数据
          // 检查是否是老用户（有回收站数据或曾经使用过）
          const hasUsedBefore = localStorage.getItem('hasSeenLoginGuide') === 'true' || 
                                trashBooks.length > 0 ||
                                localStorage.getItem('lastUpdated');
          
          if (hasUsedBefore) {
            // 老用户，保持空书架，不强制添加引导书
            console.log('老用户登录空账号，保持空书架');
            const emptyData = { books: [] };
            setData(emptyData);
            saveToStorage(emptyData);
            await saveToCloud(emptyData);
          } else {
            // 真正的新用户，给予初始数据
            console.log('新用户，初始化数据');
            setData(initialData);
            saveToStorage(initialData);
            await saveToCloud(initialData);
          }
        }
      }
      setSyncStatus('success');
      setLastSyncTime(new Date());
    } catch (err) {
      console.error('加载云端数据失败:', err);
      setSyncStatus('error');
    }
  };

  // 保存到云端
  const saveToCloud = async (dataToSave) => {
    if (!user || !user.uid) return;
    setSyncStatus('syncing');
    try {
      const cloudData = {
        ...dataToSave,
        profile: {
          name: localStorage.getItem('userName') || '创作者',
          bio: localStorage.getItem('userBio') || '',
          shelfTitle: localStorage.getItem('userShelfTitle') || ''
        }
      };
      const { error } = await saveToCloudDb(user.uid, cloudData);
      if (error) throw error;
      localStorage.setItem('lastUpdated', Date.now().toString());
      setLastSyncTime(new Date());
      setSyncStatus('success');
    } catch (err) {
      console.error('保存到云端失败:', err.message);
      setSyncStatus('error');
    }
  };

  // 保存版本快照 - 功能暂时禁用
  const saveVersionSnapshot = (dataToSave) => {
    // 版本历史功能暂时禁用，后续会改为以词条为单位的本地版本
    // 避免占用过多存储空间
  };

  // 移入回收站
  const handleMoveToTrash = (book) => {
    // 如果正在查看这本书，先退回书架
    if (currentBook?.id === book.id) {
      setCurrentBook(null);
      setCurrentEntry(null);
      setViewMode('list');
      setNavigationStack([]);
    }
    
    // 从书架移除
    setData(prev => ({
      ...prev,
      books: prev.books.filter(b => b.id !== book.id)
    }));
    
    // 添加到回收站（使用IndexedDB，可以保存完整数据）
    setTrashBooks(prev => {
      const newTrash = [
        { book: { ...book }, deletedAt: new Date().toISOString() },
        ...prev
      ];
      
      // 异步保存到IndexedDB（完整数据，不压缩）
      saveTrashToIDB(newTrash).then(success => {
        if (!success) {
          console.warn('IndexedDB保存失败，数据只在内存中');
        }
      });
      
      return newTrash;
    });
    
    showToast('已移入回收站');
  };

  // 从回收站恢复
  const handleRestoreFromTrash = (book) => {
    // 从回收站移除
    setTrashBooks(prev => {
      const newTrash = prev.filter(item => item.book.id !== book.id);
      // 异步保存到IndexedDB
      saveTrashToIDB(newTrash);
      return newTrash;
    });
    
    // 添加回书架
    setData(prev => ({
      ...prev,
      books: [...prev.books, book]
    }));
    
    showToast('已恢复书籍');
  };

  // 彻底删除
  const handlePermanentDelete = (bookId) => {
    setTrashBooks(prev => {
      const newTrash = prev.filter(item => item.book.id !== bookId);
      // 异步保存到IndexedDB
      saveTrashToIDB(newTrash);
      return newTrash;
    });
    showToast('已彻底删除');
  };

  // 清空回收站
  const handleClearTrash = () => {
    // 过滤掉非引导书的书籍
    const guideBooks = trashBooks.filter(item => item.book.id === 'guide');
    setConfirmModal({
      isOpen: true,
      title: '清空回收站',
      message: guideBooks.length > 0 ? '确定清空回收站吗？引导书会保留，其他书籍将被彻底删除。' : '确定清空回收站吗？所有书籍将被彻底删除，无法恢复。',
      onConfirm: () => {
        setTrashBooks(guideBooks);
        // 异步保存到IndexedDB
        saveTrashToIDB(guideBooks);
        setConfirmModal({ isOpen: false });
        showToast('回收站已清空');
      }
    });
  };

  // 恢复到历史版本
  const handleRestoreVersion = (historyData) => {
    setData(historyData);
  };

  // 清理过期的回收站内容（7天后自动删除，引导书永久保留）
  useEffect(() => {
    // 等待回收站数据加载完成
    if (!trashLoaded || trashBooks.length === 0) return;
    
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    const filtered = trashBooks.filter(item => {
      // 引导书永久保留
      if (item.book.id === 'guide') return true;
      const deleteTime = new Date(item.deletedAt).getTime();
      return now - deleteTime < oneWeek;
    });
    
    if (filtered.length !== trashBooks.length) {
      setTrashBooks(filtered);
      // 异步保存到IndexedDB
      saveTrashToIDB(filtered);
    }
  }, [trashLoaded]);

  // 关闭回收站页面
  const closeTrash = () => {
    setTrashClosing(true);
    setTimeout(() => {
      setShowTrash(false);
      setTrashClosing(false);
    }, 280);
  };

  // 关闭版本历史页面
  const closeVersionHistory = () => {
    setVersionClosing(true);
    setTimeout(() => {
      setShowVersionHistory(false);
      setVersionClosing(false);
    }, 280);
  };

  // 关闭稿纸堆页面
  const closePaperStack = () => {
    setPaperStackClosing(true);
    setTimeout(() => {
      setShowPaperStack(false);
      setPaperStackClosing(false);
    }, 280);
  };

  // 大扫除 - 重置所有数据到初始状态
  const handleBigClean = async () => {
    try {
      // 1. 清空 localStorage（保留登录状态相关的）
      const keysToKeep = []; // CloudBase 无需保留 Supabase token
      const allKeys = Object.keys(localStorage);
      allKeys.forEach(key => {
        if (!keysToKeep.some(k => key.includes(k))) {
          localStorage.removeItem(key);
        }
      });
      
      // 2. 清空 IndexedDB（回收站）
      try {
        const db = await openDB();
        const tx = db.transaction(TRASH_STORE, 'readwrite');
        tx.objectStore(TRASH_STORE).clear();
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(); };
        });
      } catch (e) {
        console.warn('清空IndexedDB失败:', e);
      }
      
      // 3. 清空云端数据
      if (user) {
        await deleteUserData(user.uid);
      }
      
      // 4. 重置所有状态到初始值
      setData(initialData);
      setTrashBooks([]);
      setLibrary({ books: [] });
      setVersionHistory([]);
      setUserName('创作者');
      setUserAvatar('');
      setUserBg('');
      setUserBio('');
      setUserShelfTitle('');
      setCurrentBook(null);
      setCurrentEntry(null);
      setNavigationStack([]);
      setCharacterDetailStack([]);
      
      // 5. 保存初始数据
      saveToStorage(initialData);
      if (user) {
        await saveToCloud(initialData);
      }
      
      // 6. 关闭弹窗
      setShowBigCleanModal(false);
      setBigCleanStep(1);
      closePaperStack();
      closeProfile();
      
      showToast('大扫除完成，一切如新');
    } catch (err) {
      console.error('大扫除失败:', err);
      showToast('大扫除失败，请重试');
    }
  };

  // 加载我的邀请码
  const loadMyInviteCode = async () => {
    if (!user) return;
    const res = await db.collection('invite_codes').where({ user_id: user.uid }).get();
    if (res.data?.length > 0) {
      setMyInviteCode(res.data[0].code);
    }
  };

  // 生成邀请码
  const generateInviteCode = async () => {
    if (!user) return;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await upsertInviteCode(user.uid, code);
    if (error) {
      showToast('生成失败，请重试');
      return;
    }
    setMyInviteCode(code);
  };

  // 重置邀请码（旧码失效）
  const resetInviteCode = async () => {
    if (!user || !myInviteCode) return;
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error } = await upsertInviteCode(user.uid, newCode);
    if (error) {
      showToast('重置失败，请重试');
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
    const { data: invitation, error } = await findByInviteCode(code.toUpperCase());

    if (error || !invitation) {
      return { success: false, error: '坐标无效或不存在' };
    }

    if (user && invitation.user_id === user.uid) {
      return { success: false, error: '这是你自己的坐标哦' };
    }

    // 加载目标用户的书架
    const { data: userData, error: loadError } = await loadFromCloud(invitation.user_id);
    
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
    setLibraryReaderClosing(false);
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
  const handleLogout = async () => {
    manuallyLoggedOut.current = true;
    await signOut();
    setUser(null);
    closeSettings();
  };
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
  
  useEffect(() => { 
    if (currentBook) { 
      const u = data.books.find(b => b.id === currentBook.id); 
      if (!u) {
        // 书籍已被删除，返回书架
        setCurrentBook(null);
        setCurrentEntry(null);
        setViewMode('list');
        setNavigationStack([]);
      } else if (u !== currentBook) {
        setCurrentBook(u); 
      }
    } 
  }, [data.books]);
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
        // 如果是文件夹，添加特殊模式选项
        if (item.isFolder) {
          const currentMode = item.novelMode ? 'novel' : item.characterMode ? 'character' : item.timelineMode ? 'timeline' : null;
          opts.push({ 
            icon: currentMode ? '✓' : '📋', 
            label: currentMode === 'novel' ? '正文模式 ✓' : currentMode === 'character' ? '人设模式 ✓' : currentMode === 'timeline' ? '时间轴模式 ✓' : '特殊模式',
            action: () => { setSpecialModeTarget(item); setShowSpecialModeModal(true); }
          });
        }
        opts.push({ icon: '📁', label: '移动到...', action: () => { setMoveTarget(item); setShowMoveModal(true); } });
        opts.push({ icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: `删除「${item.title}」？`, onConfirm: () => { setData(prev => ({ ...prev, books: prev.books.map(b => b.id === currentBook.id ? { ...b, entries: deleteEntryFromTree(b.entries, item.id) } : b) })); if (currentEntry?.id === item.id) handleBack(); setConfirmModal({ isOpen: false }); } }) });
      } else if (type === 'book') { 
        opts = [
          { icon: '✏️', label: '编辑', action: () => { setEditingBook(item); setShowBookModal(true); } }, 
          { icon: '↕️', label: '移动', action: () => { setIsBookReorderMode(true); setDraggingBookId(item.id); } },
          { icon: '📤', label: '导出书籍', action: () => exportBook(item) },
          { icon: '🗑️', label: '删除', danger: true, action: () => setConfirmModal({ isOpen: true, title: '确认删除', message: item.id === 'guide' ? `删除「${item.title}」？\n这本书之后你保不齐还要用，我先给你收走，以后随时可以恢复。` : `删除「${item.title}」？\n将移入回收站，7天后自动清除`, onConfirm: () => { handleMoveToTrash(item); setConfirmModal({ isOpen: false }); } }) }
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
    // 如果档案页栈中有内容，弹出栈顶（带下滑动画）
    if (characterDetailStack.length > 0) {
      setClosingCharacterIndex(characterDetailStack.length - 1);
      setTimeout(() => {
        setClosingCharacterIndex(-1);
        setCharacterDetailStack(prev => {
          const removedItem = prev[prev.length - 1];
          const newStack = prev.slice(0, -1);
          // 只有当移除的是跨分类跳转的根节点（isJumpRoot: true），且栈清空了，才恢复导航状态
          if (removedItem?.isJumpRoot && newStack.length === 0 && navigationStack.length > 0) {
            const last = navigationStack[navigationStack.length - 1];
            setNavigationStack(s => s.slice(0, -1));
            if (last.bookId) {
              const booksSource = visitingBookshelf ? visitingBookshelf.books : data.books;
              const b = booksSource.find(x => x.id === last.bookId);
              if (b) {
                setCurrentBook(b);
                setCurrentEntry(last.entry);
                setViewMode(last.viewMode || 'single');
                // 恢复之前的档案页栈（如果有）
                if (last.characterDetailStack?.length > 0) {
                  return last.characterDetailStack.map(item => ({ ...item, animated: true }));
                }
              }
            } else {
              setCurrentEntry(last);
              setViewMode('list');
            }
          }
          return newStack;
        });
      }, 250);
      return;
    }
    
    // 普通返回，使用左右滑动动画
    setSlideAnim('slide-out'); 
    setTimeout(() => { 
      if (navigationStack.length > 0) { 
        const last = navigationStack[navigationStack.length - 1]; 
        setNavigationStack(s => s.slice(0, -1)); 
        if (last.bookId) {
          const booksSource = visitingBookshelf ? visitingBookshelf.books : data.books;
          const b = booksSource.find(x => x.id === last.bookId);
          if (b) {
            setCurrentBook(b);
            setCurrentEntry(last.entry);
            setViewMode(last.viewMode || 'single');
            // 恢复档案页栈
            if (last.characterDetailStack?.length > 0) {
              setCharacterDetailStack(last.characterDetailStack.map(item => ({ ...item, animated: true })));
            }
          }
        } else {
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
    // 访问模式下使用visitingBookshelf，否则使用data
    const booksSource = visitingBookshelf ? visitingBookshelf.books : data.books;
    const tb = booksSource.find(b => b.id === tbid); 
    if (tb) { 
      const path = findEntryPath(tb.entries, teid); 
      if (path) { 
        const te = path[path.length - 1]; 
        // 检查是否为人设模式下的角色（父级有characterMode）
        const parent = path.length >= 2 ? path[path.length - 2] : null;
        if (parent?.characterMode) {
          // 是角色跳转
          // 检查是否在同一个人设分类内跳转
          if (currentBook.id === tbid && currentEntry?.id === parent.id) {
            // 同一人设分类内，直接push到栈（不是跨分类跳转）
            setCharacterDetailStack(prev => [
              ...prev.map(item => ({ ...item, animated: true })),
              { entry: te, animated: false, isJumpRoot: false }
            ]);
          } else {
            // 跨书籍/跨分类跳转到角色
            // 保存当前状态，但不切换视图，只叠加档案页
            const jumpRecord = { bookId: currentBook.id, entry: currentEntry, viewMode, characterDetailStack: [...characterDetailStack] };
            setNavigationStack(p => [...p, jumpRecord]); 
            // 如果是跨书籍，需要切换书籍（但不切换到人设分类视图）
            if (currentBook.id !== tbid) {
              setCurrentBook(tb);
            }
            // 直接叠加档案页，isJumpRoot: true 表示这是跨分类跳转的根节点
            setCharacterDetailStack([{ entry: te, animated: false, isJumpRoot: true }]);
          }
        } else {
          // 普通跳转
          const jumpRecord = { bookId: currentBook.id, entry: currentEntry, viewMode, characterDetailStack: [...characterDetailStack] };
          setNavigationStack(p => [...p, jumpRecord]); 
          setSlideAnim('slide-in'); 
          setCurrentBook(tb);
          setCurrentEntry(te); 
          setCharacterDetailStack([]);
          if (te.isFolder && te.linkable) { 
            setViewMode('merged'); 
            setTimeout(() => initMerged(te), 0);
            setTimeout(() => {
              const contentArea = document.querySelector('.content-area');
              if (contentArea) contentArea.scrollTop = 0;
            }, 100);
          } else if (te.isFolder) setViewMode('list'); 
          else setViewMode('single'); 
          setTimeout(() => setSlideAnim(''), 250); 
        }
      } 
    } 
  }, [currentBook, currentEntry, viewMode, characterDetailStack, data.books, visitingBookshelf, initMerged]);

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
      // 清除光标前零宽字符格式标签，避免残留
      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        let n = range.startContainer, o = range.startOffset;
        if (n.nodeType === Node.TEXT_NODE && o > 0 && n.textContent[o - 1] === '​') {
          n.deleteData(o - 1, 1);
        }
        let prev = n.previousSibling;
        while (prev && prev.nodeType === Node.ELEMENT_NODE && prev.textContent === '​') {
          let r = prev; prev = prev.previousSibling; r.remove();
        }
      }
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
  const handleBlock = (cmd, val) => {
    const ed = document.querySelector('.rich-editor');
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      let block = sel.getRangeAt(0).startContainer;
      while (block && block !== ed && !/^(H[1-6]|P|BLOCKQUOTE|LI|DIV)$/.test(block.nodeName)) {
        block = block.parentNode;
      }
      const tag = block?.nodeName;
      if (cmd === 'heading') {
        if (tag === val.toUpperCase()) {
          document.execCommand('formatBlock', false, '<p>');
        } else {
          document.execCommand('formatBlock', false, `<${val}>`);
        }
      } else if (cmd === 'blockquote') {
        if (tag === 'BLOCKQUOTE') {
          document.execCommand('formatBlock', false, '<p>');
        } else {
          document.execCommand('formatBlock', false, '<blockquote>');
        }
      } else if (cmd === 'insertUnorderedList' || cmd === 'insertOrderedList') {
        const tagName = cmd === 'insertUnorderedList' ? 'UL' : 'OL';
        if (tag === 'LI') {
          document.execCommand('outdent', false, null);
        } else {
          document.execCommand(cmd, false, null);
        }
      }
    }
    ed.forceSave?.();
  };
  const handleIndent = () => {
    const ed = document.querySelector('.rich-editor');
    if (!ed) return;
    ed.focus();
    ed.querySelectorAll('p, h1, h2, h3, blockquote, li').forEach(p => {
      if (p.textContent.trim() && !p.textContent.startsWith('　　')) {
        const indent = document.createTextNode('　　');
        p.insertBefore(indent, p.firstChild);
      }
    });
    ed.forceSave?.();
  };
  const handleImageUpload = async (e) => { const f = e.target.files[0]; if (f) { const c = await compressImage(f, 600); const ed = document.querySelector('.rich-editor'); if (ed) { ed.focus(); document.execCommand('insertHTML', false, `<p style="text-align:center"><img src="${c}" style="max-width:100%;border-radius:8px" /></p>`); ed.forceSave?.(); } } e.target.value = ''; };
  const handleEntrySwipe = (e, dx) => { 
    if (dx < -80 && (e.isFolder || e.children?.length > 0)) { 
      setSlideAnim('slide-in'); 
      setNavigationStack(p => [...p, currentEntry].filter(Boolean)); 
      setCurrentEntry(e); 
      setViewMode('merged'); 
      setTimeout(() => initMerged(e), 50); 
      setTimeout(() => setSlideAnim(''), 250);
      // 滚动到顶部
      setTimeout(() => {
        const contentArea = document.querySelector('.content-area');
        if (contentArea) contentArea.scrollTop = 0;
      }, 100);
    } 
  };

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
    // 使用liveEntry确保获取最新数据
    const entry = currentEntry ? findEntryById(currentBook?.entries || [], currentEntry.id) || currentEntry : null;
    if (!entry?.characterMode) return;
    
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
        entries: updateEntryInTree(b.entries, entry.id, {
          children: [...(entry.children || []), newChar]
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
    
    setData(prev => {
      // 从prev中获取最新的entry
      const book = prev.books.find(b => b.id === currentBook?.id);
      if (!book) return prev;
      const entry = findEntryById(book.entries, currentEntry.id);
      if (!entry) return prev;
      
      const currentRelations = entry.characterRelations || [];
      return {
        ...prev,
        books: prev.books.map(b => b.id === book.id ? {
          ...b,
          entries: updateEntryInTree(b.entries, entry.id, {
            characterRelations: [...currentRelations, relation]
          })
        } : b)
      };
    });
  };
  
  // 删除关系
  const handleDeleteRelation = (relationId) => {
    if (!currentEntry?.characterMode) return;
    
    setData(prev => {
      const book = prev.books.find(b => b.id === currentBook?.id);
      if (!book) return prev;
      const entry = findEntryById(book.entries, currentEntry.id);
      if (!entry) return prev;
      
      return {
        ...prev,
        books: prev.books.map(b => b.id === book.id ? {
          ...b,
          entries: updateEntryInTree(b.entries, entry.id, {
            characterRelations: (entry.characterRelations || []).filter(r => r.id !== relationId)
          })
        } : b)
      };
    });
  };
  
  // 更新关系（包括故事备忘）
  const handleUpdateRelation = (updatedRelation) => {
    if (!currentEntry?.characterMode) return;
    
    setData(prev => {
      const book = prev.books.find(b => b.id === currentBook?.id);
      if (!book) return prev;
      const entry = findEntryById(book.entries, currentEntry.id);
      if (!entry) return prev;
      
      return {
        ...prev,
        books: prev.books.map(b => b.id === book.id ? {
          ...b,
          entries: updateEntryInTree(b.entries, entry.id, {
            characterRelations: (entry.characterRelations || []).map(r => 
              r.id === updatedRelation.id ? updatedRelation : r
            )
          })
        } : b)
      };
    });
  };
  
  // 选择特殊模式
  const handleSelectSpecialMode = (mode) => {
    if (!specialModeTarget) return;
    
    const item = specialModeTarget;
    const currentMode = item.novelMode ? 'novel' : item.characterMode ? 'character' : item.timelineMode ? 'timeline' : null;
    
    setData(prev => ({
      ...prev,
      books: prev.books.map(b => b.id === currentBook.id ? {
        ...b,
        entries: updateEntryInTree(b.entries, item.id, {
          novelMode: mode === 'novel' && currentMode !== 'novel',
          characterMode: mode === 'character' && currentMode !== 'character',
          timelineMode: mode === 'timeline' && currentMode !== 'timeline',
          characterRelations: mode === 'character' ? (item.characterRelations || []) : item.characterRelations,
          timelineConfig: mode === 'timeline' ? (item.timelineConfig || { eras: [], years: [], events: [], subTimelines: [] }) : item.timelineConfig
        })
      } : b)
    }));
    
    setSpecialModeTarget(null);
  };
  
  // 人设卡片点击（本地点击，不是跨分类跳转）
  const handleCharacterClick = (char) => {
    // 标记现有栈项为已动画，新项为未动画，isJumpRoot: false 表示不是跨分类跳转
    setCharacterDetailStack(prev => [
      ...prev.map(item => ({ ...item, animated: true })),
      { entry: char, animated: false, isJumpRoot: false }
    ]);
  };
  
  // 保存人设详情内容（从CharacterDetailPage调用）
  const handleSaveCharacterContent = (updatedEntry) => {
    if (!updatedEntry?.id) return;
    
    // 使用prev确保获取最新状态
    setData(prev => {
      // 找到包含这个entry的book
      const targetBook = prev.books.find(b => {
        const findInTree = (entries) => {
          for (const e of entries) {
            if (e.id === updatedEntry.id) return true;
            if (e.children && findInTree(e.children)) return true;
          }
          return false;
        };
        return findInTree(b.entries);
      });
      
      if (!targetBook) return prev;
      
      return {
        ...prev,
        books: prev.books.map(b => b.id === targetBook.id ? {
          ...b,
          entries: updateEntryInTree(b.entries, updatedEntry.id, { content: updatedEntry.content })
        } : b)
      };
    });
    
    // 更新栈中对应的角色内容
    setCharacterDetailStack(prev => prev.map(item => 
      item.entry.id === updatedEntry.id 
        ? { ...item, entry: { ...item.entry, content: updatedEntry.content } } 
        : item
    ));
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
            events: newEvents
          }
        })
      } : b)
    }));
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

  // 压缩图片的辅助函数
  const compressImage = (file, maxWidth, maxHeight, quality = 0.8) => {
    if (maxHeight === undefined) maxHeight = maxWidth;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width *= ratio;
            height *= ratio;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  };

  // 安全保存到localStorage
  const safeLocalStorageSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn(`保存 ${key} 失败:`, e);
      // 尝试清理一些不重要的数据
      try {
        localStorage.removeItem('versionHistory');
      } catch (e2) {}
      // 再次尝试
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e3) {
        return false;
      }
    }
  };

  // 上传头像（压缩到200x200）
  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const dataUrl = await compressImage(file, 200, 200, 0.8);
      setUserAvatar(dataUrl);
      if (!safeLocalStorageSet('userAvatar', dataUrl)) {
        showToast('头像保存失败，存储空间不足');
      }
    } catch (err) {
      console.error('头像处理失败:', err);
      showToast('头像上传失败');
    }
  };

  // 上传背景图（压缩到800x800）
  const handleBgUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const dataUrl = await compressImage(file, 800, 800, 0.7);
      setUserBg(dataUrl);
      if (!safeLocalStorageSet('userBg', dataUrl)) {
        showToast('背景保存失败，存储空间不足');
      }
    } catch (err) {
      console.error('背景处理失败:', err);
      showToast('背景上传失败');
    }
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
      
      // 获取完整高度，不做截断
      const fullHeight = el.offsetHeight + 32;
      
      const canvas = await window.html2canvas(el, {
        backgroundColor: '#f5f0e8',
        scale: 2,
        useCORS: true,
        logging: false,
        x: -16,
        y: -16,
        width: el.offsetWidth + 32,
        height: fullHeight,
        windowHeight: fullHeight + 100
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
      showToast('导出失败，内容过长或请稍后重试');
    }
  };

  // 通用导出元素为图片函数（供子组件调用）
  const exportElementAsImage = async (el, title) => {
    if (!el) return;
    
    showToast('正在生成图片...');
    
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
      
      // 检测是否使用深色主题
      const isDarkTheme = el.querySelector('.char-profile-card.dark') !== null;
      const bgColor = isDarkTheme ? '#2D3047' : '#f5f0e8';
      const cardBgColor = isDarkTheme ? '#2a2d3e' : '#f5f0e8';
      
      // 保存原始样式
      const originalStyle = el.getAttribute('style') || '';
      
      // 临时添加导出样式
      el.style.background = cardBgColor;
      el.style.borderRadius = '16px';
      el.style.padding = '24px 20px';
      el.style.boxShadow = '0 4px 20px rgba(45,48,71,.1)';
      
      // 修复头像图片的样式，确保导出时不变形
      const avatarContainers = el.querySelectorAll('.profile-avatar');
      const originalContainerStyles = [];
      avatarContainers.forEach((container, i) => {
        originalContainerStyles[i] = container.getAttribute('style') || '';
        // 确保容器尺寸正确
        container.style.width = '85px';
        container.style.height = '105px';
        container.style.overflow = 'hidden';
      });
      
      const avatarImgs = el.querySelectorAll('.profile-avatar img');
      const originalAvatarStyles = [];
      avatarImgs.forEach((img, i) => {
        originalAvatarStyles[i] = img.getAttribute('style') || '';
        // 确保图片正确缩放
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.objectPosition = 'center top';
      });
      
      // 获取完整尺寸
      const fullWidth = el.offsetWidth + 32;
      const fullHeight = el.offsetHeight + 32;
      
      const canvas = await window.html2canvas(el, {
        backgroundColor: bgColor,
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        x: -16,
        y: -16,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth + 100,
        windowHeight: fullHeight + 100,
        onclone: (clonedDoc) => {
          // 在克隆的文档中修复样式
          const clonedAvatarContainers = clonedDoc.querySelectorAll('.profile-avatar');
          clonedAvatarContainers.forEach(container => {
            container.style.width = '85px';
            container.style.height = '105px';
            container.style.overflow = 'hidden';
            container.style.borderRadius = '10px';
          });
          
          const clonedAvatars = clonedDoc.querySelectorAll('.profile-avatar img');
          clonedAvatars.forEach(img => {
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.objectPosition = 'center top';
          });
          
          // 修复深色主题下的详细设定区域背景
          if (isDarkTheme) {
            const detailBox = clonedDoc.querySelector('.detail-box');
            if (detailBox) {
              detailBox.style.background = 'rgba(255,255,255,0.05)';
              detailBox.style.color = 'rgba(244,228,193,0.85)';
            }
            const detailBody = clonedDoc.querySelector('.detail-body');
            if (detailBody) {
              detailBody.style.color = 'rgba(244,228,193,0.85)';
            }
            const detailTitle = clonedDoc.querySelector('.detail-title');
            if (detailTitle) {
              detailTitle.style.color = 'rgba(244,228,193,0.7)';
            }
            const charDetailSection = clonedDoc.querySelector('.char-detail-section');
            if (charDetailSection) {
              charDetailSection.style.background = 'transparent';
            }
          }
        }
      });
      
      // 恢复原始样式
      el.setAttribute('style', originalStyle);
      avatarContainers.forEach((container, i) => {
        container.setAttribute('style', originalContainerStyles[i]);
      });
      avatarImgs.forEach((img, i) => {
        img.setAttribute('style', originalAvatarStyles[i]);
      });
      
      const fileName = `${title || '导出'}_${Date.now()}.png`;
      
      if (isCapacitor()) {
        await loadCapacitor();
        if (Filesystem && Share) {
          const dataUrl = canvas.toDataURL('image/png');
          const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
          
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
          
          showToast('图片已生成');
        } else {
          throw new Error('Capacitor modules not loaded');
        }
      } else {
        // Web端下载
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('图片已下载');
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

  // 安全检查：如果currentBook存在但已从data.books中删除，视为无效
  const bookStillExists = currentBook ? data.books.some(b => b.id === currentBook.id) : false;

  if (!currentBook || !bookStillExists) {
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
  }}>{pages.map((pageBooks, pageIndex) => (<div key={pageIndex} className="bookshelf-page"><div className="bookshelf-grid">{pageBooks.map((b, bookIndexInPage) => { const globalIndex = pageIndex * booksPerPage + bookIndexInPage; return b.isAddButton ? (<div key="add" className="book-card add-book" onClick={() => { setEditingBook(null); setShowBookModal(true); }}><div className="book-cover"><span className="add-icon">+</span></div><div className="book-meta"><h2>新建世界</h2></div></div>) : (<div key={b.id} className={`book-card ${isBookReorderMode && draggingBookId === b.id ? 'dragging' : ''} ${isBookReorderMode ? 'reorder-mode' : ''}`} style={{ '--book-color': b.color || '#8B7355' }} onClick={() => !isBookReorderMode && handleBookSelect(b)} onTouchStart={e => { e.stopPropagation(); if (!isVisiting && !isBookReorderMode) handleLongPressStart(e, 'book', b); }} onTouchEnd={!isVisiting ? handleLongPressEnd : undefined} onTouchMove={!isVisiting ? handleLongPressEnd : undefined}><div className="book-spine" /><div className="book-cover">{b.coverImage ? <img src={b.coverImage} alt="" className="cover-image" /> : <span className="book-emoji">{b.cover}</span>}</div><div className="book-shadow" /><div className="book-meta"><h2>{b.title}</h2>{b.author && <p>{b.author} 著</p>}</div>{isBookReorderMode && draggingBookId !== b.id && (<div className="book-drop-zone" onClick={(e) => { e.stopPropagation(); handleMoveBook(draggingBookId, globalIndex); }}>放这里</div>)}</div>); })}</div></div>))}</div>{isVisiting && <div className="return-hint">↓ 轻触星球返航 ↓</div>}{totalPages > 1 && (<div className="shelf-page-dots">{pages.map((_, i) => (<span key={i} className={`shelf-dot ${shelfPage === i ? 'active' : ''}`} onClick={() => { shelfRef.current?.scrollTo({ left: i * shelfRef.current.clientWidth, behavior: 'smooth' }); }} />))}</div>)}<BookModal isOpen={showBookModal} onClose={() => { setShowBookModal(false); setEditingBook(null); }} onSave={handleAddBook} editingBook={editingBook} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /><SearchModal isOpen={showSearch} onClose={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }} query={searchQuery} setQuery={setSearchQuery} results={searchResults} onSearch={performSearch} onResultClick={handleSearchResultClick} />{showProfile && (<div className={`profile-page ${profileClosing ? 'closing' : ''}`} style={userBg ? { backgroundImage: `url(${userBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}><div className="profile-bg-overlay" /><div className="profile-header"><button className="profile-close" onClick={closeProfile}>×</button><div className="profile-avatar" onClick={() => avatarUploadRef.current?.click()}>{userAvatar ? <img src={userAvatar} alt="" /> : '✨'}</div><input ref={avatarUploadRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} /><input type="text" className="profile-name" value={userName} onChange={e => saveUserName(e.target.value)} placeholder="点击编辑名字" /><input type="text" className="profile-shelf-title" value={userShelfTitle} onChange={e => saveShelfTitle(e.target.value)} placeholder="自定义书架标题（访客可见）" /><textarea className="profile-bio" value={userBio} onChange={e => saveUserBio(e.target.value)} placeholder="写一句简介..." rows={2} /></div><div className="profile-stats"><div className="stat-item"><span className="stat-number">{totalStats.books}</span><span className="stat-label">作品</span></div><div className="stat-item"><span className="stat-number">{totalStats.entries}</span><span className="stat-label">词条</span></div><div className="stat-item"><span className="stat-number">{totalStats.words.toLocaleString()}</span><span className="stat-label">总字数</span></div></div><div className="profile-menu"><div className="profile-menu-item" onClick={closeProfile}><span>📚</span><span>我的书架</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => setShowTotalGallery(true)}><span>🖼️</span><span>画廊 ({totalStats.images})</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => setShowPaperStack(true)}><span>📄</span><span>管理员的稿纸堆</span><span className="menu-arrow">›</span></div><div className="profile-menu-item" onClick={() => bgUploadRef.current?.click()}><span>🎨</span><span>更换背景</span><span className="menu-arrow">›</span></div><input ref={bgUploadRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} /><div className="profile-menu-item" onClick={() => setShowSettings(true)}><span>⚙️</span><span>设置</span><span className="menu-arrow">›</span></div><div className="profile-menu-item"><span>💡</span><span>关于一页穹顶</span><span className="menu-arrow">›</span></div></div><div className="profile-bottom-bar"><div className="profile-account-status">{user ? (<div className="logged-in"><span className="sync-indicator" data-status={syncStatus}></span><span>{user.email}</span></div>) : (<button className="login-btn" onClick={() => { setShowAuthModal(true); setAuthMode('login'); }}>登录 / 注册</button>)}</div><div className="profile-version">一页穹顶 v1.0</div></div></div>)}{showTotalGallery && (<div className={`total-gallery-page ${galleryClosing ? "closing" : ""}`}><div className="gallery-header"><button className="gallery-back" onClick={closeGallery}>←</button><h2>画廊</h2><span></span></div><div className="total-gallery-list">{data.books.filter(b => b.gallery?.enabled).map(book => (<div key={book.id} className="total-gallery-book"><div className="total-gallery-book-header" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><span className="book-icon">{book.coverImage ? <img src={book.coverImage} alt="" /> : book.cover}</span><span className="book-title">{book.title}</span><span className="book-count">{book.gallery.images?.length || 0}张</span></div><div className="total-gallery-book-images">{book.gallery.images?.slice(0, 3).map(img => (<div key={img.id} className="total-gallery-thumb" onClick={() => { setCurrentBook(book); setShowTotalGallery(false); closeProfile(); setTimeout(() => setShowGallery(true), 300); }}><img src={img.src} alt="" /></div>))}<label className="total-gallery-add-btn"><input type="file" accept="image/*" multiple onChange={(e) => { const files = e.target.files; if (!files?.length) return; Array.from(files).forEach(file => { const reader = new FileReader(); reader.onload = (ev) => { const newImg = { id: Date.now().toString() + Math.random(), src: ev.target.result, featured: false }; setData(prev => ({ ...prev, books: prev.books.map(b => b.id === book.id ? { ...b, gallery: { ...b.gallery, images: [...(b.gallery.images || []), newImg] } } : b) })); }; reader.readAsDataURL(file); }); e.target.value = ''; }} style={{ display: 'none' }} /><span>+</span></label></div></div>))}{data.books.filter(b => b.gallery?.enabled).length === 0 && (<div className="gallery-empty"><span>🖼️</span><p>还没有任何画廊</p><p>在书籍中开启画廊功能</p></div>)}</div></div>)}{showLibrary && (<div className={`library-page ${libraryClosing ? "closing" : ""}`}><div className="library-header"><button className="library-back" onClick={closeLibrary}>←</button><h2>图书馆</h2><label className="library-import-btn">{importLoading ? '导入中...' : '📥 导入'}<input ref={libraryUploadRef} type="file" accept=".txt,.epub" onChange={handleImportBook} style={{ display: 'none' }} disabled={importLoading} /></label></div><div className="library-hint">支持导入 txt、epub 格式的电子书</div><div className="library-list">{library.books.map(book => (<div key={book.id} className="library-book-item"><div className="library-book-cover">{book.type === 'epub' ? '📕' : '📄'}{book.bookmark && <span className="library-bookmark-badge">🔖</span>}</div><div className="library-book-info" onClick={() => openLibraryBook(book)}><h3>{book.title}</h3><p>{book.author} · {book.chapters.length}章</p><p className="library-book-time">{new Date(book.importTime).toLocaleDateString()}{book.bookmark && ` · 已读至第${book.bookmark.chapterIndex + 1}章`}</p></div><button className="library-book-delete" onClick={(e) => { e.stopPropagation(); handleDeleteLibraryBook(book.id, book.title); }}>🗑️</button></div>))}{library.books.length === 0 && (<div className="library-empty"><span>📚</span><p>图书馆空空如也</p><p>点击右上角导入电子书</p></div>)}</div><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /></div>)}{showLibraryReader && libraryBook && (<div className={`story-reader-wrapper ${libraryReaderClosing ? 'closing' : ''}`}><StoryReader book={{ title: libraryBook.title }} chapter={libraryBook.chapters[libraryChapterIndex]} novelModeEntry={null} allChapters={libraryBook.chapters} currentChapterIndex={libraryChapterIndex} onClose={() => { setLibraryReaderClosing(true); setTimeout(() => { setShowLibraryReader(false); setLibraryReaderClosing(false); }, 280); }} onChangeChapter={(ch) => { const idx = libraryBook.chapters.findIndex(c => c.id === ch.id); if (idx >= 0) setLibraryChapterIndex(idx); }} onEdit={() => {}} settings={storySettings} onChangeSettings={setStorySettings} isLibraryMode={true} isBookmarked={libraryBook.bookmark !== null} onToggleBookmark={toggleLibraryBookmark} initialPage={libraryBook.bookmark?.page || 0} /></div>)}<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} mode={authMode} setMode={setAuthMode} showToast={showToast} />{showLoginGuide && (<div className="login-guide-overlay" onClick={() => { localStorage.setItem('hasSeenLoginGuide', 'true'); setShowLoginGuide(false); }}><div className="login-guide-modal" onClick={e => e.stopPropagation()}><div className="login-guide-icon">✨</div><h3>欢迎来到一页穹顶</h3><p>登录后可以云端同步数据，多设备使用</p><p className="login-guide-hint">数据不会丢失，随时随地创作</p><div className="login-guide-actions"><button className="login-guide-skip" onClick={() => { localStorage.setItem('hasSeenLoginGuide', 'true'); setShowLoginGuide(false); }}>先逛逛</button><button className="login-guide-login" onClick={() => { localStorage.setItem('hasSeenLoginGuide', 'true'); setShowLoginGuide(false); setShowAuthModal(true); setAuthMode('login'); }}>登录 / 注册</button></div></div></div>)}{showRocketModal && (<RocketModal isOpen={showRocketModal} onClose={() => setShowRocketModal(false)} onFly={flyToCoordinate} showToast={showToast} onLaunchStart={() => setLaunchAnimating('up')} />)}<SettingsPage isOpen={showSettings} isClosing={settingsClosing} onClose={closeSettings} user={user} onLogout={handleLogout} myInviteCode={myInviteCode} onGenerateCode={generateInviteCode} onResetCode={resetInviteCode} formatCoordinate={formatCoordinate} syncStatus={syncStatus} lastSyncTime={lastSyncTime} onSyncNow={() => { saveToCloud(data); }} showRocketBtn={showRocketBtn} onToggleRocketBtn={toggleRocketBtn} showToast={showToast} characterCardStyle={characterCardStyle} onChangeCardStyle={changeCardStyle} /><PaperStackPage isOpen={showPaperStack} isClosing={paperStackClosing} onClose={closePaperStack} trashCount={trashBooks.length} libraryCount={library.books.length} onOpenTrash={() => setShowTrash(true)} onOpenVersionHistory={() => setShowVersionHistory(true)} onOpenLibrary={() => setShowLibrary(true)} onImportBook={handleImportYYD} importLoading={false} onBigClean={() => setShowBigCleanModal(true)} /><TrashPage isOpen={showTrash} isClosing={trashClosing} onClose={closeTrash} trashBooks={trashBooks} onRestore={handleRestoreFromTrash} onDelete={handlePermanentDelete} onClear={handleClearTrash} /><VersionHistoryPage isOpen={showVersionHistory} isClosing={versionClosing} onClose={closeVersionHistory} versionHistory={versionHistory} onRestore={handleRestoreVersion} showToast={showToast} />{showReturnConfirm && (<div className="return-confirm-overlay" onClick={() => setShowReturnConfirm(false)}><div className="return-confirm-modal" onClick={e => e.stopPropagation()}><div className="rocket-icon">🚀</div><h3>确认返航？</h3><p>即将返回你自己的书架</p><div className="return-confirm-actions"><button className="stay-btn" onClick={() => setShowReturnConfirm(false)}>再看看</button><button className="go-btn" onClick={confirmReturn}>返航</button></div></div></div>)}{showBigCleanModal && (<div className="big-clean-overlay" onClick={() => { setShowBigCleanModal(false); setBigCleanStep(1); }}><div className="big-clean-modal" onClick={e => e.stopPropagation()}><div className="big-clean-icon">🧹</div>{bigCleanStep === 1 ? (<><h3>大扫除</h3><p className="big-clean-warning">喂，这个按钮可不是闹着玩的。</p><p>我会把你所有的书籍、回收站、设置、云端数据统统清理干净。</p><p className="big-clean-highlight">真的什么都不会给你留。</p><div className="big-clean-actions"><button className="big-clean-cancel" onClick={() => { setShowBigCleanModal(false); setBigCleanStep(1); }}>算了算了</button><button className="big-clean-confirm" onClick={() => setBigCleanStep(2)}>我想好了</button></div></>) : (<><h3>最后确认</h3><p className="big-clean-final">你确定？</p><p>扫完之后，这里就只剩下一本崭新的引导书了。</p><p className="big-clean-highlight">之前的东西，一个字都不会剩。</p><div className="big-clean-actions"><button className="big-clean-cancel" onClick={() => { setShowBigCleanModal(false); setBigCleanStep(1); }}>还是不了</button><button className="big-clean-danger" onClick={handleBigClean}>开始打扫</button></div></>)}</div></div>)}{toast.show && <div className="app-toast">{toast.message}</div>}{/* 样式已搬迁到 src/styles/index.css */}</div>);
}

  return (<div className="app main-view"><div className={`sidebar ${isSidebarOpen ? 'open' : ''}`}><div className="sidebar-header"><h2>{currentBook.title}</h2><button className="close-sidebar" onClick={() => setIsSidebarOpen(false)}>×</button></div><div className="sidebar-content">{currentBook.entries.map(e => <SidebarItem key={e.id} entry={e} onSelect={handleSidebarSelect} currentId={currentEntry?.id} expandedIds={expandedIds} onToggle={id => setExpandedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} />)}</div></div>{isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}<div className="main-content" onTouchStart={e => { touchStartX.current = e.touches[0].clientX; touchStartY.current = e.touches[0].clientY; }} onTouchEnd={e => { const dx = e.changedTouches[0].clientX - touchStartX.current; const dy = e.changedTouches[0].clientY - touchStartY.current; if (dx > 120 && Math.abs(dx) > Math.abs(dy) * 2) { if (currentEntry || navigationStack.length > 0) { handleBack(); } else { handleBackToShelf(); } } }}><header className="top-bar"><div className="top-left"><button className="icon-btn" onClick={() => setIsSidebarOpen(true)}>☰</button>{(currentEntry || navigationStack.length > 0) && <button className="icon-btn" onClick={handleBack}>←</button>}<button className="icon-btn" onClick={handleBackToShelf}>🏠</button></div><div className="breadcrumb">{isVisitingInBook && <span className="friend-view-badge">👤 {visitingProfile?.name}</span>}<span className="book-name">{currentBook.title}</span>{currentEntry && <><span className="separator">/</span><span className="current-title">{currentEntry.title}</span></>}</div><div className="top-right">{isVisitingInBook ? (<span className="readonly-indicator">只读</span>) : ((viewMode === 'single' || viewMode === 'merged') && (<div className="read-mode-toggle" onClick={() => { if (!isReadOnly) { const ed = document.querySelector('.rich-editor'); if (ed) ed.forceSave?.(); } else if (viewMode === 'merged' && liveEntry) { initMerged(liveEntry); } setIsReadOnly(!isReadOnly); }}><span className={`toggle-label ${isReadOnly ? 'active' : ''}`}>阅读</span><div className={`toggle-switch ${!isReadOnly ? 'edit-mode' : ''}`}><div className="toggle-knob" /></div><span className={`toggle-label ${!isReadOnly ? 'active' : ''}`}>编辑</span></div>))}</div></header>{!currentEntry && currentBook.showStats && (<div className="book-info-card" onClick={() => { if (!isVisitingInBook) { setEditingBook(currentBook); setShowBookModal(true); } }}><div className="info-cover">{currentBook.coverImage ? <img src={currentBook.coverImage} alt="" /> : <span>{currentBook.cover}</span>}</div><div className="info-details">{currentBook.author && <p>作者：{currentBook.author}</p>}{currentBook.tags?.length > 0 && <p>标签：{currentBook.tags.join('、')}</p>}<p>词条：{countEntries(currentBook.entries)}条</p><p>字数：{countWords(currentBook.entries).toLocaleString()}字</p></div>{!isVisitingInBook && <span className="info-edit-hint">点击编辑 ›</span>}</div>)}{!currentEntry && currentBook.gallery?.enabled && (<div className="gallery-preview-strip"><div className="gallery-preview-scroll">{currentBook.gallery.images?.filter(img => img.featured).map(img => (<div key={img.id} className="gallery-strip-item" onClick={() => openGalleryPreview(img)}><img src={img.src} alt="" /></div>))}{(!currentBook.gallery.images?.filter(img => img.featured).length) && !isVisitingInBook && (<div className="gallery-strip-empty" onClick={() => setShowGallery(true)}><span>+</span><p>添加展示图片</p></div>)}</div><button className="gallery-enter-btn" onClick={() => setShowGallery(true)}>进入画廊 ›</button></div>)}<main className={`content-area ${slideAnim}`}>{viewMode === 'list' && !isReorderMode && (<>{currentEntry && <div className="list-header"><h1>{currentEntry.title}</h1>{currentEntry.summary && <p className="summary">{currentEntry.summary}</p>}</div>}<p className="swipe-hint">{isVisitingInBook ? '💡 左滑合并视图 · 右滑返回' : '💡 左滑合并视图 · 右滑返回 · 长按编辑'}</p><div className="entry-list">{currentEntries.map(e => { let tx = 0; return (<div key={e.id} className="entry-card" onClick={() => handleEntryClick(e)} onTouchStart={ev => { tx = ev.touches[0].clientX; if (!isVisitingInBook) handleLongPressStart(ev, 'entry', e); }} onTouchMove={!isVisitingInBook ? handleLongPressEnd : undefined} onTouchEnd={ev => { if (!isVisitingInBook) handleLongPressEnd(); handleEntrySwipe(e, ev.changedTouches[0].clientX - tx); }}><div className="entry-icon">{e.characterMode ? '👤' : e.novelMode ? '📖' : e.timelineMode ? '📅' : e.isFolder ? '📁' : '📄'}</div><div className="entry-info"><h3>{e.title}{e.linkable && <span className="star-badge">⭐</span>}{e.novelMode && <span className="novel-badge">正文</span>}{e.characterMode && <span className="character-badge">人设</span>}{e.timelineMode && <span className="timeline-badge">时间轴</span>}</h3><p>{e.summary}</p></div><span className="entry-arrow">›</span></div>); })}</div>{currentEntries.length === 0 && <div className="empty-state"><span>✨</span><p>{isVisitingInBook ? '这里还没有内容' : '点击右下角添加'}</p></div>}</>)}{(viewMode === 'list' || viewMode === 'character') && isReorderMode && <ReorderList entries={currentEntries} onReorder={handleReorder} onExit={() => setIsReorderMode(false)} />}{viewMode === 'single' && liveEntry && (<div className="single-view"><div className="export-content" ref={exportRef}><div className="content-header">{effectiveReadOnly ? <h1>{liveEntry.title}</h1> : <input type="text" className="editable-title" defaultValue={liveEntry.title} onBlur={ev => handleTitleChange(liveEntry.id, liveEntry.title, ev.target.value)} key={currentEntry.id + '-title'} />}{effectiveReadOnly ? (liveEntry.summary && <p className="entry-summary">{liveEntry.summary}</p>) : <input type="text" className="editable-summary" defaultValue={liveEntry.summary || ''} placeholder="添加简介..." onBlur={ev => handleSummaryChange(liveEntry.id, ev.target.value)} key={currentEntry.id + '-summary'} />}</div><div onTouchStart={effectiveReadOnly ? handleContentLongPressStart : undefined} onTouchEnd={effectiveReadOnly ? handleContentLongPressEnd : undefined} onTouchMove={effectiveReadOnly ? handleContentLongPressEnd : undefined}>{effectiveReadOnly ? <ContentRenderer content={liveEntry.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} /> : <RichEditor key={currentEntry.id} content={liveEntry.content} onSave={html => saveContent(html)} fontFamily={currentFont} onImageClick={handleImageClick} onResetFormats={() => setActiveFormats({ bold: false, italic: false, underline: false, strike: false, size: 'medium' })} />}</div></div><div className="word-count">{countSingleEntryWords(liveEntry.content).toLocaleString()} 字</div></div>)}{viewMode === 'merged' && currentEntry && (<div className="merged-view">{effectiveReadOnly ? (<div ref={exportRef}><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-read" onTouchStart={handleContentLongPressStart} onTouchEnd={handleContentLongPressEnd} onTouchMove={handleContentLongPressEnd}>{liveChildContent.map((it, i, arr) => (<div key={it.id} className="merged-section"><div className="section-title">• {it.title}</div><ContentRenderer content={it.content} allTitlesMap={allTitlesMap} currentBookId={currentBook.id} onLinkClick={handleLinkClick} fontFamily={currentFont} />{i < arr.length - 1 && <div className="section-divider" />}</div>))}</div></div>) : (<><div className="content-header merged-header"><h1>{currentEntry.title}</h1><p className="merged-hint">📖 合并视图</p></div><div className="merged-content-edit">{mergedContents.map((it, i) => (<div key={it.id} className="merged-edit-section"><div className="merged-edit-header">• <input type="text" className="merged-title-input" defaultValue={it.title} onBlur={ev => handleMergedChange(i, 'title', ev.target.value)} key={it.id + '-title'} /></div><div className="merged-editor-wrap" contentEditable dangerouslySetInnerHTML={{ __html: it.content }} onBlur={ev => handleMergedChange(i, 'content', ev.target.innerHTML)} onPaste={ev => { ev.preventDefault(); const text = ev.clipboardData.getData('text/plain'); document.execCommand('insertText', false, text); }} style={{ fontFamily: currentFont }} /></div>))}<button className="add-merged-entry-btn" onClick={handleAddMerged}>+ 添加词条</button></div></>)}<div className="word-count">{liveChildContent.reduce((sum, it) => sum + countSingleEntryWords(it.content), 0).toLocaleString()} 字</div></div>)}{viewMode === 'character' && currentEntry && !isReorderMode && (<div className="character-view"><div className="character-header"><h1>{currentEntry.title}</h1><p className="character-hint">👤 人设模式 · {currentEntry.children?.length || 0} 位角色</p></div><div className="character-grid">{(currentEntry.children || []).map((char, idx) => (<CharacterCard key={char.id} entry={char} style={characterCardStyle} onClick={handleCharacterClick} onLongPress={!isVisitingInBook ? handleCharacterLongPress : undefined} index={idx} />))}{!isVisitingInBook && <AddCharacterCard style={characterCardStyle} onClick={() => { setEditingCharacter(null); setShowCharacterModal(true); }} />}</div>{currentEntry.children?.length === 0 && <div className="empty-state"><span>👤</span><p>还没有人设</p><p>点击「+」添加角色</p></div>}</div>)}{viewMode === 'timeline' && liveEntry && (<div className="timeline-mode-view"><div className="timeline-header"><h1>{liveEntry.title}</h1><p className="timeline-hint">📅 时间轴模式</p></div><TimelineView entry={liveEntry} onAddEvent={(yearId) => { setEditingEvent(null); setShowAddEventModal(true); }} onEditEvent={(event) => { setEditingEvent(event); setShowAddEventModal(true); }} onDeleteEvent={handleDeleteTimelineEvent} onAddYear={(eraId) => { setEditingYear(null); setShowAddYearModal(true); }} onEditYear={(year) => { setEditingYear(year); setShowAddYearModal(true); }} onDeleteYear={handleDeleteYear} onAddEra={() => { setEditingEra(null); setShowAddEraModal(true); }} onEditEra={(era) => { setEditingEra(era); setShowAddEraModal(true); }} onDeleteEra={handleDeleteEra} expandedYears={expandedYears} onToggleYear={handleToggleYear} allTitlesMap={allTitlesMap} onLinkClick={handleLinkClick} isReordering={isTimelineReordering} onReorderEvent={handleReorderEvent} /></div>)}{viewMode === 'novel' && liveEntry && (
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
)}</main>{viewMode === 'list' && !isReorderMode && !isVisitingInBook && (<><button className={`fab ${showAddMenu ? 'active' : ''}`} onClick={() => setShowAddMenu(!showAddMenu)}><span style={{ transform: showAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><AddMenu isOpen={showAddMenu} onClose={() => setShowAddMenu(false)} onAddEntry={() => { setEditingEntry(null); setIsCreatingFolder(false); setShowEntryModal(true); }} onAddFolder={() => { setEditingEntry(null); setIsCreatingFolder(true); setShowEntryModal(true); }} onReorder={() => setIsReorderMode(true)} onToggleGallery={toggleGallery} galleryEnabled={currentBook?.gallery?.enabled} /></>)}{viewMode === 'character' && !isVisitingInBook && (<><button className={`fab ${showCharacterAddMenu ? 'active' : ''}`} onClick={() => setShowCharacterAddMenu(!showCharacterAddMenu)}><span style={{ transform: showCharacterAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><CharacterAddMenu isOpen={showCharacterAddMenu} onClose={() => setShowCharacterAddMenu(false)} onAddCharacter={() => { setEditingCharacter(null); setShowCharacterModal(true); }} onOpenRelationNetwork={() => setShowRelationNetwork(true)} onReorder={() => setIsReorderMode(true)} /></>)}{viewMode === 'timeline' && !isVisitingInBook && (<><button className={`fab ${showTimelineAddMenu ? 'active' : ''}`} onClick={() => setShowTimelineAddMenu(!showTimelineAddMenu)}><span style={{ transform: showTimelineAddMenu ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}>+</span></button><TimelineAddMenu isOpen={showTimelineAddMenu} onClose={() => setShowTimelineAddMenu(false)} onAddEvent={() => { setEditingEvent(null); setShowAddEventModal(true); }} onAddYear={() => { setEditingYear(null); setShowAddYearModal(true); }} onAddEra={() => { setEditingEra(null); setShowAddEraModal(true); }} onReorder={() => setIsTimelineReordering(!isTimelineReordering)} isReordering={isTimelineReordering} /></>)}{isEditing && <EditorToolbar indentAll={handleIndent} onFormat={() => { saveSelection(); setShowFormatMenu(true); }} onAlign={() => { saveSelection(); setShowAlignMenu(true); }} onFont={() => { saveSelection(); setShowFontMenu(true); }} onImage={handleImageUpload} onBlock={() => { saveSelection(); setShowBlockMenu(true); }} hasActive={hasActiveFormat} />}<BlockMenu isOpen={showBlockMenu} onClose={() => { setShowBlockMenu(false); restoreSelection(); }} onBlock={handleBlock} /><TextFormatMenu isOpen={showFormatMenu} onClose={() => { setShowFormatMenu(false); }} activeFormats={activeFormats} onToggleFormat={handleToggleFormat} /><AlignMenu isOpen={showAlignMenu} onClose={() => { setShowAlignMenu(false); restoreSelection(); }} onAlign={handleAlign} /><FontMenu isOpen={showFontMenu} onClose={() => { setShowFontMenu(false); restoreSelection(); }} onSelectFont={setCurrentFont} currentFont={currentFont} /></div><EntryModal isOpen={showEntryModal} onClose={() => { setShowEntryModal(false); setEditingEntry(null); }} onSave={editingEntry ? handleUpdateEntry : handleAddEntry} editingEntry={editingEntry} parentTitle={currentEntry?.title} isFolder={isCreatingFolder} /><ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} onClose={() => setContextMenu({ ...contextMenu, isOpen: false })} options={contextMenu.options} /><MoveModal isOpen={showMoveModal} onClose={() => { setShowMoveModal(false); setMoveTarget(null); }} entry={moveTarget} entries={currentBook?.entries || []} currentParentId={currentEntry?.id || null} onMove={handleMoveEntry} /><ConfirmModal isOpen={confirmModal.isOpen} title={confirmModal.title} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ isOpen: false })} /><SpecialModeModal isOpen={showSpecialModeModal} onClose={() => { setShowSpecialModeModal(false); setSpecialModeTarget(null); }} entry={specialModeTarget} onSelectMode={handleSelectSpecialMode} />{showGallery && (<div className="gallery-page" onClick={e => e.stopPropagation()}><div className="gallery-header"><button className="gallery-back" onClick={() => { setShowGallery(false); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }}>←</button><h2>{currentBook?.title}</h2><button className="gallery-upload" onClick={() => galleryUploadRef.current?.click()}>+ 添加</button><input ref={galleryUploadRef} type="file" accept="image/*" multiple onChange={uploadGalleryImage} style={{ display: 'none' }} /></div><div className="gallery-grid">{currentBook?.gallery?.images?.map(img => (<div key={img.id} className="gallery-item" onTouchStart={(e) => { e.stopPropagation(); const touch = e.touches[0]; galleryLongPressTimer.current = setTimeout(() => { if (navigator.vibrate) navigator.vibrate(30); setGalleryContextMenu({ isOpen: true, image: img, position: { x: touch.clientX, y: touch.clientY } }); }, 500); }} onTouchEnd={(e) => { e.stopPropagation(); if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onTouchMove={(e) => { if (galleryLongPressTimer.current) { clearTimeout(galleryLongPressTimer.current); galleryLongPressTimer.current = null; } }} onClick={(e) => { e.stopPropagation(); if (!galleryContextMenu.isOpen) openGalleryPreview(img); }}><img src={img.src} alt="" draggable={false} />{img.featured && <span className="featured-star">★</span>}</div>))}{(!currentBook?.gallery?.images || currentBook.gallery.images.length === 0) && (<div className="gallery-empty"><span>🖼️</span><p>还没有图片</p><p>点击右上角添加</p></div>)}</div>{galleryContextMenu.isOpen && (<><div className="gallery-context-overlay" onClick={(e) => { e.stopPropagation(); setGalleryContextMenu({ isOpen: false, image: null, position: { x: 0, y: 0 } }); }} /><div className="context-menu" style={{ top: galleryContextMenu.position.y, left: Math.min(galleryContextMenu.position.x, window.innerWidth - 180) }}><div className="context-item" onClick={(e) => { e.stopPropagation(); toggleFeatured(galleryContextMenu.image.id); }}><span className="context-icon">{galleryContextMenu.image.featured ? '☆' : '★'}</span>{galleryContextMenu.image.featured ? '取消展示' : '展示'}</div><div className="context-item danger" onClick={(e) => { e.stopPropagation(); deleteGalleryImage(galleryContextMenu.image.id); }}><span className="context-icon">🗑️</span>删除图片</div></div></>)}{galleryConfirmModal.isOpen && (<div className="gallery-confirm-overlay" onClick={(e) => { e.stopPropagation(); setGalleryConfirmModal({ isOpen: false }); }}><div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}><h3>{galleryConfirmModal.title}</h3><p>{galleryConfirmModal.message}</p><div className="modal-actions"><button className="btn-cancel" onClick={() => setGalleryConfirmModal({ isOpen: false })}>取消</button><button className="btn-save" onClick={galleryConfirmModal.onConfirm}>确定</button></div></div></div>)}</div>)}{galleryPreviewImage && (<div className="gallery-viewer" onTouchStart={(e) => {
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
/><CharacterEditModal isOpen={showCharacterModal} onClose={() => { setShowCharacterModal(false); setEditingCharacter(null); }} onSave={editingCharacter ? handleUpdateCharacter : handleAddCharacter} editingEntry={editingCharacter} /><RelationNetworkPage isOpen={showRelationNetwork} onClose={() => setShowRelationNetwork(false)} entries={currentEntry?.children || []} relations={currentEntry?.characterRelations || []} onAddRelation={handleAddRelation} onDeleteRelation={handleDeleteRelation} onUpdateRelation={handleUpdateRelation} bookTitle={currentEntry?.title || ''} cardStyle={characterCardStyle} allTitlesMap={allTitlesMap} onLinkClick={handleLinkClick} /><AddEraModal isOpen={showAddEraModal} onClose={() => { setShowAddEraModal(false); setEditingEra(null); }} onSave={editingEra ? handleUpdateEra : handleAddEra} editingEra={editingEra} /><AddYearModal isOpen={showAddYearModal} onClose={() => { setShowAddYearModal(false); setEditingYear(null); }} onSave={editingYear ? handleUpdateYear : handleAddYear} editingYear={editingYear} eras={currentEntry?.timelineConfig?.eras || []} /><AddEventModal isOpen={showAddEventModal} onClose={() => { setShowAddEventModal(false); setEditingEvent(null); }} onSave={editingEvent ? handleUpdateTimelineEvent : handleAddTimelineEvent} editingEvent={editingEvent} eras={currentEntry?.timelineConfig?.eras || []} years={currentEntry?.timelineConfig?.years || []} allTitlesMap={allTitlesMap} />{characterDetailStack.map((item, index) => (<CharacterDetailPage key={item.entry.id} entry={item.entry} onClose={handleBack} onSave={handleSaveCharacterContent} isReadOnly={!!visitingBookshelf} cardStyle={characterCardStyle} allTitlesMap={allTitlesMap} onLinkClick={(kw, bookId, entryId) => { handleLinkClick(kw, bookId, entryId); }} bookName={currentBook?.title} closing={index === closingCharacterIndex} skipAnimation={item.animated} />))}{toast.show && <div className="app-toast">{toast.message}</div>}{/* 样式已搬迁到 src/styles/index.css */}</div>);
}


