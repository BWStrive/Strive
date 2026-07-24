// Strive — Creeds, Catechisms & Confessions domain.
// Static texts from the Van Dixhoorn edition; per-document track (read/memorize) and section progress.
import { CREEDS } from './data/creeds.js';
import { state, save, recordStreakDay, todayKey } from './store.js';

const C = () => state.creeds;
function ensure() {
  if (!C().track) C().track = {};
  if (!C().progress) C().progress = {};
  if (!C().due) C().due = {};   // due[docId] = 'YYYY-MM-DD' (Phase 9.4)
  if (!C().dueBase) C().dueBase = {};   // dueBase[docId] = {date, rem} baseline for ahead/behind
  // Multiple documents can be "current" at once (like reading several books). currentList
  // is the source of truth; migrate the legacy single `current` id once, then leave it.
  if (!C().currentList) {
    if (C().current !== undefined) C().currentList = C().current ? [C().current] : [];
    else C().currentList = ['heidelberg'];
  }
  if (!C().track.heidelberg) C().track.heidelberg = 'memorize';
}

export const GROUPS = [['creeds', 'Creeds'], ['confessions', 'Confessions'], ['catechisms', 'Catechisms']];

export function docs() { ensure(); return CREEDS; }
export function getDoc(id) { ensure(); return CREEDS.find(d => d.id === id) || null; }

export function trackOf(id) { ensure(); return C().track[id] || null; }
export function setTrack(id, t) { ensure(); if (t) C().track[id] = t; else delete C().track[id]; save(); }

// All docs currently being read/memorized (order = the order they were added).
export function currentDocs() { ensure(); return C().currentList.map(id => getDoc(id)).filter(Boolean); }
export function currentDoc() { ensure(); return currentDocs()[0] || null; }   // legacy: first current
export function isCurrentDoc(id) { ensure(); return C().currentList.includes(id); }
export function toggleCurrentDoc(id) {
  ensure();
  const i = C().currentList.indexOf(id);
  if (i >= 0) C().currentList.splice(i, 1); else C().currentList.push(id);
  save();
}
export function setCurrentDoc(id) { ensure(); C().currentList = id ? [id] : []; save(); }   // legacy single-set

export function isDone(id, n) { ensure(); return !!(C().progress[id] && C().progress[id][n]); }

// Net sections/questions marked per local day (Phase 6 strip stats).
// History starts July 2026 — older marks were never timestamped.
//
// markLog is a RATE source only: "how many today / this week". Do NOT sum it for a
// lifetime total. It starts at July 18 2026 so it undercounts everything marked before
// then, and resets deliberately don't subtract from it, so it also drifts upward over
// time. For any all-time figure (Phase 11 XP, achievements, milestones) use
// lifetimeSectionsMarked() below, which derives from current progress state and is
// therefore always exact.
function crMarkBump(n) {
  if (!C().markLog) C().markLog = {};
  const dk = todayKey();
  C().markLog[dk] = (C().markLog[dk] || 0) + n;
}
export function sectionsMarked(fromKey, toKey) {
  const log = C().markLog || {};
  let n = 0;
  for (const dk of Object.keys(log)) if (dk >= fromKey && dk <= toKey) n += log[dk];
  return Math.max(0, n);
}

// All-time sections marked, derived from current progress rather than markLog, so it
// covers pre-July-2026 work and can never drift. Counts only sections that still exist
// in the document definitions, so a removed/renumbered section can't inflate the total.
export function lifetimeSectionsMarked() {
  ensure();
  return CREEDS.reduce((sum, d) => sum + d.sections.filter(s => isDone(d.id, s.n)).length, 0);
}

// Per-doc daily marks (Phase 9.4): net sections marked today for a document, so a creed
// pace nudge can read "done today" — markLog is global and can't. Additive/sync-safe.
function crDayBump(id, n) {
  if (!n) return;
  ensure();
  if (!C().dayMarks) C().dayMarks = {};
  const dk = todayKey();
  if (!C().dayMarks[dk]) C().dayMarks[dk] = {};
  C().dayMarks[dk][id] = (C().dayMarks[dk][id] || 0) + n;
}
export function sectionsMarkedToday(id, dk = todayKey()) {
  const dm = (C().dayMarks || {})[dk] || {};
  return Math.max(0, dm[id] || 0);
}

export function toggleSection(id, n) {
  ensure();
  if (!C().progress[id]) C().progress[id] = {};
  C().progress[id][n] = !C().progress[id][n];
  const d = C().progress[id][n] ? 1 : -1;
  crMarkBump(d);
  crDayBump(id, d);
  if (C().progress[id][n]) recordStreakDay('cr');
  save();
}

// Level per the rubric: % of the chosen document completed (memorized or read).
export function docStats(id) {
  const d = getDoc(id);
  if (!d) return { done: 0, total: 0, pct: 0, level: 0 };
  const total = d.sections.length;
  const done = d.sections.filter(s => isDone(id, s.n)).length;
  const pct = total ? Math.round(100 * done / total) : 0;
  return { done, total, pct, level: total ? Math.floor(100 * done / total) : 0 };
}

// ---- due dates on documents (Phase 9.4 targets engine) ----
// A finish-by date on a doc drives the self-adjusting sections/day pace.
export function docDueOf(id) { ensure(); return C().due[id] || null; }
export function dueBaseOf(id) { ensure(); return C().dueBase[id] || null; }
export function setDocDue(id, date) {
  ensure();
  if (date) { C().due[id] = date; C().dueBase[id] = { date: todayKey(), rem: sectionsLeft(id) }; }
  else { delete C().due[id]; delete C().dueBase[id]; }
  save();
}
export function sectionsLeft(id) { const s = docStats(id); return Math.max(0, s.total - s.done); }

export function sectionLabel(d, s) {
  if (s.label) return s.label;
  return d.group === 'creeds' && d.sections.length > 1 ? 'Paragraph ' + s.n : d.name;
}

// ---- practice tracking (never touches memorized status) ----
function PRC() { ensure(); if (!C().practice) C().practice = {}; return C().practice; }

export function logPractice(docId, n, mode, score) {
  if (!PRC()[docId]) PRC()[docId] = {};
  if (!PRC()[docId][n]) PRC()[docId][n] = [];
  const arr = PRC()[docId][n];
  arr.push({ ts: Date.now(), mode, score: Math.round(score) });
  if (arr.length > 20) arr.splice(0, arr.length - 20);   // keep a short history
  recordStreakDay('cr');
  save();
}

export function practiceHistory(docId, n) { return (PRC()[docId] && PRC()[docId][n]) || []; }

// Practice attempts between two instants (Phase 5 · Trends)
export function practiceCountBetween(fromTs, toTs = Date.now()) {
  let n = 0;
  Object.values(PRC()).forEach(doc => Object.values(doc || {}).forEach(arr => (arr || []).forEach(e => {
    if (e.ts >= fromTs && e.ts <= toTs) n++;
  })));
  return n;
}

// Mastery = average of the last 10 scored attempts (typer + flashcards; fade never scores).
export function mastery(docId, n) {
  const arr = practiceHistory(docId, n);
  if (!arr.length) return null;
  const last = arr.slice(-10);
  return Math.round(last.reduce((a, x) => a + x.score, 0) / last.length);
}

export function lastPracticeTs(docId, n) {
  const arr = practiceHistory(docId, n);
  return arr.length ? arr[arr.length - 1].ts : 0;
}
