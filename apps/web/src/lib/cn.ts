import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes condicionalmente e resolve conflitos do Tailwind (ex.: "w-full" + "w-auto" → "w-auto"). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
