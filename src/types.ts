export type Env = Record<string, string | undefined>;

// `handle` is missing only when a user could not be looked up and all we have is their ID.
export type Person = { display: string; handle?: string };

export type PreviewLimits = { maxLines: number; maxChars: number; minHidden: number };
