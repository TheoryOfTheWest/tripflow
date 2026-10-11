import { useEffect, useState } from 'react';
import type { Photo } from '../models';
import { getPhotoBlob } from '../services/repository';
export function usePhoto(photo?: Photo) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true,
      url: string | undefined;
    setSrc(undefined);
    if (photo)
      getPhotoBlob(photo)
        .then((blob) => {
          if (live) {
            url = URL.createObjectURL(blob);
            setSrc(url);
          }
        })
        .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.storagePath, photo?.missing]);
  return src;
}
