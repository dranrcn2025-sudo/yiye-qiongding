import React, { useState, useRef, useEffect } from 'react';

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
// 时间轴+菜单
const TimelineAddMenu = ({ isOpen, onClose, onAddEvent, onAddYear, onAddEra, onReorder, isReordering }) => {
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
        <div className={`add-menu-item ${isReordering ? 'active' : ''}`} onClick={() => { onReorder(); onClose(); }}>
          <span className="menu-icon">↕️</span>
          <span>{isReordering ? '完成排序' : '调整顺序'}</span>
        </div>
      </div>
    </>
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
  isReordering,
  onReorderEvent
}) => {
  const config = entry.timelineConfig || { eras: [], years: [], events: [] };
  const eras = config.eras || [];
  const allYears = config.years || [];
  const events = config.events || [];
  
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

export { TimelineView, AddEraModal, AddYearModal, AddEventModal, TimelineAddMenu };
