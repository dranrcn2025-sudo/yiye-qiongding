import React, { useRef } from 'react';

const EditorToolbar = ({ onFormat, onFont, onAlign, onImage, onBlock, hasActive, indentAll }) => {
  const imgRef = useRef(null);
  return (<div className="editor-toolbar-bottom">
    <button onClick={onBlock} title="段落样式">¶</button>
    <button onClick={onFormat} className={hasActive ? 'has-active' : ''} title="文字格式">A</button>
    <button onClick={onAlign} title="对齐">三</button>
    <button onClick={onFont} title="字体">T</button>
    <button onClick={indentAll} title="首行缩进">↵</button>
    <button onClick={() => imgRef.current?.click()} title="插入图片">🖼</button>
    <input ref={imgRef} type="file" accept="image/*" onChange={onImage} style={{ display: 'none' }} />
  </div>);
};

export default EditorToolbar;
