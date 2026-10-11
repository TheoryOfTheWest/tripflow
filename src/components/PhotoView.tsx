import { ImageOff } from 'lucide-react';
import type { Photo } from '../models';
import { usePhoto } from '../hooks/usePhoto';
export function PhotoView({
  photo,
  onClick,
  large = false,
}: {
  photo: Photo;
  onClick?: () => void;
  large?: boolean;
}) {
  const src = usePhoto(photo);
  return (
    <button
      type="button"
      className={`photo-thumb ${large ? 'photo-large' : ''}`}
      onClick={onClick}
      aria-label={`查看照片：${photo.caption || '旅行照片'}`}
    >
      {src ? (
        <img loading="lazy" src={src} alt={photo.caption || '旅行照片'} />
      ) : (
        <span>
          <ImageOff size={22} />
          {photo.missing ? '需 ZIP 恢复' : '照片不可用'}
        </span>
      )}
    </button>
  );
}
