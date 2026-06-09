import React from 'react';

const AddMenu = ({ isOpen, onClose, onAddEntry, onAddFolder, onReorder, onToggleGallery, galleryEnabled }) => isOpen ? (<><div className="add-menu-overlay" onClick={onClose} /><div className="add-menu"><div className="add-menu-item" onClick={() => { onAddFolder(); onClose(); }}><span>📁</span><span>新建分类</span></div><div className="add-menu-item" onClick={() => { onAddEntry(); onClose(); }}><span>📄</span><span>新建词条</span></div><div className="add-menu-item" onClick={() => { onReorder(); onClose(); }}><span>↕️</span><span>调整排序</span></div><div className="add-menu-item" onClick={() => { onToggleGallery(); onClose(); }}><span>🖼️</span><span>{galleryEnabled ? '关闭画廊' : '开启画廊'}</span></div></div></>) : null;

export default AddMenu;
