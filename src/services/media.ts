export function validatePhotoFile(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('单张原图不能超过 20 MB');
}
export async function compressPhoto(file: File): Promise<Blob> {
  validatePhotoFile(file);
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 100000000) {
    bitmap.close();
    throw new Error('图片分辨率过大');
  }
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('浏览器不支持图片处理');
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Canvas re-encoding strips EXIF/GPS; never publish original metadata.
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      'image/jpeg',
      0.82
    )
  );
}
