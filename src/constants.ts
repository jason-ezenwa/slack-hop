import type { PreviewLimits } from './types.js';

// Cutting is only worth it when it hides more than `minHidden` characters; a smaller leftover is shown in full.
export const PREVIEW: PreviewLimits = { maxLines: 6, maxChars: 400, minHidden: 100 };
