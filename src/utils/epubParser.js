import { generateId } from './treeOperations';

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
    let filePath = opfDir + href;
    if (href.startsWith('/')) {
      filePath = href.substring(1);
    }

    const content = await zip.file(filePath)?.async('string');
    if (!content) continue;

    const doc = parser.parseFromString(content, 'text/html');
    const body = doc.body;
    if (!body) continue;

    let chapterTitle = doc.querySelector('h1, h2, h3')?.textContent?.trim();
    if (!chapterTitle) {
      chapterTitle = doc.querySelector('title')?.textContent?.trim();
    }
    if (!chapterTitle) {
      chapterTitle = `章节 ${chapters.length + 1}`;
    }

    body.querySelectorAll('script, style, link, meta').forEach(el => el.remove());

    let htmlContent = '';
    const paragraphs = [];

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
            // skip
          } else {
            extractParagraphs(node);
          }
        }
      });
    };

    extractParagraphs(body);

    paragraphs.forEach(p => {
      if (typeof p === 'object' && p.type === 'heading') {
        htmlContent += `<h3>${p.text}</h3>`;
      } else if (typeof p === 'string') {
        htmlContent += `<p>${p}</p>`;
      }
    });

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

export { parseEpubBook };
