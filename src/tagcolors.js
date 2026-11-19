// Tag colouring: map each note to a colour drawn from its tags, so the constellation reads as a map of topics.
// Pure logic only (no three.js, no Obsidian), so it can be unit-tested in plain Node.

// A qualitative palette: bright, distinct hues that stay legible against black under additive blending.
export const TAG_PALETTE = [
  "#ff6b6b", "#4dd2ff", "#ffd166", "#06d6a0", "#b388ff", "#ff9e6b",
  "#f78fb3", "#8ce99a", "#74c0fc", "#ffe066", "#63e6be", "#e599f7",
];

// Obsidian tags arrive as "#project/nebula", "#idea", etc. Colour by the top-level segment so
// "project/a" and "project/b" share one hue; drop the leading '#', lowercase, and trim.
export function normalizeTag(tag) {
  return String(tag == null ? "" : tag).replace(/^#+/, "").split("/")[0].trim().toLowerCase();
}

/**
 * Build a stable tag -> colour assignment from a set of notes.
 * Tags are ranked by how many notes carry them (ties broken alphabetically) so the most common
 * topics get the first, most distinct palette entries. Colours cycle if tags outnumber the palette.
 * @param {{tags?:string[]}[]} notes
 * @param {string[]} [palette]
 * @returns {{order:string[], colors:Map<string,string>, counts:Map<string,number>}}
 */
export function tagColorMap(notes, palette = TAG_PALETTE) {
  const counts = new Map();
  for (const note of notes || []) {
    const seen = new Set();
    for (const raw of (note && note.tags) || []) {
      const t = normalizeTag(raw);
      if (!t || seen.has(t)) continue; // count each tag once per note
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const order = [...counts.keys()].sort(
    (a, b) => counts.get(b) - counts.get(a) || (a < b ? -1 : a > b ? 1 : 0)
  );
  const colors = new Map();
  order.forEach((t, i) => colors.set(t, palette[i % palette.length]));
  return { order, colors, counts };
}

/**
 * The colour for one note: the hue of its highest-ranked (most common) tag, else the accent fallback.
 * @param {{tags?:string[]}} note
 * @param {{order:string[], colors:Map<string,string>}} map
 * @param {string} accent fallback colour for notes with no recognised tag
 * @returns {string}
 */
export function noteColor(note, map, accent) {
  let best = null, bestRank = Infinity;
  for (const raw of (note && note.tags) || []) {
    const t = normalizeTag(raw);
    if (!t || !map.colors.has(t)) continue;
    const rank = map.order.indexOf(t);
    if (rank >= 0 && rank < bestRank) { bestRank = rank; best = t; }
  }
  return best ? map.colors.get(best) : accent;
}
