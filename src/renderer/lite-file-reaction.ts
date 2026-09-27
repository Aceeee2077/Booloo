/** Short, local-only responses to a file dropped onto the pet. */
function liteFileReaction(paths: string[]): string {
  if (paths.length > 1) return liteT('lite.drop.multiple', { n: paths.length });
  const name = (paths[0] || '').split(/[\\/]/).pop() || '';
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'].includes(extension)) {
    return liteT('lite.drop.image');
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].includes(extension)) {
    return liteT('lite.drop.document');
  }
  if (['zip', '7z', 'rar', 'tar', 'gz'].includes(extension)) {
    return liteT('lite.drop.archive');
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(extension)) {
    return liteT('lite.drop.audio');
  }
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(extension)) {
    return liteT('lite.drop.video');
  }
  return liteT('lite.drop.other');
}
