import { generateId } from './treeOperations';

const parseTxtBook = (text, filename) => {
  const lines = text.split(/\r?\n/);
  const chapters = [];
  let currentChapter = null;

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
    bookmark: null
  };
};

export { parseTxtBook };
