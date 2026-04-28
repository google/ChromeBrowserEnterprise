/**
 * @file Tailwind class merging utility.
 *
 * Combines clsx (conditional classes) with tailwind-merge (deduplicates
 * conflicting Tailwind classes). Standard pattern from shadcn/ui.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
