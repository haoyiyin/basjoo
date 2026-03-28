/**
 * 将Markdown格式文本转换为纯文本
 * 去除Markdown格式符号，保留换行和基本结构
 */
export function sanitizePlainText(markdown: string): string {
  if (!markdown) return '';

  return markdown
    // 移除粗体 **text** 或 __text__
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    // 移除斜体 *text* 或 _text_
    .replace(/(?<!\w)\*(?!\*)(.*?)\*(?!\*)/g, '$1')
    .replace(/(?<!\w)_(?!_)(.*?)_(?!_)/g, '$1')
    // 移除删除线 ~~text~~
    .replace(/~~(.*?)~~/g, '$1')
    // 移除行内代码 `code`
    .replace(/`(.*?)`/g, '$1')
    // 移除代码块 ```code```
    .replace(/```[\s\S]*?```/g, '')
    // 移除标题标记 # text
    .replace(/^#{1,6}\s+/gm, '')
    // 移除无序列表标记 - 或 *
    .replace(/^[-*]\s+/gm, '• ')
    // 移除有序列表标记 1.
    .replace(/^\d+\.\s+/gm, '')
    // 移除链接 [text](url) 保留text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除图片 ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 移除引用 > text
    .replace(/^>\s+/gm, '')
    // 清理多余空格
    .replace(/\s{3,}/g, '  ')
    // 清理首尾空格
    .trim();
}

/**
 * 检测文本是否包含大量Markdown格式
 * 用于判断是否需要应用sanitizePlainText
 */
export function hasMarkdownFormatting(text: string): boolean {
  if (!text) return false;
  const markdownPatterns = [
    /\*\*.*\*\*/,  // 粗体
    /`.*`/,        // 代码
    /\[.*\]\(.*\)/ // 链接
  ];
  return markdownPatterns.some(pattern => pattern.test(text));
}
