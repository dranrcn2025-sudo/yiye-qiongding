import React, { useState, useRef, useEffect } from 'react';

const ContextMenu = ({ isOpen, position, onClose, options }) => {
  const [expandedSubmenu, setExpandedSubmenu] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) setExpandedSubmenu(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const baseMenuH = options.length * 50 + 20;
  const submenuH = expandedSubmenu !== null && options[expandedSubmenu]?.submenu
    ? options[expandedSubmenu].submenu.length * 44
    : 0;
  const totalH = baseMenuH + submenuH;

  const spaceBelow = window.innerHeight - position.y;
  const spaceAbove = position.y;

  let top;
  if (spaceBelow >= totalH) {
    top = position.y;
  } else if (spaceAbove >= totalH) {
    top = position.y - totalH;
  } else {
    top = Math.max(10, Math.min(position.y, window.innerHeight - totalH - 10));
  }

  return (
    <>
      <div className="context-overlay" onClick={onClose} />
      <div
        ref={menuRef}
        className="context-menu"
        style={{
          top,
          left: Math.min(position.x, window.innerWidth - 180),
          maxHeight: window.innerHeight - 20,
          overflowY: 'auto'
        }}
      >
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

export default ContextMenu;
