import { test } from "node:test";
import assert from "node:assert/strict";
import { TAG_PALETTE, normalizeTag, tagColorMap, noteColor } from "../src/tagcolors.js";

test("normalizeTag strips the hash, lowercases, and keeps the top-level segment", () => {
  // Arrange / Act / Assert
  assert.equal(normalizeTag("#Project/Nebula"), "project");
  assert.equal(normalizeTag("idea"), "idea");
  assert.equal(normalizeTag("##double"), "double");
  assert.equal(normalizeTag("  Spaced  "), "spaced");
});

test("normalizeTag returns empty string for nullish input", () => {
  assert.equal(normalizeTag(null), "");
  assert.equal(normalizeTag(undefined), "");
});

test("tagColorMap ranks tags by note frequency, ties broken alphabetically", () => {
  const notes = [
    { tags: ["project", "idea"] },
    { tags: ["project"] },
    { tags: ["zeta"] },
    { tags: ["alpha"] },
  ];
  const map = tagColorMap(notes);
  // project appears in 2 notes, the rest in 1 -> project first, then alpha/idea/zeta alphabetically
  assert.deepEqual(map.order, ["project", "alpha", "idea", "zeta"]);
  assert.equal(map.colors.get("project"), TAG_PALETTE[0]);
  assert.equal(map.colors.get("alpha"), TAG_PALETTE[1]);
});

test("tagColorMap counts each tag once per note even if repeated or nested", () => {
  const notes = [{ tags: ["project/a", "project/b", "#project"] }];
  const map = tagColorMap(notes);
  assert.equal(map.counts.get("project"), 1);
  assert.deepEqual(map.order, ["project"]);
});

test("tagColorMap cycles the palette when tags exceed its length", () => {
  const notes = Array.from({ length: TAG_PALETTE.length + 1 }, (_, i) => ({ tags: [`t${String(i).padStart(2, "0")}`] }));
  const map = tagColorMap(notes);
  const last = map.order[TAG_PALETTE.length];
  assert.equal(map.colors.get(last), TAG_PALETTE[0]); // wrapped around
});

test("tagColorMap handles empty, null, and tagless input without throwing", () => {
  assert.deepEqual(tagColorMap([]).order, []);
  assert.deepEqual(tagColorMap(null).order, []);
  assert.deepEqual(tagColorMap([{}, { tags: [] }, { tags: [null, ""] }]).order, []);
});

test("noteColor returns the colour of the note's most common tag", () => {
  const notes = [
    { tags: ["project", "idea"] },
    { tags: ["project"] },
    { tags: ["project"] },
    { tags: ["idea"] },
  ];
  const map = tagColorMap(notes); // project (3) ranks above idea (2)
  // A note with both tags takes project's colour, as project outranks idea.
  assert.equal(noteColor({ tags: ["idea", "project"] }, map, "#000000"), map.colors.get("project"));
});

test("noteColor falls back to the accent for notes with no recognised tag", () => {
  const map = tagColorMap([{ tags: ["known"] }]);
  assert.equal(noteColor({ tags: ["unknown"] }, map, "#2cf27f"), "#2cf27f");
  assert.equal(noteColor({ tags: [] }, map, "#2cf27f"), "#2cf27f");
  assert.equal(noteColor({}, map, "#2cf27f"), "#2cf27f");
});
