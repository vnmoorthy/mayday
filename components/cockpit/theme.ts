// Class strings shared by the cockpit, install and flights screens. The page
// is a honey-yellow field with near-black type; the ".terminal" well is the
// one dark surface, and inside it text is pale wax (comb), never ink.

// Mono caption without a colour, for places where ".label" (always olive) is wrong.
export const CAP = "font-mono text-[11px] uppercase tracking-[0.16em]";
// Mono caption inside a dark terminal well.
export const TCAP = "font-mono text-[11px] uppercase tracking-[0.16em] text-comb/70";
// Thin scrollbar that stays visible on the dark well.
export const TSCROLL = "[scrollbar-width:thin] [scrollbar-color:var(--color-dim)_transparent]";
// Selection inside the dark well: pale on dark would vanish with the page default.
export const TSELECT = "selection:bg-comb! selection:text-ink!";
// Data colours light enough for the dark well.
export const PALE_RED = "text-[#ff9a8f]";
export const PALE_BLUE = "text-[#9cc0ff]";

export const CARD = "rounded-2xl border border-ink/15 bg-panel";
export const HEADLINE = "text-5xl font-extrabold! tracking-tight text-ink sm:text-6xl lg:text-7xl";
export const H2 = "font-bold! tracking-tight text-ink";
export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
export const INLINE_CODE = "rounded-md bg-ink/10 px-1.5 py-0.5 font-mono text-[0.85em] text-ink";
