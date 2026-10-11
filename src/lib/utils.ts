import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const message = (e: unknown) => {
  if (e && typeof e === 'object' && 'issues' in e)
    return (e.issues as { message: string }[])
      .slice(0, 3)
      .map((i) => i.message)
      .join('；');
  return e instanceof Error ? e.message : '操作失败，请重试';
};
