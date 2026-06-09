import React from 'react';

const BlockMenu = ({ isOpen, onClose, onBlock }) => {
  if (!isOpen) return null;
  const items = [
    { label: '正文', cmd: 'heading', val: 'p', style: { fontSize: '1rem', fontWeight: 400, color: 'inherit' } },
    { label: '大标题', cmd: 'heading', val: 'h1', style: { fontSize: '1.5rem', fontWeight: 700 } },
    { label: '中标题', cmd: 'heading', val: 'h2', style: { fontSize: '1.25rem', fontWeight: 600 } },
    { label: '小标题', cmd: 'heading', val: 'h3', style: { fontSize: '1.05rem', fontWeight: 600 } },
    {
      label: '引用',
      cmd: 'blockquote',
      style: { borderLeft: '3px solid #aaa', paddingLeft: '10px', color: '#888', fontStyle: 'italic', fontSize: '0.95rem' }
    },
    {
      label: '• 无序列表',
      cmd: 'insertUnorderedList',
      style: { listStyleType: 'disc', paddingLeft: '1.2em', fontSize: '0.95rem' }
    },
    {
      label: '1. 有序列表',
      cmd: 'insertOrderedList',
      style: { listStyleType: 'decimal', paddingLeft: '1.2em', fontSize: '0.95rem' }
    },
  ];
  return (<>
    <div className="format-menu-overlay" onClick={onClose} />
    <div className="block-menu">
      {items.map(item => (
        <div
          key={item.label}
          className="block-menu-item"
          onMouseDown={(e) => { e.preventDefault(); onBlock(item.cmd, item.val); onClose(); }}
          style={item.style}
        >
          {item.label}
        </div>
      ))}
    </div>
  </>);
};

export default BlockMenu;
