const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

const collectAllLinkableTitles = (books) => {
  const m = new Map();
  const c = (es, bid, bt, parentIsCharacterMode = false, parentEntry = null) => es.forEach(e => {
    if (e.linkable || parentIsCharacterMode) {
      if (!m.has(e.title)) m.set(e.title, []);
      m.get(e.title).push({
        bookId: bid,
        bookTitle: bt,
        entry: e,
        isCharacter: parentIsCharacterMode,
        characterParent: parentIsCharacterMode ? parentEntry : null
      });
    }
    if (e.children?.length) c(e.children, bid, bt, e.characterMode || parentIsCharacterMode, e.characterMode ? e : parentEntry);
  });
  books.forEach(b => c(b.entries, b.id, b.title, false, null));
  return m;
};

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

export { generateId, collectAllLinkableTitles, findEntryPath, findEntryById, getAllChildContent, updateEntryInTree, addEntryToParent, deleteEntryFromTree, reorderEntriesInParent, countWords, countSingleEntryWords, countEntries };
