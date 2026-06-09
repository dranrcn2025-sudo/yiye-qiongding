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

// 通用复制到剪贴板函数（兼容APP和Web）
const copyToClipboard = async (text) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.log('Clipboard API failed, trying fallback:', e);
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
    document.body.appendChild(textArea);

    if (navigator.userAgent.match(/ipad|ipod|iphone/i)) {
      textArea.contentEditable = 'true';
      textArea.readOnly = false;
      const range = document.createRange();
      range.selectNodeContents(textArea);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      textArea.setSelectionRange(0, 999999);
    } else {
      textArea.select();
    }

    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch (e) {
    console.error('execCommand copy failed:', e);
    return false;
  }
};

export { Filesystem, Directory, Share, loadCapacitor, isCapacitor, copyToClipboard };
