// Strive — shell, navigation, screens
import { state, load, save, getStreak, exportAll, importData, todayKey, uid, addDaysKey, diffDaysKeys, weekStartKey, weekDays, activeToday, activityDays } from './store.js';
import * as SC from './scripture.js';
import * as PL from './planner.js';
import * as PW from './pathways.js';
import * as RD from './reading.js';
import * as CR from './creeds.js';
import * as FT from './fitness.js';
import * as RP from './readingplans.js';
import * as TG from './targets.js';
import { esvKey, setEsvKey, esvLoadCache, esvFetchChapter, esvChapterCached, bibleDoc, bibleMultiDoc } from './esv.js';
import { allBooks, bookIndex } from './data/bible.js';
import * as SY from './sync.js';
import * as VIS from './vision.js';

load();
SC.ensureKeys();

// ---------- tiny view framework ----------
const main = () => document.getElementById('main');
const stack = [];
let activeTab = 'home';

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function setHeader(title, { back = false, action = null } = {}) {
  document.getElementById('h-title').textContent = title;
  const b = document.getElementById('h-back');
  b.style.display = back ? 'block' : 'none';
  const a = document.getElementById('h-action');
  if (action) { a.style.display = 'block'; a.textContent = action.label; a.onclick = action.fn; }
  else { a.style.display = 'none'; }
}
function render(screen, pushToStack = true) {
  if (pushToStack) stack.push(screen);
  main().innerHTML = '';
  main().scrollTop = 0;
  screen();
}
function rerender() { const s = stack[stack.length - 1]; main().innerHTML = ''; s(); }
function goBack() {
  if (stack.length > 1) { stack.pop(); rerender(); }
}
function switchTab(tab) {
  activeTab = tab;
  stack.length = 0;
  document.querySelectorAll('nav.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render(TABS[tab]);
}
window._switchTab = switchTab;

// ---------- shared UI ----------
function checkRow(entry, onToggle, { sub = '', onDelete = null } = {}) {
  const el = h(`
    <div class="list-item" style="cursor:default">
      <div class="check ${entry.done ? 'on' : ''}">✓</div>
      <div class="grow">
        <div class="title" style="${entry.done ? 'opacity:.45;text-decoration:line-through' : ''}">${esc(entry.label)}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      </div>
      ${onDelete ? '<button class="h-action del" style="border:none;background:none;color:var(--danger);font-size:17px;cursor:pointer">✕</button>' : ''}
    </div>`);
  el.querySelector('.check').onclick = onToggle;
  if (onDelete) el.querySelector('.del').onclick = onDelete;
  return el;
}

function addRow(placeholder, onAdd) {
  const el = h(`
    <div class="row" style="margin-top:10px">
      <input class="grow" placeholder="${esc(placeholder)}" style="padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:15px;min-width:0">
      <button class="pill on" style="padding:11px 16px">Add</button>
    </div>`);
  const inp = el.querySelector('input'), btn = el.querySelector('button');
  inp.dataset.addrow = placeholder;
  const go = () => {
    const v = inp.value.trim(); if (!v) return;
    onAdd(v);
    // screens rerender on add — put the cursor straight back so the next entry can be typed immediately
    requestAnimationFrame(() => {
      const again = main().querySelector(`input[data-addrow="${placeholder.replace(/"/g, '\\"')}"]`);
      if (again) { again.focus(); }
    });
  };
  btn.onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  return el;
}

function celebrate(text) {
  const el = document.createElement('div');
  el.className = 'xp-pop';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}

// Complete a pathway's next step (from Today or the pathway itself),
// and auto-log timed whole-book / range reviews into the Scripture review tracker.
function completePathwayStep(p, secs = null, stepId = null) {
  const mBefore = PW.currentMilestone(p);
  const s = stepId ? PW.completeStep(p, stepId, secs) : PW.completeNext(p, secs);
  if (!s) return;
  let note = 'Step complete';
  if (mBefore && PW.milestoneComplete(mBefore)) { note = 'Milestone complete!'; celebrate('Milestone! 🎉'); }
  if (PW.isComplete(p)) { note = 'Pathway complete!'; celebrate('Pathway complete! 🏆'); }
  if (secs != null) {
    const mb = SC.matchBook(s.label);
    if (mb && (mb.kind === 'book' || mb.kind === 'range')) {
      SC.logReviewTime(mb.book.name, secs, { note: mb.note, scope: mb.scope });
      note += ' · logged to ' + mb.book.name + ' review times';
    }
  }
  toast(note);
}

function sectionTitle(t) {
  return h(`<h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin:16px 4px 8px">${esc(t)}</h3>`);
}

// ---------- Dashboard ----------

// ---- Daily verse (Phase 5 — Baruch's rotating header verse; Hebrews 4:11 charter member) ----
const DEFAULT_DAILY_VERSES = [
  'Hebrews 4:11', 'Genesis 1:1', 'Deuteronomy 6:4-5', 'Joshua 1:8-9', 'Psalms 1:1-2',
  'Psalms 19:14', 'Psalms 23:1', 'Psalms 27:1', 'Psalms 46:1', 'Psalms 119:11',
  'Psalms 119:105', 'Proverbs 3:5-6', 'Isaiah 26:3', 'Isaiah 40:31', 'Isaiah 41:10',
  'Lamentations 3:22-23', 'Micah 6:8', 'Matthew 6:33', 'Matthew 11:28-30', 'John 3:16',
  'John 14:6', 'Romans 5:8', 'Romans 8:1', 'Romans 8:28', 'Romans 12:1-2',
  '1 Corinthians 10:13', 'Galatians 2:20', 'Ephesians 2:8-9', 'Philippians 4:6-7', 'Philippians 4:13',
  'Colossians 3:23', '2 Timothy 3:16-17', 'Hebrews 4:12', 'Hebrews 11:1', 'Hebrews 12:1-2',
  'James 1:22', '1 Peter 5:6-7', '1 John 1:9'
];
function dailyVerseList() {
  if (!Array.isArray(state.settings.dailyVerses) || !state.settings.dailyVerses.length) {
    state.settings.dailyVerses = [...DEFAULT_DAILY_VERSES];
    save();
  }
  return state.settings.dailyVerses;
}
// "Hebrews 4:11" / "Romans 12:1-2" (single chapter) → {b, ch, from, to}
function parseVerseRef(ref) {
  const m = String(ref).trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[-–—]\s*(\d+))?$/);
  if (!m) return null;
  const name = m[1].trim().toLowerCase();
  const b = allBooks.find(x => x.name.toLowerCase() === name);
  if (!b) return null;
  const ch = Number(m[2]), from = Number(m[3]), to = m[4] ? Number(m[4]) : Number(m[3]);
  if (ch < 1 || ch > b.chapters || from > to || from < 1) return null;
  return { b, ch, from, to };
}
function dailyVerseCard() {
  const list = dailyVerseList();
  const idx = ((diffDaysKeys('2026-01-01', todayKey()) % list.length) + list.length) % list.length;
  const ref = list[idx];
  const p = parseVerseRef(ref);
  const el = h(`<div class="card" id="d-verse">
    <div id="dv-text" style="font-family:var(--serif-body);font-size:16.5px;line-height:1.55"></div>
    <div style="font-family:var(--serif-display);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-top:8px">${esc(ref)} · ESV</div>
  </div>`).firstElementChild;
  const textEl = el.querySelector('#dv-text');
  if (!p) { textEl.innerHTML = '<span class="muted" style="font-style:normal">Unrecognized reference — edit the daily verse list in Settings.</span>'; return el; }
  const show = entry => {
    const vv = [];
    for (let v = p.from; v <= p.to; v++) if (entry.verses[v]) vv.push(entry.verses[v]);
    if (vv.length) textEl.textContent = '“' + vv.join(' ') + '”';
    else textEl.innerHTML = '<span class="muted" style="font-style:normal">Verse text unavailable for this reference.</span>';
  };
  const tryFetch = async () => {
    textEl.innerHTML = '<span class="muted" style="font-style:normal">Fetching…</span>';
    try { show(await esvFetchChapter(p.b.name, p.ch)); el.style.cursor = ''; el.onclick = null; }
    catch (e) {
      textEl.innerHTML = '<span class="muted" style="font-style:normal">Could not fetch the verse — tap to retry.</span>';
      el.style.cursor = 'pointer';
      el.onclick = tryFetch;
    }
  };
  const cached = esvChapterCached(p.b.name, p.ch);
  if (cached) show(cached);
  else if (esvKey()) tryFetch();
  else textEl.innerHTML = '<span class="muted" style="font-style:normal">Add your free ESV API key in Settings to see the daily verse text.</span>';
  return el;
}

// ---- Check-in strip (Phase 5 · F3, revised Phase 6) — five stat chips, D = today, W = this week ----
function checkinStrip() {
  const today = todayKey(), wk = weekStartKey();
  const dayTs = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const ftCount = fromTs => FT.allLogs().filter(l => l.ts >= fromTs).length;
  const chips = [
    ['mem', 'Memorize', SC.versesMarked(today, today), SC.versesMarked(wk, today)],
    ['bible', 'Bible', RP.chaptersRead(today, today), RP.chaptersRead(wk, today)],
    ['creeds', 'Creeds', CR.sectionsMarked(today, today), CR.sectionsMarked(wk, today)],
    ['read', 'Reading', RD.pagesBetween(dayTs(today)), RD.pagesBetween(dayTs(wk))],
    ['fit', 'Fitness', ftCount(dayTs(today)), ftCount(dayTs(wk))]
  ];
  const el = h(`<div style="display:flex;gap:6px;margin-bottom:13px">
    ${chips.map(([k, label, d, w]) => `
      <div class="chk-chip" data-k="${k}" style="flex:1;min-width:0;cursor:pointer;text-align:center;padding:8px 2px 7px;border:1px solid ${d > 0 ? 'var(--gold)' : 'var(--line)'};border-radius:var(--radius);background:var(--card)">
        <div style="font-family:var(--serif-display);font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
        <div style="font-size:12.5px;margin-top:3px;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap">
          <span class="muted" style="font-size:9.5px">D</span> <b>${d}</b>
          <span class="muted" style="font-size:9.5px;margin-left:3px">W</span> <b>${w}</b>
        </div>
      </div>`).join('')}
  </div>`).firstElementChild;
  el.querySelectorAll('.chk-chip').forEach(c => c.onclick = () => {
    const k = c.dataset.k;
    if (k === 'mem') { const b = SC.currentBook(); render(b ? () => bookScreen(b) : scriptureHome); }
    if (k === 'bible') render(plansScreen);
    if (k === 'read') { const rb = RD.byStatus('reading')[0]; render(rb ? () => bookDetail(rb) : readingHome); }
    if (k === 'creeds') { const doc = CR.currentDoc(); render(doc ? () => creedDocScreen(doc) : creedsHome); }
    if (k === 'fit') render(fitnessHome);
  });
  return el;
}

// small brass-ring level radial (Phase 5 · D4) — plain numbers, arc only, never a fill
function ftRadial(label, level, domKey = null) {
  const r = 13, c = 2 * Math.PI * r;
  const pct = level === null ? 0 : Math.min(1, level / 99);
  return `<div${domKey ? ` data-dom="${domKey}"` : ''} style="text-align:center;flex:1;min-width:0${domKey ? ';cursor:pointer' : ''}">
    <svg width="34" height="34" viewBox="0 0 34 34" style="display:block;margin:0 auto">
      <circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--track)" stroke-width="2.5"/>
      ${level === null ? '' : `<circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--gold)" stroke-width="2.5"
        stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 17 17)"/>`}
      <text x="17" y="21" text-anchor="middle" style="font-family:var(--serif-display);font-size:10.5px;font-weight:700;fill:${level === null ? 'var(--text-3)' : 'var(--text)'}">${level === null ? '–' : level}</text>
    </svg>
    <div style="font-family:var(--serif-display);font-size:7px;letter-spacing:.06em;text-transform:uppercase;color:var(--text-2);font-weight:700;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</div>
  </div>`;
}

function levelRow(label, cx, color, cs = null, corpusKey = null) {
  // cs = plain corpus % memorized (review-status-independent) shown at right (Phase 4B)
  // corpusKey ('all'|'ot'|'nt') makes the row a clickable dashboard hub link to that corpus's books (7B.2)
  const pctTxt = cs ? (cs.pct > 0 && cs.pct < 10 ? cs.pct.toFixed(1) : Math.round(cs.pct)) + '%' : '';
  return `
    <div class="row" style="margin-bottom:10px${corpusKey ? ';cursor:pointer' : ''}"${corpusKey ? ` data-corpus="${corpusKey}"` : ''}>
      <div style="width:42px;height:42px;border-radius:50%;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0">${cx.level}</div>
      <div class="grow">
        <div style="font-weight:700;font-size:14px">${label}</div>
        <div class="muted" style="font-size:12px">${cx.xp.toLocaleString()} / ${cx.max.toLocaleString()} XP${cx.stale.length ? ` · <span style="color:var(--danger)">⚠ ${cx.stale.length} book${cx.stale.length > 1 ? 's' : ''} need review</span>` : ''}</div>
        <div class="progressbar" style="margin-top:5px"><div style="width:${cx.max ? cx.xp / cx.max * 100 : 0}%;background:${color}"></div></div>
      </div>
      ${cs ? `<div style="text-align:right;flex-shrink:0">
        <div class="big" style="font-size:19px;color:${color}">${pctTxt}</div>
        <div class="muted" style="font-size:10px">memorized</div>
      </div>` : ''}
    </div>`;
}

// SM2 — one project: big display · 2+ projects: compact list · 0 projects: section hidden
function currentItemInfo(it) {
  const b = allBooks.find(x => x.name === it.book);
  if (!b) return null;
  if (it.ch != null) {
    const c = SC.chapterStats(b, it.ch - 1);
    return { b, ch: it.ch, label: b.name + ' ' + it.ch, done: c.done, total: c.total, pct: c.total ? Math.round(c.done / c.total * 100) : 0, stale: false };
  }
  const st = SC.bookStats(b);
  return { b, ch: null, label: b.name, done: st.done, total: st.total, pct: st.pct, stale: SC.isStale(b) };
}

function currentBookSection() {
  const items = SC.currentItems();
  if (!items.length) return '';   // SM2: no placeholder text
  if (items.length === 1) {
    const inf = currentItemInfo(items[0]);
    if (!inf) return '';
    const next = inf.ch == null ? SC.nextChapter(inf.b) : null;
    const sub = inf.ch != null
      ? (inf.done === inf.total ? 'chapter complete! 🎉' : 'standalone chapter')
      : next ? 'working on chapter ' + (next.ci + 1) + ' (' + next.done + '/' + next.total + ')' : 'book complete! 🎉';
    const pi = TG.memPaceInfo(items[0]);
    const paceLine = pi ? `<div style="font-size:12px;font-weight:600;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? pi.remaining + ' verses due now' : pi.perDay + ' verses/day to ' + shortDate(items[0].due)}${pi.overdue ? '' : paceDeltaChip(pi.delta)}</div>` : '';
    return `<div id="d-current" style="cursor:pointer;border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
      <h3 style="margin-bottom:8px">Currently Memorizing</h3>
      <div class="row">
        <span class="badge ${inf.b.t}">${inf.b.t.toUpperCase()}</span>
        <div class="grow"><div style="font-size:17px;font-weight:700;">${esc(inf.label)}</div>
          <div class="muted" style="font-size:12px">${inf.done}/${inf.total} verses · ${sub}${inf.stale ? ' · <span style="color:var(--danger)">⚠ review needed</span>' : ''}</div>
          ${paceLine}
        </div>
        <div style="text-align:right;flex-shrink:0"><div class="big" style="color:var(--accent)">${inf.pct}%</div></div>
      </div>
      <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${inf.pct}%"></div></div>
    </div>`;
  }
  const rows = items.map((it, i) => {
    const inf = currentItemInfo(it);
    if (!inf) return '';
    return `<div class="d-cur-row" data-i="${i}" style="cursor:pointer;margin-bottom:9px">
      <div class="row">
        <span class="badge ${inf.b.t}">${inf.b.t.toUpperCase()}</span>
        <div class="grow" style="font-size:14px;font-weight:700">${esc(inf.label)}${inf.stale ? ' <span style="color:var(--danger);font-size:11px">⚠ review</span>' : ''}</div>
        <div style="font-weight:700;color:var(--accent);font-size:13px">${inf.pct}%</div>
      </div>
      <div class="progressbar" style="margin-top:4px"><div style="width:${inf.pct}%"></div></div>
    </div>`;
  }).join('');
  return `<div id="d-current" style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
    <h3 style="margin-bottom:8px">Currently Memorizing</h3>${rows}</div>`;
}

function dashboard() {
  setHeader('Strive');
  main().append(dailyVerseCard());
  main().append(checkinStrip());
  const g = SC.globalStats();
  const xot = SC.corpusXP('ot'), xnt = SC.corpusXP('nt'), xall = SC.corpusXP(null);
  const streak = getStreak();
  const rdReading = RD.byStatus('reading');
  const lib = RD.libraryLevel();
  const life = RD.lifetime();
  const activePaths = PW.all().filter(p => PW.nextStep(p));
  main().append(h(`
    <div class="card" id="d-pathways" style="cursor:pointer">
      <h3>Pathways</h3>
      ${activePaths.length ? activePaths.slice(0, 3).map(p => {
        const pst = PW.stats(p);
        const nx = PW.nextStep(p);
        return `<div class="row" style="margin-bottom:6px">
          <div class="grow" style="font-size:13px;font-weight:600">${esc(p.name)}
            <span class="muted" style="font-weight:400">· next: ${esc(nx.label)}</span></div>
          <div style="font-weight:700;color:var(--accent);font-size:13px">${pst.pct}%</div>
        </div>
        <div class="progressbar" style="margin-bottom:8px"><div style="width:${pst.pct}%"></div></div>`;
      }).join('') + '<div class="row"><span class="chev" style="margin-left:auto">›</span></div>'
      : '<div class="row"><div class="grow muted">No active pathways — create one to always know your next stone.</div><span class="chev">›</span></div>'}
    </div>
    <div class="card">
      <h3><span id="d-sc-title" style="cursor:pointer">Scripture</span> <span id="d-sc-practice" title="Practice" style="cursor:pointer;color:var(--accent);font-weight:400">◎</span></h3>
      <div class="row" style="margin-bottom:12px">
        <div class="grow">
          <div class="big">${g.done.toLocaleString()}</div>
          <div class="muted">verses memorized</div>
        </div>
        <div style="text-align:right">
          <div class="big" style="color:var(--gold)">${streak}</div>
          <div class="muted">day streak</div>
          <div class="muted" style="font-size:11px">${weekDays('sm')} of 7 this week</div>
        </div>
      </div>
      ${levelRow('Whole Bible', xall, 'var(--gold)', SC.corpusStats(null), 'all')}
      ${levelRow('Old Testament', xot, 'var(--ot)', SC.corpusStats('ot'), 'ot')}
      ${levelRow('New Testament', xnt, 'var(--nt)', SC.corpusStats('nt'), 'nt')}
      <div class="statgrid" style="margin-top:8px">
        <div class="stat" id="d-sc-books" style="cursor:pointer"><div class="v">${g.booksComplete}</div><div class="l">Books complete</div></div>
        <div class="stat"><div class="v">${g.chaptersComplete}</div><div class="l">Chapters complete</div></div>
      </div>
      ${currentBookSection()}
    </div>
    <div class="card" id="d-plans" style="cursor:pointer">
      <h3>Scripture Reading</h3>
      ${RP.plans().length ? RP.plans().slice(0, 3).map(p => {
        const pst = RP.planStats(p);
        const pdone = RP.isDoneToday(p);
        const rest = !pdone && !RP.isReadingDay(p);
        return `<div class="row" style="margin-bottom:6px">
          <div class="grow" style="font-size:13px;font-weight:600">${esc(p.name)}
            <span class="muted" style="font-weight:400">· ${pst.complete ? 'complete 🎉' : rest ? 'rest day' : esc(RP.portionRef(p)) + (pdone ? ' ✓' : '')}</span></div>
          <div style="font-weight:700;color:var(--accent);font-size:13px">${pst.pct}%</div>
        </div>
        <div class="progressbar" style="margin-bottom:8px"><div style="width:${pst.pct}%"></div></div>`;
      }).join('') : '<div class="row"><div class="grow muted">No reading plans yet — whole Bible, a testament, or any set of books.</div><span class="chev">›</span></div>'}
    </div>`));
  main().append(h(`
    <div class="card" id="d-creeds" style="cursor:pointer">
      <h3><span id="d-cr-title" style="cursor:pointer">Creeds, Catechisms &amp; Confessions</span> <span id="d-cr-practice" title="Practice" style="cursor:pointer;color:var(--accent);font-weight:400">◎</span></h3>
      ${(() => {
        const docs = CR.currentDocs();
        if (!docs.length) return '<div class="muted">Choose a document to read or memorize.</div>';
        const unitOf = d => d.group === 'catechisms' ? 'Q&As' : 'sections';
        if (docs.length === 1) {
          const d = docs[0], st = CR.docStats(d.id), tr = CR.trackOf(d.id);
          return `<div class="d-cr-row" data-cid="${d.id}" style="cursor:pointer"><div class="row">
            <div style="width:42px;height:42px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0">${st.level}</div>
            <div class="grow">
              <div style="font-weight:700;font-size:14px">${esc(d.name)}</div>
              <div class="muted" style="font-size:12px">${tr === 'memorize' ? 'memorizing' : tr === 'read' ? 'reading' : ''} · ${st.done}/${st.total} ${unitOf(d)} · ${st.pct}%</div>
              <div class="progressbar" style="margin-top:5px"><div style="width:${st.pct}%"></div></div>
              <div class="muted" style="font-size:11px;margin-top:4px">${getStreak('cr')} day streak · ${weekDays('cr')} of 7 this week</div>
              ${(() => { const pi = TG.creedPaceInfo(d.id); return pi ? `<div style="font-size:12px;font-weight:600;margin-top:4px;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? pi.remaining + ' ' + unitOf(d) + ' due now' : pi.perDay + ' ' + unitOf(d) + '/day to ' + shortDate(CR.docDueOf(d.id))}${pi.overdue ? '' : paceDeltaChip(pi.delta)}</div>` : ''; })()}
            </div>
            <span class="chev">›</span>
          </div></div>`;
        }
        // 2+ current docs — compact rows, like Currently Memorizing (SM2)
        return docs.map(d => {
          const st = CR.docStats(d.id), tr = CR.trackOf(d.id);
          const pi = TG.creedPaceInfo(d.id);
          return `<div class="d-cr-row" data-cid="${d.id}" style="cursor:pointer;margin-bottom:9px">
            <div class="row">
              <span class="badge" style="background:${tr === 'memorize' ? 'var(--gold)' : 'var(--accent)'}">${tr === 'memorize' ? 'MEM' : tr === 'read' ? 'READ' : '—'}</span>
              <div class="grow" style="font-size:14px;font-weight:700">${esc(d.name)}</div>
              <div style="font-weight:700;color:var(--accent);font-size:13px">${st.pct}%</div>
            </div>
            ${pi ? `<div style="font-size:11px;font-weight:600;margin-top:2px;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? pi.remaining + ' ' + unitOf(d) + ' due now' : pi.perDay + ' ' + unitOf(d) + '/day to ' + shortDate(CR.docDueOf(d.id))}</div>` : ''}
            <div class="progressbar" style="margin-top:4px"><div style="width:${st.pct}%"></div></div>
          </div>`;
        }).join('');
      })()}
    </div>
    <div class="card" id="d-reading" style="cursor:pointer">
      <h3>Reading</h3>
      <div class="row" style="margin-bottom:10px">
        <div class="grow muted" style="font-size:12px">${(() => {
          const dayTs = k => { const [y, m, dd] = k.split('-').map(Number); return new Date(y, m - 1, dd).getTime(); };
          return RD.pagesBetween(dayTs(todayKey())) + ' pages today · ' + RD.pagesBetween(dayTs(weekStartKey())) + ' this week';
        })()}</div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:700;color:var(--gold);font-size:14px">${getStreak('rd')}</div>
          <div class="muted" style="font-size:10px">day streak</div>
        </div>
      </div>
      ${rdReading.length ? rdReading.map(b => {
        const est = RD.estimate(b);
        return `<div class="d-read-row" data-bid="${b.id}" style="margin-bottom:10px">
          <div class="row"><div class="grow" style="font-weight:700;font-size:14px">${esc(b.title)}</div>
          <div style="font-weight:700;color:var(--accent)">${RD.pct(b)}%</div></div>
          <div class="muted" style="font-size:12px">p. ${b.currentPage || 0} of ${b.pages || '?'}${est ? ' · ~' + est.days + ' days left (' + est.finish.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ')' : ''}</div>
          ${(() => { const pi = TG.readPaceInfo(b); return pi ? `<div style="font-size:12px;font-weight:600;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? pi.remaining + ' pages due now' : '~' + pi.perDay + '/day to ' + shortDate(b.due)}${!pi.overdue && pi.done ? ' ✓' : ''}${pi.overdue ? '' : paceDeltaChip(pi.delta)}</div>` : ''; })()}
          <div class="progressbar" style="margin-top:5px"><div style="width:${RD.pct(b)}%"></div></div>
        </div>`;
      }).join('') : '<div class="muted" style="margin-bottom:8px">Nothing being read right now.</div>'}
      <div class="row" style="gap:14px">
        <div><span style="font-weight:700">${lib.level}</span> <span class="muted" style="font-size:12px">library level</span></div>
        <div><span style="font-weight:700">${life.booksFinished}</span> <span class="muted" style="font-size:12px">books finished</span></div>
        <div><span style="font-weight:700">${life.pagesRead.toLocaleString()}</span> <span class="muted" style="font-size:12px">pages read</span></div>
      </div>
    </div>
    <div class="card" id="d-fitness" style="cursor:pointer">
      <h3>Fitness</h3>
      ${(() => {
        const fs = FT.ftStats();
        const lw = FT.latestWeight();
        const lastW = fs.lastLog ? FT.getWorkout(fs.lastLog.wid) : null;
        const now = new Date();
        const thisMonth = FT.allLogs().filter(l => { const d2 = new Date(l.ts); return d2.getFullYear() === now.getFullYear() && d2.getMonth() === now.getMonth(); }).length;
        const asm = FT.assessment().live;
        return `<div class="row">
          <div class="grow">
            ${lastW ? `<div style="font-weight:700;font-size:14px">${esc(lastW.name)}</div>
            <div class="muted" style="font-size:12px">${esc(fs.lastLog.result)} · ${new Date(fs.lastLog.ts).toLocaleDateString()}</div>` : '<div class="muted">No workouts logged yet.</div>'}
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${asm.overall !== null ? `<div style="font-family:var(--serif-display);font-weight:700;font-size:15px">${asm.overall}</div><div class="muted" style="font-size:10px">level</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${lw ? `<div style="font-weight:700">${lw.lbs} lbs</div><div class="muted" style="font-size:11px">weight</div>` : ''}
          </div>
          <span class="chev">›</span>
        </div>
        <div style="display:flex;gap:2px;margin-top:10px">${FT.ASSESS_DOMAINS.map(([dk2, dl]) => {
          const dom = asm.domains[dk2];
          return ftRadial(dl, dom && dom.unlocked ? dom.level : null, dk2);
        }).join('')}</div>
        ${(() => {
          const oz = FT.waterForDay(), sl = FT.lastNightSleep(), mt = FT.macroTotals();
          const bits = [`${oz} oz water`, `${sl ? fmtDur(sl.mins) : '—'} sleep`, (mt.p || mt.c || mt.f) ? `${mt.p}P ${mt.c}C ${mt.f}F · ${mt.cal} kcal` : 'no meals yet'];
          return `<div class="muted" style="font-size:12px;margin-top:8px">${bits.join(' · ')}</div>`;
        })()}
        <div class="pillrow" id="d-ft-quick" style="margin-top:8px">
          <button class="pill" data-ql="workout">＋ Workout</button>
          <button class="pill" data-ql="water">＋ Water</button>
          <button class="pill" data-ql="meal">＋ Meal</button>
          <button class="pill" data-ql="sleep">＋ Sleep</button>
          <button class="pill" data-ql="weight">＋ Weight</button>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">${fs.totalLogs} logged · ${thisMonth} this month · ${fs.thisYear} this year</div>`;
      })()}
    </div>
    <div class="card" id="d-trends" style="cursor:pointer">
      <div class="row"><h3 style="border:none;margin:0;padding:0">Trends</h3>
      <div class="grow muted" style="font-size:12px;text-align:right;margin-right:4px">8 weeks · week over week</div>
      <span class="chev">›</span></div>
    </div>
  `));
  main().querySelector('#d-trends').onclick = () => render(trendsScreen);
  main().querySelector('#d-fitness').onclick = () => { ftMode = 'level'; render(fitnessHome); };   // 7B.1 title→home resets to Level
  { // 7B.2 dashboard-as-hub — Scripture card clickable targets
    const scT = main().querySelector('#d-sc-title'); if (scT) scT.onclick = () => render(scriptureHome);
    main().querySelectorAll('[data-corpus]').forEach(r => r.onclick = () => { const k = r.dataset.corpus; render(() => corpusBooks(k === 'all' ? null : k)); });
    const scB = main().querySelector('#d-sc-books'); if (scB) scB.onclick = () => render(booksCompleteScreen);
    const scP = main().querySelector('#d-sc-practice'); if (scP) scP.onclick = e => { e.stopPropagation(); render(practiceScriptureLauncher); };
    const crP = main().querySelector('#d-cr-practice'); if (crP) crP.onclick = e => { e.stopPropagation(); render(practiceCreedsLauncher); };
    main().querySelectorAll('#d-fitness [data-dom]').forEach(r => r.onclick = e => { e.stopPropagation(); ftDomainView = 'lib'; render(() => ftDomainScreen(r.dataset.dom)); });
  }
  const ftq = main().querySelector('#d-ft-quick');
  if (ftq) {
    ftq.onclick = e => e.stopPropagation();
    const openFt = m => { ftMode = m; render(fitnessHome); };
    ftq.querySelector('[data-ql=workout]').onclick = e => { e.stopPropagation(); render(workoutPicker); };
    ftq.querySelector('[data-ql=water]').onclick = e => { e.stopPropagation(); openFt('water'); };
    ftq.querySelector('[data-ql=meal]').onclick = e => { e.stopPropagation(); openFt('diet'); };
    ftq.querySelector('[data-ql=sleep]').onclick = e => { e.stopPropagation(); openFt('sleep'); };
    ftq.querySelector('[data-ql=weight]').onclick = e => { e.stopPropagation(); openFt('weight'); };
  }
  // 7B.2 / D-P — the Creeds card and its title go to the master list (home); each current
  // document row deep-links to that document.
  main().querySelector('#d-creeds').onclick = () => render(creedsHome);
  const crT = main().querySelector('#d-cr-title'); if (crT) crT.onclick = e => { e.stopPropagation(); render(creedsHome); };
  main().querySelectorAll('#d-creeds .d-cr-row').forEach(r => r.onclick = e => {
    e.stopPropagation();
    const d = CR.getDoc(r.dataset.cid);
    if (d) render(() => creedDocScreen(d));
  });
  main().querySelector('#d-reading').onclick = () => render(readingHome);
  // Phase 6 bug fix — a currently-reading row opens that book's detail, not the general tab
  main().querySelectorAll('.d-read-row').forEach(r => r.onclick = e => {
    e.stopPropagation();
    const b = RD.get(r.dataset.bid);
    if (b) render(() => bookDetail(b));
  });
  main().querySelector('#d-pathways').onclick = () => render(pathwaysHome);
  main().querySelector('#d-plans').onclick = () => render(plansScreen);
  const dcur = main().querySelector('#d-current');   // absent when no projects (SM2)
  if (dcur) {
    const items = SC.currentItems();
    const open = it => {
      const b = allBooks.find(x => x.name === it.book);
      if (!b) return;
      render(it.ch != null ? () => chapterScreen(b, it.ch - 1) : () => bookScreen(b));
    };
    const rows = dcur.querySelectorAll('.d-cur-row');
    if (rows.length) rows.forEach(r => r.onclick = () => open(items[Number(r.dataset.i)]));
    else dcur.onclick = () => { if (items.length) open(items[0]); };
  }
}

// ---------- Trends (Phase 5 · F5) ----------
function trendsScreen() {
  setHeader('Trends', { back: true });
  const wrap = document.createElement('div');

  if (!Object.keys(state.activity).length) {
    wrap.append(h(`<div class="empty">Nothing logged yet — trends appear once you start recording reviews, pages, practice, or workouts.</div>`));
    main().append(wrap);
    return;
  }

  const thisWk = weekStartKey();
  const dayTs = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  // ---- 8-week activity: days active per domain per week ----
  wrap.append(sectionTitle('Active days — last 8 weeks'));
  const weeks = Array.from({ length: 8 }, (_, i) => addDaysKey(thisWk, -7 * (7 - i)));   // oldest → this week
  const doms = [['sm', 'Scripture'], ['rd', 'Reading'], ['cr', 'Creeds'], ['ft', 'Fitness']];
  const actCard = document.createElement('div');
  actCard.className = 'card';
  doms.forEach(([d, label]) => {
    const counts = weeks.map(wk => {
      const end = wk === thisWk ? todayKey() : addDaysKey(wk, 6);
      return activityDays(d, wk, end);
    });
    actCard.append(h(`<div class="row" style="margin-bottom:9px">
      <div style="width:74px;font-family:var(--serif-display);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)">${label}</div>
      <div class="grow" style="display:flex;gap:4px;align-items:flex-end;height:26px">
        ${counts.map((n, i) => `<div style="flex:1;background:${i === 7 ? 'var(--gold)' : 'var(--track)'};height:${n ? Math.max(3, Math.round(n / 7 * 26)) : 1}px" title="${n} day${n === 1 ? '' : 's'}"></div>`).join('')}
      </div>
      <div style="width:34px;text-align:right;font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${counts[7]}<span class="muted" style="font-weight:400">/7</span></div>
    </div>`));
  });
  actCard.append(h(`<div class="muted" style="font-size:11px">Bars show days active per week (Sun–Sat) · brass = this week.</div>`));
  wrap.append(actCard);

  // ---- week over week ----
  wrap.append(sectionTitle('This week vs last'));
  const t0 = dayTs(thisWk), tPrev = dayTs(addDaysKey(thisWk, -7));
  const rvNow = SC.reviewSecsBetween(t0), rvPrev = SC.reviewSecsBetween(tPrev, t0 - 1);
  const pgNow = RD.pagesBetween(t0), pgPrev = RD.pagesBetween(tPrev, t0 - 1);
  const prNow = CR.practiceCountBetween(t0), prPrev = CR.practiceCountBetween(tPrev, t0 - 1);
  const ftNow = FT.allLogs().filter(l => l.ts >= t0).length;
  const ftPrev = FT.allLogs().filter(l => l.ts >= tPrev && l.ts < t0).length;
  const delta = (a, b) => a === b ? '<span class="muted">—</span>'
    : a > b ? `<span style="color:var(--forest);font-weight:700">+${a - b}</span>`
    : `<span style="color:var(--danger);font-weight:700">−${b - a}</span>`;
  const wow = h(`<div class="card">
    ${[
      ['Review sessions', rvNow.count, rvPrev.count, rvNow.secs ? SC.fmtSecs(rvNow.secs) + ' this week' : ''],
      ['Pages read', pgNow, pgPrev, ''],
      ['Practice attempts', prNow, prPrev, ''],
      ['Workouts', ftNow, ftPrev, '']
    ].map(([label, a, b, sub]) => `<div class="row" style="margin-bottom:8px">
      <div class="grow"><div style="font-weight:600;font-size:14px">${label}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ''}</div>
      <div style="text-align:right"><span style="font-weight:700;font-size:15px;font-variant-numeric:tabular-nums">${a}</span>
      <span class="muted" style="font-size:12px"> vs ${b}</span> ${delta(a, b)}</div>
    </div>`).join('')}
    <div class="muted" style="font-size:11px">Weeks run Sunday–Saturday · this week is still in progress.</div>
  </div>`);
  wrap.append(wow);

  main().append(wrap);
}
// ---------- Today ----------
function today() {
  setHeader('Today · ' + PL.fmtDate(todayKey()), { action: { label: 'Planner', fn: () => switchTab('plan') } });
  renderDayChecklist(main(), todayKey(), { showPathways: true });
}

// open the screen behind a due-date pace nudge (9.4)
function navPace(g) {
  if (!g) return;
  if (g.t === 'book') { const bk = RD.get(g.id); if (bk) render(() => bookDetail(bk)); }
  else if (g.t === 'creed') { const d = CR.getDoc(g.id); if (d) render(() => creedDocScreen(d)); }
  else if (g.t === 'mem') { const b = allBooks.find(x => x.name === g.book); if (b) render(() => g.ch == null ? bookScreen(b) : chapterScreen(b, g.ch - 1)); }
}

// green/red schedule-position dot (9.4). null → nothing; 0 → on pace; ± → days ahead/behind.
function paceDeltaChip(delta) {
  if (delta == null) return '';
  if (delta === 0) return ` <span style="color:var(--text-2);font-size:11px">● on pace</span>`;
  const n = Math.abs(delta), ahead = delta > 0;
  return ` <span style="color:${ahead ? 'var(--forest)' : 'var(--danger)'};font-size:11px;font-weight:600">● ${n} day${n === 1 ? '' : 's'} ${ahead ? 'ahead' : 'behind'}</span>`;
}

// reusable "Finish by" date card with a live pace readout (9.4).
// onSet receives the new date string or null; info is a dayPlan result (or null).
function dueControl({ label, hint, value, onSet, info, unit }) {
  const FIN = 'padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px';
  const readout = info
    ? `<div style="font-size:12px;font-weight:600;margin-top:8px;${info.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${info.overdue ? 'Overdue — ' + info.remaining + ' ' + unit + ' left, due now' : info.perDay + ' ' + unit + '/day to stay on pace'}${info.overdue ? '' : paceDeltaChip(info.delta)}</div>`
    : `<div class="muted" style="font-size:12px;margin-top:8px">${esc(hint || 'Set a date for a self-adjusting daily pace — shows in Today, Week & Month.')}</div>`;
  const card = h(`<div class="card"><h3>${esc(label)}</h3>
    <div class="row">
      <input data-a="due" type="date" value="${value || ''}" style="flex:1;min-width:0;${FIN}">
      <button class="pill" data-a="clr" style="padding:9px 12px;${value ? '' : 'display:none'}">Clear</button>
    </div>${readout}
  </div>`).firstElementChild;
  card.querySelector('[data-a=due]').onchange = e => onSet(e.target.value || null);
  card.querySelector('[data-a=clr]').onclick = () => onSet(null);
  return card;
}

function renderDayChecklist(container, dk, { showPathways = false } = {}) {
  const wrap = document.createElement('div');
  const items = PL.itemsForDate(dk);

  if (items.length) wrap.append(sectionTitle('Planned'));
  items.forEach(entry => {
    // a scheduled step on a timed (Scripture Review) pathway → offer the ⏱ inline, like the next-steps list
    if (entry.kind === 'pstep' && entry.timed && !entry.done) {
      const p = PW.all().find(x => x.id === entry.pid);
      const el = h(`
        <div class="list-item" style="cursor:default">
          <div class="check">✓</div>
          <div class="grow">
            <div class="title">${esc(entry.label)}</div>
            <div class="sub">${esc(entry.domain)}</div>
          </div>
          <button class="pill" data-a="t" style="padding:7px 11px;font-size:15px">⏱</button>
        </div>`);
      el.querySelector('.check').onclick = () => { PL.toggle(dk, entry); rerender(); };
      el.querySelector('[data-a=t]').onclick = () => { if (p) render(() => stepTimer(p, entry.id)); };
      wrap.append(el);
      return;
    }
    // due-date pace nudge (9.4): informational, opens the underlying item; the check
    // fills once the day's target is met, but isn't tappable (progress is made in-domain)
    if (entry.kind === 'pace') {
      const pi = entry.info;
      const txt = pi.overdue
        ? '⚠ Overdue — ' + pi.left + ' ' + entry.unit + ' due now'
        : pi.perDay + ' ' + entry.unit + '/day' + (pi.done ? ' · done today ✓' : pi.progress ? ' · ' + pi.left + ' to go' : '');
      const el = h(`
        <div class="list-item" style="cursor:pointer${pi.overdue ? ';border-color:var(--danger)' : ''}">
          <div class="check"${pi.done ? ' style="background:var(--accent);border-color:var(--accent);color:#fff"' : ''}>✓</div>
          <div class="grow">
            <div class="title">${esc(entry.title)}</div>
            <div class="sub">🎯 ${esc(entry.domain)} · ${txt}${pi.overdue ? '' : paceDeltaChip(pi.delta)}</div>
          </div>
        </div>`);
      el.querySelector('.list-item').onclick = () => navPace(entry.goto);
      wrap.append(el);
      return;
    }
    const el = checkRow(entry, () => { if (entry.readonly) return; PL.toggle(dk, entry); rerender(); },
      { sub: entry.kind === 'rule' ? 'recurring' + (entry.domain ? ' · ' + entry.domain : '') : entry.domain,
        onDelete: entry.kind === 'item' ? () => { PL.removeItem(dk, entry.id); rerender(); } : null });
    if (entry.readonly) el.querySelector('.check').style.opacity = '.35';
    wrap.append(el);
  });
  if (!items.length) wrap.append(h(`<div class="empty">Nothing planned for this day yet.</div>`));

  if (showPathways) {
    // overdue: dated steps whose day has passed and still aren't done → roll onto today (9.3)
    if (dk === todayKey()) {
      const overdue = PW.scheduledSteps()
        .filter(({ s }) => s.date < dk && !s.done)
        .sort((a, b) => (a.s.date < b.s.date ? -1 : 1));
      if (overdue.length) {
        wrap.append(sectionTitle('Overdue'));
        overdue.forEach(({ p, s }) => {
          const el = h(`
            <div class="list-item" style="cursor:default;border-color:var(--danger)">
              <div class="check">✓</div>
              <div class="grow">
                <div class="title">${esc(s.label)}</div>
                <div class="sub">${esc(p.name)} · was due ${shortDate(s.date)}</div>
              </div>
              ${PW.isTimed(p) ? '<button class="pill" data-a="t" style="padding:7px 11px;font-size:15px">⏱</button>' : ''}
            </div>`);
          el.querySelector('.check').onclick = () => { PW.completeStep(p, s.id); rerender(); };
          const tb = el.querySelector('[data-a=t]');
          if (tb) tb.onclick = () => render(() => stepTimer(p, s.id));
          wrap.append(el);
        });
      }
    }
    // next steps only for pathways whose next step ISN'T scheduled (scheduled ones show on their day / overdue)
    const active = PW.all().filter(p => { const s = PW.nextStep(p); return s && !s.date; });
    if (active.length) {
      wrap.append(sectionTitle('Next steps on your pathways'));
      active.forEach(p => {
        const s = PW.nextStep(p);
        const st = PW.stats(p);
        const el = h(`
          <div class="list-item" style="cursor:default">
            <div class="check">✓</div>
            <div class="grow">
              <div class="title">${esc(s.label)}</div>
              <div class="sub">${esc(p.name)} · step ${st.doneSteps + 1} of ${st.totalSteps}</div>
            </div>
            ${PW.isTimed(p) ? '<button class="pill" style="padding:7px 11px;font-size:15px">⏱</button>' : ''}
          </div>`);
        el.querySelector('.check').onclick = () => { completePathwayStep(p); rerender(); };
        const tbtn = el.querySelector('.pill');
        if (tbtn) tbtn.onclick = () => render(() => stepTimer(p));
        wrap.append(el);
      });
    }
  }

  wrap.append(addRow('Add an item for this day', v => { PL.addItem(dk, v); rerender(); }));
  container.append(wrap);
}

// ---------- Plan (day / week / month / year / rules) ----------
let planMode = 'day';
let planCursor = todayKey();   // date key anchoring all views

function plan() {
  setHeader('Planner');
  const wrap = document.createElement('div');
  const pills = h(`<div class="pillrow">
    ${['day', 'week', 'month', 'year', 'rules'].map(m =>
      `<button class="pill ${planMode === m ? 'on' : ''}" data-m="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
  </div>`);
  pills.querySelectorAll('.pill').forEach(b => b.onclick = () => { planMode = b.dataset.m; rerender(); });
  wrap.append(pills);

  const body = document.createElement('div');
  wrap.append(body);
  ({ day: planDay, week: planWeek, month: planMonth, year: planYear, rules: planRules })[planMode](body);
  main().append(wrap);
}

function navBar(label, onPrev, onNext, onToday) {
  const el = h(`<div class="row" style="margin:4px 0 12px">
    <button class="pill" data-a="p">‹</button>
    <div class="grow" style="text-align:center;font-weight:700;font-size:15px">${esc(label)}</div>
    <button class="pill" data-a="t" style="font-size:12px">Today</button>
    <button class="pill" data-a="n">›</button>
  </div>`);
  el.querySelector('[data-a=p]').onclick = onPrev;
  el.querySelector('[data-a=n]').onclick = onNext;
  el.querySelector('[data-a=t]').onclick = onToday;
  return el;
}

function planDay(body) {
  body.append(navBar(PL.fmtDate(planCursor),
    () => { planCursor = PL.addDays(planCursor, -1); rerender(); },
    () => { planCursor = PL.addDays(planCursor, 1); rerender(); },
    () => { planCursor = todayKey(); rerender(); }));
  renderDayChecklist(body, planCursor, { showPathways: planCursor === todayKey() });
}

function planWeek(body) {
  const start = PL.weekStart(planCursor);
  const end = PL.addDays(start, 6);
  body.append(navBar(PL.fmtDate(start).slice(5) + ' – ' + PL.fmtDate(end).slice(5),
    () => { planCursor = PL.addDays(planCursor, -7); rerender(); },
    () => { planCursor = PL.addDays(planCursor, 7); rerender(); },
    () => { planCursor = todayKey(); rerender(); }));
  for (let i = 0; i < 7; i++) {
    const dk = PL.addDays(start, i);
    const st = PL.dayStats(dk);
    const isToday = dk === todayKey();
    const nudges = TG.paceNudges(dk);   // due-date pace amounts planned for this day (9.4)
    const paceLines = nudges.map(nd => {
      const pi = nd.info;
      const amt = pi.overdue ? '⚠ ' + pi.left + ' ' + nd.unit + ' due now'
        : pi.perDay + ' ' + nd.unit + (pi.done ? ' ✓' : '');
      return `<div class="sub" style="${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${esc(nd.title)} · ${amt}${pi.overdue ? '' : paceDeltaChip(pi.delta)}</div>`;
    }).join('');
    const el = h(`
      <div class="list-item" style="${isToday ? 'border-color:var(--accent)' : ''}">
        <div class="grow">
          <div class="title">${PL.fmtDate(dk)}${isToday ? ' · today' : ''}</div>
          <div class="sub">${st.total ? st.done + '/' + st.total + ' done' : (nudges.length ? 'targets below' : 'nothing planned')}</div>
          ${paceLines}
          ${st.total ? `<div class="progressbar" style="margin-top:6px"><div style="width:${st.done / st.total * 100}%"></div></div>` : ''}
        </div>
        <span class="chev">›</span>
      </div>`);
    el.querySelector('.list-item').onclick = () => { planCursor = dk; planMode = 'day'; rerender(); };
    body.append(el);
  }
}

function planMonth(body) {
  const d = PL.parseKey(planCursor);
  const y = d.getFullYear(), m = d.getMonth();
  const mk = planCursor.slice(0, 7);
  body.append(navBar(PL.MONTHS[m] + ' ' + y,
    () => { const nd = new Date(y, m - 1, 1); planCursor = PL.key(nd); rerender(); },
    () => { const nd = new Date(y, m + 1, 1); planCursor = PL.key(nd); rerender(); },
    () => { planCursor = todayKey(); rerender(); }));

  // calendar grid
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:8px';
  PL.DOW.forEach(dn => grid.append(h(`<div style="text-align:center;font-size:10px;font-weight:700;color:var(--text-2);padding:4px 0">${dn[0]}</div>`)));
  for (let i = 0; i < first.getDay(); i++) grid.append(document.createElement('div'));
  for (let day = 1; day <= daysInMonth; day++) {
    const dk = PL.key(new Date(y, m, day));
    const st = PL.dayStats(dk);
    const isToday = dk === todayKey();
    const hasTarget = TG.hasNudges(dk);   // a due-date pace amount is planned this day (9.4)
    const cell = document.createElement('div');
    cell.style.cssText = `aspect-ratio:1;border-radius:3px;border:1px solid ${isToday ? 'var(--accent)' : 'var(--line)'};background:var(--card);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:12px;font-weight:600;cursor:pointer;gap:2px`;
    const dots = [];
    if (st.total) dots.push(`<span style="width:5px;height:5px;border-radius:50%;background:${st.done === st.total ? 'var(--accent)' : 'var(--gold)'}"></span>`);
    if (hasTarget) dots.push(`<span title="reading/pace target" style="width:5px;height:5px;border-radius:50%;border:1.5px solid var(--accent);background:transparent"></span>`);
    cell.innerHTML = `<span>${day}</span>` + (dots.length ? `<span style="display:flex;gap:2px">${dots.join('')}</span>` : '');
    cell.onclick = () => { planCursor = dk; planMode = 'day'; rerender(); };
    grid.append(cell);
  }
  body.append(grid);

  body.append(sectionTitle('Goals for ' + PL.MONTHS[m]));
  PL.goals('monthGoals', mk).forEach(g => {
    body.append(checkRow(g, () => { PL.toggleGoal('monthGoals', mk, g.id); rerender(); },
      { onDelete: () => { PL.removeGoal('monthGoals', mk, g.id); rerender(); } }));
  });
  body.append(addRow('Add a goal for this month', v => { PL.addGoal('monthGoals', mk, v); rerender(); }));
}

function planYear(body) {
  const y = PL.parseKey(planCursor).getFullYear();
  const yk = String(y);
  body.append(navBar(String(y),
    () => { planCursor = PL.key(new Date(y - 1, 0, 1)); rerender(); },
    () => { planCursor = PL.key(new Date(y + 1, 0, 1)); rerender(); },
    () => { planCursor = todayKey(); rerender(); }));

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px';
  PL.MONTHS.forEach((mn, mi) => {
    const mk = yk + '-' + String(mi + 1).padStart(2, '0');
    const goals = (state.planner.monthGoals[mk] || []);
    const cell = document.createElement('div');
    cell.className = 'card';
    cell.style.cssText = 'margin:0;padding:10px;cursor:pointer;text-align:center';
    cell.innerHTML = `<div style="font-weight:700;font-size:13px">${mn.slice(0, 3)}</div><div class="muted" style="font-size:11px">${goals.length ? goals.filter(g => g.done).length + '/' + goals.length + ' goals' : '—'}</div>`;
    cell.onclick = () => { planCursor = PL.key(new Date(y, mi, 1)); planMode = 'month'; rerender(); };
    grid.append(cell);
  });
  body.append(grid);

  body.append(sectionTitle('Goals for ' + y));
  PL.goals('yearGoals', yk).forEach(g => {
    body.append(checkRow(g, () => { PL.toggleGoal('yearGoals', yk, g.id); rerender(); },
      { onDelete: () => { PL.removeGoal('yearGoals', yk, g.id); rerender(); } }));
  });
  body.append(addRow('Add a goal for this year', v => { PL.addGoal('yearGoals', yk, v); rerender(); }));
}

function planRules(body) {
  body.append(h(`<div class="muted" style="margin:2px 4px 12px">Recurring items appear automatically on their days — check them off from Today or any day view.</div>`));
  state.planner.rules.forEach(r => {
    const el = h(`
      <div class="list-item" style="cursor:default">
        <div class="grow">
          <div class="title">${esc(r.label)}</div>
          <div class="sub">${r.dow.length === 7 ? 'Every day' : r.dow.map(d => PL.DOW[d]).join(' · ')}</div>
        </div>
        <button class="del" style="border:none;background:none;color:var(--danger);font-size:17px;cursor:pointer">✕</button>
      </div>`);
    el.querySelector('.del').onclick = () => { PL.removeRule(r.id); toast('Rule removed'); rerender(); };
    body.append(el);
  });
  if (!state.planner.rules.length) body.append(h(`<div class="empty">No recurring rules yet.</div>`));

  body.append(sectionTitle('New recurring rule'));
  const card = h(`
    <div class="card">
      <input id="rule-label" placeholder="e.g. Review memorized chapters" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;margin-bottom:10px">
      <div class="pillrow" id="rule-days">
        ${PL.DOW.map((d, i) => `<button class="pill" data-d="${i}">${d}</button>`).join('')}
        <button class="pill" data-d="all">Every day</button>
      </div>
      <button class="btn" id="rule-add">Add rule</button>
    </div>`).firstElementChild;
  const sel = new Set();
  card.querySelectorAll('#rule-days .pill').forEach(b => b.onclick = () => {
    if (b.dataset.d === 'all') {
      const allOn = sel.size === 7;
      sel.clear();
      if (!allOn) for (let i = 0; i < 7; i++) sel.add(i);
    } else {
      const i = Number(b.dataset.d);
      sel.has(i) ? sel.delete(i) : sel.add(i);
    }
    card.querySelectorAll('#rule-days .pill').forEach(p => {
      if (p.dataset.d === 'all') p.classList.toggle('on', sel.size === 7);
      else p.classList.toggle('on', sel.has(Number(p.dataset.d)));
    });
  });
  card.querySelector('#rule-add').onclick = () => {
    const label = card.querySelector('#rule-label').value.trim();
    if (!label) { toast('Give the rule a name'); return; }
    if (!sel.size) { toast('Pick at least one day'); return; }
    PL.addRule(label, [...sel].sort());
    toast('Rule added');
    rerender();
  };
  body.append(card);
}

// ---------- Pathways ----------
function pathwaysHome() {
  setHeader('Pathways', { back: true });
  const wrap = document.createElement('div');
  wrap.append(h(`<div class="muted" style="margin:2px 4px 12px">Ordered steps toward an accomplishment, grouped into milestones. No dates — just always know your next stone.</div>`));
  PW.all().forEach(p => {
    const st = PW.stats(p);
    const next = PW.nextStep(p);
    const cur = PW.currentMilestone(p);
    const el = h(`
      <div class="list-item">
        <div class="grow">
          <div class="title">${esc(p.name)}</div>
          <div class="sub">${next ? 'Next: ' + esc(next.label) + (cur ? ' · ' + esc(cur.name) : '') : st.totalSteps ? 'Complete! 🎉' : 'No steps yet'} · ${st.doneSteps}/${st.totalSteps} steps</div>
          ${st.totalSteps ? `<div class="progressbar" style="margin-top:6px"><div style="width:${st.pct}%"></div></div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-weight:700;color:var(--accent);font-size:14px">${st.pct}%</div>
        </div>
        <span class="chev">›</span>
      </div>`);
    el.querySelector('.list-item').onclick = () => render(() => pathwayDetail(p));
    wrap.append(el);
  });
  if (!PW.all().length) wrap.append(h(`<div class="empty">No pathways yet. Create your first below —<br>e.g. “Review all of Hebrews”.</div>`));

  // .firstElementChild: keep a live element reference — fragments empty on append
  const createCard = h(`
    <div class="card" style="margin-top:14px"><h3>New pathway</h3>
      <input data-a="name" placeholder="Pathway name" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;margin-bottom:10px">
      <div class="pillrow">
        <button class="pill on" data-c="general">General</button>
        <button class="pill" data-c="scripture-review">Scripture Review ⏱</button>
      </div>
      <div class="muted" style="margin-bottom:6px;font-size:12px">Scripture Review pathways include a timer on every step — timed whole-book reviews log automatically to the review tracker.</div>
      <button class="btn" data-a="create">Create pathway</button>
    </div>`).firstElementChild;
  let newCat = 'general';
  createCard.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    newCat = b.dataset.c;
    createCard.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x.dataset.c === newCat));
  });
  createCard.querySelector('[data-a=create]').onclick = () => {
    const name = createCard.querySelector('[data-a=name]').value.trim();
    if (!name) { toast('Give the pathway a name'); return; }
    const p = PW.create(name, newCat);
    render(() => pathwayDetail(p));
  };
  wrap.append(createCard);
  main().append(wrap);
}

let pwEditMode = false;
let pwExpanded = {};   // milestone id → manually expanded/collapsed

function pathwayDetail(p) {
  pwEditMode = false;
  pwExpanded = {};
  drawPathway(p);
}
function drawPathway(p) {
  setHeader(p.name, { back: true, action: { label: pwEditMode ? 'Done' : 'Edit', fn: () => { pwEditMode = !pwEditMode; drawPathway(p); } } });
  const wrap = document.createElement('div');
  buildPathwayBody(wrap, p);
  main().innerHTML = '';
  main().append(wrap);
}

function buildPathwayBody(wrap, p) {
  const st = PW.stats(p);
  const msDone = p.milestones.filter(PW.milestoneComplete).length;
  wrap.append(h(`
    <div class="card">
      <div class="row">
        <div class="grow"><div class="big">${st.pct}%</div>
        <div class="muted">${st.doneSteps} of ${st.totalSteps} steps · ${msDone}/${p.milestones.length} milestones${st.total !== st.totalSteps ? ' · weighted' : ''}</div></div>
      </div>
      <div class="progressbar" style="margin-top:8px"><div style="width:${st.pct}%"></div></div>
    </div>`));

  if (pwEditMode) { buildPathwayEdit(wrap, p); return; }

  const current = PW.currentMilestone(p);
  let globalIndex = 0;

  p.milestones.forEach((m, mi) => {
    const ms = PW.milestoneStats(m);
    const complete = PW.milestoneComplete(m);
    const isCurrent = current && m.id === current.id;
    const locked = !complete && !isCurrent && m.steps.length > 0;
    const startIndex = globalIndex;
    globalIndex += m.steps.length;
    const expanded = pwExpanded[m.id] !== undefined ? pwExpanded[m.id] : (isCurrent || m.steps.length === 0);

    // milestone header
    const head = h(`
      <div class="ms-head ${complete ? 'complete' : locked ? 'locked' : ''}">
        <div class="ms-badge" style="${complete ? 'background:var(--accent);color:#fff' : isCurrent ? 'background:var(--gold);color:#fff' : 'background:var(--line);color:var(--text-2)'}">${complete ? '✓' : locked ? '🔒' : mi + 1}</div>
        <div class="grow">
          ${pwEditMode
            ? `<input value="${esc(m.name)}" data-a="rename" style="width:100%;border:none;background:none;color:var(--text);font-size:15px;font-weight:700;padding:0">`
            : `<div style="font-size:15px;font-weight:700">${esc(m.name)}</div>`}
          <div class="sub" style="color:var(--text-2);font-size:12px">${ms.totalSteps ? ms.doneSteps + '/' + ms.totalSteps + ' steps · ' + ms.pct + '%' : 'empty'}</div>
        </div>
        ${pwEditMode ? '<button data-a="delms" style="border:none;background:none;color:var(--danger);font-size:16px;cursor:pointer">✕</button>' : `<span class="chev">${expanded ? '▾' : '▸'}</span>`}
      </div>`);
    if (!pwEditMode) head.querySelector('.ms-head').onclick = () => { pwExpanded[m.id] = !expanded; drawPathway(p); };
    const ren = head.querySelector('[data-a=rename]');
    if (ren) { ren.onclick = e => e.stopPropagation(); ren.onchange = () => PW.renameMilestone(p, m.id, ren.value); }
    const delms = head.querySelector('[data-a=delms]');
    if (delms) delms.onclick = e => { e.stopPropagation(); PW.removeMilestone(p, m.id); drawPathway(p); };
    wrap.append(head);

    if (!expanded) return;

    // the stones — winding path
    const path = document.createElement('div');
    path.style.cssText = 'position:relative;padding:2px 0 2px 6px;margin-bottom:4px';
    let nextFound = false;
    const globalNext = PW.nextStep(p);
    m.steps.forEach((s, i) => {
      const isNext = globalNext && s.id === globalNext.id;
      const offset = [0, 26, 46, 26][i % 4];
      const stone = h(`
        <div class="row" style="margin-bottom:10px;margin-left:${offset}px;position:relative">
          <div style="width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
            ${s.done ? 'background:var(--text);color:var(--bg);border:2px solid var(--text)'
              : isNext ? 'background:var(--card);color:var(--gold);border:2px solid var(--gold)'
              : 'background:var(--card);color:var(--text-2);border:2px solid var(--line)'}">${s.done ? '✓' : startIndex + i + 1}</div>
          <div class="grow card" style="margin:0;padding:10px 13px;${isNext ? 'border-color:var(--gold);' : ''}${s.done ? 'opacity:.55;' : ''}${locked ? 'opacity:.5;' : ''}">
            <div class="row">
              <div class="grow" style="font-size:14px;font-weight:600;${s.done ? 'text-decoration:line-through' : ''}">${esc(s.label)}
                ${!pwEditMode && PW.stepWeight(s) > 1 ? ` <span style="font-size:11px;font-weight:700;color:var(--gold)">×${PW.stepWeight(s)}</span>` : ''}</div>
              ${isNext && !pwEditMode && !locked ? `<button class="pill on" data-a="go" style="padding:5px 12px;font-size:12px">Done</button>` +
                (PW.isTimed(p) ? `<button class="pill" data-a="time" style="padding:5px 9px;font-size:13px">⏱</button>` : '') : ''}
              ${!s.done && !pwEditMode ? `<button class="pill pw-datechip ${s.date ? 'on' : ''}" data-a="date" style="padding:5px 9px;font-size:12px">${s.date ? '📅 ' + shortDate(s.date) : '📅'}</button>` : ''}
              ${s.done && pwEditMode ? '<button class="pill" data-a="undo" style="font-size:12px;padding:5px 10px">Undo</button>' : ''}
              ${pwEditMode ? `<button class="pill" data-a="wminus" style="padding:4px 9px;font-size:13px">−</button>
                <span style="font-size:12px;font-weight:700;color:var(--gold);min-width:24px;text-align:center">×${PW.stepWeight(s)}</span>
                <button class="pill" data-a="wplus" style="padding:4px 9px;font-size:13px">+</button>
                <button data-a="del" style="border:none;background:none;color:var(--danger);font-size:16px;cursor:pointer">✕</button>` : ''}
            </div>
            ${s.done && s.doneTs ? `<div class="sub" style="margin-top:2px">done ${new Date(s.doneTs).toLocaleDateString()}${s.secs != null ? ' · ' + SC.fmtSecs(s.secs) : ''}</div>` : ''}
            <div data-slot="timebox"></div>
            <div data-slot="datebox"></div>
          </div>
        </div>`);
      const go = stone.querySelector('[data-a=go]');
      if (go) go.onclick = () => { completePathwayStep(p); drawPathway(p); };
      const time = stone.querySelector('[data-a=time]');
      const timebox = stone.querySelector('[data-slot=timebox]');
      if (time) time.onclick = () => openTimeBox(p, timebox);
      const datebtn = stone.querySelector('[data-a=date]');
      const datebox = stone.querySelector('[data-slot=datebox]');
      if (datebtn) datebtn.onclick = () => openDateBox(p, s, datebox);
      const undo = stone.querySelector('[data-a=undo]');
      if (undo) undo.onclick = () => { PW.uncomplete(p, s.id); drawPathway(p); };
      const del = stone.querySelector('[data-a=del]');
      if (del) del.onclick = () => { PW.removeStep(p, s.id); drawPathway(p); };
      const wminus = stone.querySelector('[data-a=wminus]');
      if (wminus) wminus.onclick = () => { PW.setStepWeight(p, s.id, PW.stepWeight(s) - 1); drawPathway(p); };
      const wplus = stone.querySelector('[data-a=wplus]');
      if (wplus) wplus.onclick = () => { PW.setStepWeight(p, s.id, PW.stepWeight(s) + 1); drawPathway(p); };
      path.append(stone);
    });
    if (!m.steps.length && !pwEditMode) path.append(h(`<div class="muted" style="padding:2px 6px 8px">No steps yet — add some below.</div>`));
    wrap.append(path);
  });

  if (!PW.flatSteps(p).length) wrap.append(h(`<div class="empty">Add the steps in order — first step first.</div>`));

  wrap.append(addRow('Add step to “' + p.milestones[p.milestones.length - 1].name + '”', v => { PW.addStep(p, v); drawPathway(p); }));
  const msBtn = h(`<button class="btn secondary" style="margin-top:10px">Start a new milestone</button>`);
  msBtn.firstChild.onclick = () => { PW.addMilestone(p); drawPathway(p); };
  wrap.append(msBtn);
}

// ---- edit mode: drag-to-reorder milestones + steps, inline rename, targeted add ----
function buildPathwayEdit(wrap, p) {
  const list = h(`<div id="pw-drag" style="margin-top:4px"></div>`).firstElementChild;

  p.milestones.forEach((m, mi) => {
    const group = h(`<div class="pw-group" data-mid="${m.id}"></div>`).firstElementChild;
    const head = h(`
      <div class="pw-mhead row">
        <div class="pw-handle pw-mhandle" title="Drag to reorder milestone">≡</div>
        <div class="pw-mbadge">${mi + 1}</div>
        <input class="grow pw-rename" value="${esc(m.name)}" placeholder="Milestone name">
        <button class="pw-del" data-a="delms" title="Delete milestone">✕</button>
      </div>`).firstElementChild;
    head.querySelector('.pw-rename').onchange = e => PW.renameMilestone(p, m.id, e.target.value);
    head.querySelector('[data-a=delms]').onclick = () => {
      if (m.steps.length && !confirm(`Delete “${m.name || 'this milestone'}” and its ${m.steps.length} step(s)?`)) return;
      PW.removeMilestone(p, m.id); drawPathway(p);
    };
    group.append(head);

    m.steps.forEach(s => {
      const row = h(`
        <div class="pw-step row" data-sid="${s.id}">
          <div class="pw-handle pw-shandle" title="Drag to reorder">≡</div>
          <div class="pw-sdot ${s.done ? 'done' : ''}">${s.done ? '✓' : ''}</div>
          <input class="grow pw-rename" value="${esc(s.label)}" placeholder="Step">
          <button class="pw-wbtn" data-a="wminus">−</button>
          <span class="pw-wt">×${PW.stepWeight(s)}</span>
          <button class="pw-wbtn" data-a="wplus">+</button>
          <button class="pw-del" data-a="del" title="Delete step">✕</button>
        </div>`).firstElementChild;
      row.querySelector('.pw-rename').onchange = e => PW.renameStep(p, s.id, e.target.value);
      row.querySelector('[data-a=wminus]').onclick = () => { PW.setStepWeight(p, s.id, PW.stepWeight(s) - 1); drawPathway(p); };
      row.querySelector('[data-a=wplus]').onclick = () => { PW.setStepWeight(p, s.id, PW.stepWeight(s) + 1); drawPathway(p); };
      row.querySelector('[data-a=del]').onclick = () => { PW.removeStep(p, s.id); drawPathway(p); };
      group.append(row);
    });
    if (!m.steps.length) group.append(h(`<div class="pw-empty muted">Empty — add a step below or drag one here.</div>`).firstElementChild);
    list.append(group);
  });
  wrap.append(list);

  // add-step area — milestone target pills (default = last milestone)
  let targetMid = p.milestones[p.milestones.length - 1].id;
  const addCard = h(`
    <div class="card" style="margin-top:14px"><h3>Add a step</h3>
      <div class="pillrow" id="pw-target" style="margin-bottom:8px"></div>
      <div class="row">
        <input class="grow" id="pw-newstep" placeholder="Step name" style="padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;min-width:0">
        <button class="pill on" id="pw-addstep" style="padding:10px 16px">Add</button>
      </div>
    </div>`).firstElementChild;
  const pills = addCard.querySelector('#pw-target');
  const renderPills = () => {
    pills.innerHTML = '';
    p.milestones.forEach(m => {
      const b = h(`<button class="pill ${m.id === targetMid ? 'on' : ''}">${esc(m.name || 'Milestone')}</button>`).firstElementChild;
      b.onclick = () => { targetMid = m.id; renderPills(); };
      pills.append(b);
    });
  };
  renderPills();
  const inp = addCard.querySelector('#pw-newstep');
  const doAdd = () => { const v = inp.value.trim(); if (!v) return; PW.addStep(p, v, targetMid); drawPathway(p); };
  addCard.querySelector('#pw-addstep').onclick = doAdd;
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
  wrap.append(addCard);

  const msBtn = h(`<button class="btn secondary" style="margin-top:10px">Start a new milestone</button>`).firstElementChild;
  msBtn.onclick = () => { PW.addMilestone(p); drawPathway(p); };
  wrap.append(msBtn);

  const catCard = h(`
    <div class="card" style="margin-top:16px"><h3>Category</h3>
      <div class="pillrow" style="margin-bottom:0">
        <button class="pill ${p.category !== 'scripture-review' ? 'on' : ''}" data-c="general">General</button>
        <button class="pill ${p.category === 'scripture-review' ? 'on' : ''}" data-c="scripture-review">Scripture Review ⏱</button>
      </div>
    </div>`).firstElementChild;
  catCard.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { PW.setCategory(p, b.dataset.c); drawPathway(p); });
  wrap.append(catCard);

  const delBtn = h(`<button class="btn danger" style="margin-top:12px">Delete this pathway</button>`).firstElementChild;
  delBtn.onclick = () => { PW.remove(p.id); toast('Pathway deleted'); goBack(); };
  wrap.append(delBtn);

  initPwDnD(list, p);
}

// Pointer-based drag reorder (works in installed iOS PWAs, unlike HTML5 DnD).
// A ≡ handle lifts its row (a step or a whole milestone group) to fixed position;
// a placeholder tracks the drop slot; on release we read the new DOM order and persist.
function initPwDnD(list, p) {
  let drag = null;

  const afterEl = (container, y, sel) => {
    const els = [...container.querySelectorAll(sel)].filter(el => el !== drag.row && !el.contains(drag.row) && el !== drag.ph);
    let best = null, bestOff = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const off = y - (r.top + r.height / 2);
      if (off < 0 && off > bestOff) { bestOff = off; best = el; }
    }
    return best;
  };

  const autoScroll = y => {
    const sc = document.scrollingElement || document.documentElement, edge = 64;
    if (y < edge) sc.scrollTop -= (edge - y) / 5;
    else if (y > window.innerHeight - edge) sc.scrollTop += (y - (window.innerHeight - edge)) / 5;
  };

  const onMove = e => {
    if (!drag) return;
    e.preventDefault();
    const y = e.clientY;
    drag.row.style.top = (y - drag.grabY) + 'px';
    drag.row.style.left = drag.left + 'px';
    if (drag.kind === 'ms') {
      const after = afterEl(list, y, '.pw-group');
      if (after) list.insertBefore(drag.ph, after); else list.append(drag.ph);
    } else {
      const px = Math.min(Math.max(e.clientX, drag.left + 6), drag.left + drag.width - 6);
      const under = document.elementFromPoint(px, y);
      let group = under && under.closest ? under.closest('.pw-group') : null;
      if (!group) group = afterEl(list, y, '.pw-group') || [...list.querySelectorAll('.pw-group')].pop();
      if (!group) return;
      const after = afterEl(group, y, '.pw-step');
      if (after) group.insertBefore(drag.ph, after); else group.append(drag.ph);
    }
    autoScroll(y);
  };

  const end = () => {
    if (!drag) return;
    const { row, ph } = drag;
    row.classList.remove('pw-dragging');
    ['position', 'top', 'left', 'width', 'zIndex', 'pointerEvents'].forEach(k => row.style[k] = '');
    ph.parentNode.insertBefore(row, ph);
    ph.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    drag = null;
    persistPwOrder(list, p);
    drawPathway(p);
  };

  list.querySelectorAll('.pw-handle').forEach(handle => {
    handle.addEventListener('pointerdown', e => {
      if (e.button != null && e.button > 0) return;
      const isMs = handle.classList.contains('pw-mhandle');
      const row = handle.closest(isMs ? '.pw-group' : '.pw-step');
      if (!row) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const ph = document.createElement('div');
      ph.className = 'pw-ph';
      ph.style.height = rect.height + 'px';
      row.parentNode.insertBefore(ph, row);
      drag = { row, ph, kind: isMs ? 'ms' : 'step', grabY: e.clientY - rect.top, left: rect.left, width: rect.width };
      row.classList.add('pw-dragging');
      row.style.width = rect.width + 'px';
      row.style.position = 'fixed';
      row.style.left = rect.left + 'px';
      row.style.top = rect.top + 'px';
      row.style.zIndex = '999';
      row.style.pointerEvents = 'none';
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
  });
}

function persistPwOrder(list, p) {
  const order = [];
  list.querySelectorAll('.pw-group').forEach(g => {
    order.push({ mid: g.dataset.mid, stepIds: [...g.querySelectorAll('.pw-step')].map(r => r.dataset.sid) });
  });
  PW.applyOrder(p, order);
}

// inline "time it" box under the next stone: stopwatch or manual entry
function openTimeBox(p, card) {
  if (!card) return;
  card.innerHTML = '';
  card.append(h(`
    <div class="row" style="margin-top:10px">
      <button class="pill on" data-a="watch" style="flex:1">Stopwatch</button>
      <input data-a="manual" placeholder="mm:ss" inputmode="numeric" style="width:80px;padding:9px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
      <button class="pill" data-a="save">Save</button>
    </div>`));
  card.querySelector('[data-a=watch]').onclick = () => render(() => stepTimer(p));
  card.querySelector('[data-a=save]').onclick = () => {
    const secs = SC.parseDuration(card.querySelector('[data-a=manual]').value);
    if (secs == null) { toast('Enter a time like 12:34 or 1:05:30'); return; }
    completePathwayStep(p, secs);
    drawPathway(p);
  };
}

// short date label for a step's schedule chip, e.g. "Jul 22"
function shortDate(dk) { const d = PL.parseKey(dk); return PL.MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }

// inline date picker under a step: schedule / reschedule / clear its date (Phase 9.2)
function openDateBox(p, s, slot) {
  if (!slot) return;
  slot.innerHTML = '';
  slot.append(h(`
    <div class="row" style="margin-top:10px">
      <input type="date" data-a="d" value="${s.date || ''}" style="flex:1;min-width:0;padding:9px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
      ${s.date ? '<button class="pill" data-a="clear">Clear</button>' : ''}
      <button class="pill on" data-a="save">Save</button>
    </div>`));
  slot.querySelector('[data-a=save]').onclick = () => {
    const v = slot.querySelector('[data-a=d]').value;
    PW.setStepDate(p, s.id, v || null);
    toast(v ? 'Scheduled ' + shortDate(v) : 'Date cleared');
    drawPathway(p);
  };
  const clr = slot.querySelector('[data-a=clear]');
  if (clr) clr.onclick = () => { PW.setStepDate(p, s.id, null); toast('Date cleared'); drawPathway(p); };
}

// Background-safe stopwatch (Phase 7.1). Elapsed derives from a wall-clock start,
// NOT accumulated setInterval ticks — iOS suspends the JS timer when the app is
// backgrounded or the phone locks, so tick-counting silently lost time (1:20 away
// read as 18s). The interval only repaints; visibilitychange/focus re-sync on return.
// getClockEl is a getter so the display node can be re-queried after any re-render.
function startStopwatch(getClockEl) {
  const startedAt = Date.now();
  const elapsed = () => Math.floor((Date.now() - startedAt) / 1000);
  const paint = () => { const c = getClockEl(); if (c) c.textContent = SC.fmtSecs(elapsed()); };
  const iv = setInterval(paint, 500);
  const onVis = () => { if (!document.hidden) paint(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
  paint();
  return {
    elapsed,
    stop() {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    }
  };
}

// full-screen stopwatch for a pathway step
function stepTimer(p, stepId = null) {
  const s = stepId ? PW.flatSteps(p).find(x => x.id === stepId) : PW.nextStep(p);
  if (!s) { goBack(); return; }
  setHeader('Timing step', { back: true });
  const el = document.createElement('div');
  el.append(h(`
    <div class="card" style="text-align:center;padding:30px 14px">
      <div class="big" id="st-clock" style="font-size:52px">0:00</div>
      <div class="muted" style="margin-top:4px">${esc(s.label)} · ${esc(p.name)}</div>
      <button class="btn" id="st-done" style="margin-top:22px">Finish — mark step done</button>
      <button class="btn secondary" id="st-cancel">Cancel</button>
    </div>`));
  const sw = startStopwatch(() => el.querySelector('#st-clock'));
  el.querySelector('#st-done').onclick = () => {
    sw.stop();
    completePathwayStep(p, sw.elapsed(), stepId);
    goBack();
  };
  el.querySelector('#st-cancel').onclick = () => { sw.stop(); goBack(); };
  main().append(el);
}

// ---------- Scripture ----------
// The whole Bible as a shelf of 66 tiles: fill height = % memorized,
// solid = complete, red ring = review needed. Tap any tile to open the book.
let scMode = 'memorize';

function shelfTile(b) {
  const st = SC.bookStats(b);
  const stale = SC.isStale(b);
  const color = b.t === 'ot' ? 'var(--ot)' : 'var(--nt)';
  const done = st.pct === 100;
  const el = h(`
    <div style="aspect-ratio:1;border-radius:3px;position:relative;overflow:hidden;cursor:pointer;
      border:${stale ? '2px solid var(--danger)' : done ? '1.5px solid ' + color : '1px solid var(--line)'};
      background:var(--card);display:flex;align-items:center;justify-content:center" title="${esc(b.name)} · ${st.pct}%">
      ${st.pct ? `<div style="position:absolute;left:0;right:0;bottom:0;height:${st.pct}%;background:${color};opacity:${done ? '1' : '.30'}"></div>` : ''}
      <span style="position:relative;font-size:10px;font-weight:700;color:${done ? '#fff' : 'var(--text)'}">${SC.abbr(b.name)}</span>
    </div>`).firstElementChild;
  el.onclick = () => render(() => bookScreen(b));
  return el;
}

function scriptureHome() {
  setHeader('Scripture', { back: true });
  const wrap = document.createElement('div');
  const body = document.createElement('div');
  wrap.append(body);
  main().append(wrap);
  // SM6: reading plans live in their own Area; review moved to the Scripture Review Area

  // current book hero
  const cur = SC.currentBook();
  if (cur) {
    const st = SC.bookStats(cur);
    const next = SC.nextChapter(cur);
    const stale = SC.isStale(cur);
    const hero = h(`
      <div class="card" style="border-color:var(--accent);cursor:pointer">
        <h3>Continue memorizing</h3>
        <div class="row">
          <span class="badge ${cur.t}">${cur.t.toUpperCase()}</span>
          <div class="grow">
            <div style="font-size:18px;font-weight:700;">${esc(cur.name)}</div>
            <div class="muted" style="font-size:12px">${next ? 'chapter ' + (next.ci + 1) + ' · ' + next.done + '/' + next.total + ' verses' : 'complete! 🎉'}${stale ? ' · <span style="color:var(--danger)">⚠ review needed</span>' : ''}</div>
          </div>
          <div class="big" style="color:var(--accent)">${st.pct}%</div>
        </div>
        <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${st.pct}%"></div></div>
      </div>`).firstElementChild;
    hero.onclick = () => render(() => bookScreen(cur));
    body.append(hero);
  }

  // in-progress books (excluding current)
  const inProgress = SC.allBooks.filter(b => { const s = SC.bookStats(b); return s.done > 0 && b.name !== (cur && cur.name); });
  if (inProgress.length) {
    body.append(sectionTitle('In progress'));
    inProgress.forEach(b => {
      const st = SC.bookStats(b);
      const stale = SC.isStale(b);
      const el = h(`
        <div class="list-item">
          <span class="badge ${b.t}">${b.t.toUpperCase()}</span>
          <div class="grow">
            <div class="title">${esc(b.name)}${stale ? ' <span style="color:var(--danger);font-size:12px;font-weight:700">⚠</span>' : ''}</div>
            <div class="sub">${st.done}/${st.total} verses · ${st.pct}%</div>
            <div class="progressbar" style="margin-top:6px"><div style="width:${st.pct}%;${stale ? 'background:var(--danger);opacity:.5' : ''}"></div></div>
          </div>
          <span class="chev">›</span>
        </div>`);
      el.querySelector('.list-item').onclick = () => render(() => bookScreen(b));
      body.append(el);
    });
  }

  // the bookshelf — every book, at a glance
  [['ot', 'Old Testament'], ['nt', 'New Testament']].forEach(([t, label]) => {
    body.append(sectionTitle(label));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px';
    SC.allBooks.filter(b => b.t === t).forEach(b => grid.append(shelfTile(b)));
    body.append(grid);
  });
  body.append(h(`<div class="muted" style="font-size:11px;margin-top:10px;padding:0 4px">Tile fill = % memorized · solid = complete · red ring = review needed. Tap any book.</div>`));

  // SM3 — corpus resets, deliberately buried at the bottom
  const rst = h(`<div class="card" style="margin-top:18px"><h3>Reset</h3>
    <div class="row" style="gap:8px">
      <button class="pill" data-t="ot" style="color:var(--danger)">Reset Old Testament</button>
      <button class="pill" data-t="nt" style="color:var(--danger)">Reset New Testament</button>
    </div></div>`).firstElementChild;
  rst.querySelectorAll('[data-t]').forEach(btn => btn.onclick = () => {
    const t = btn.dataset.t, label = t === 'ot' ? 'Old Testament' : 'New Testament';
    if (!confirm('Erase ALL memorization progress for the ' + label + '? Review history is kept.')) return;
    if (!confirm('Really erase the ' + label + '? This cannot be undone.')) return;
    SC.resetCorpus(t);
    toast(label + ' progress reset');
    rerender();
  });
  body.append(rst);
}

// 7B.2 — dashboard hub: a browsable list of a corpus's books (t = 'ot' | 'nt' | null for whole Bible)
function corpusBooks(t) {
  const title = t === 'ot' ? 'Old Testament' : t === 'nt' ? 'New Testament' : 'Whole Bible';
  setHeader(title, { back: true });
  const wrap = document.createElement('div');
  const books = SC.allBooks.filter(b => t == null || b.t === t);
  let done = 0, total = 0;
  books.forEach(b => { const s = SC.bookStats(b); done += s.done; total += s.total; });
  const pct = total ? done / total * 100 : 0;
  wrap.append(h(`<div class="card"><div class="row">
    <div class="grow"><div class="big">${pct > 0 && pct < 10 ? pct.toFixed(1) : Math.round(pct)}%</div>
    <div class="muted">${done.toLocaleString()}/${total.toLocaleString()} verses memorized · ${books.length} books</div></div>
  </div></div>`));
  books.forEach(b => {
    const st = SC.bookStats(b);
    const stale = SC.isStale(b);
    const el = h(`<div class="list-item" style="cursor:pointer">
      <span class="badge ${b.t}">${b.t.toUpperCase()}</span>
      <div class="grow"><div class="title">${esc(b.name)}${stale ? ' <span style="color:var(--danger);font-size:12px;font-weight:700">⚠</span>' : ''}</div>
        <div class="sub">${st.done}/${st.total} verses · ${st.pct}%</div>
        <div class="progressbar" style="margin-top:5px"><div style="width:${st.pct}%;${stale ? 'background:var(--danger);opacity:.5' : ''}"></div></div></div>
      <span class="chev">›</span></div>`).firstElementChild;
    el.onclick = () => render(() => bookScreen(b));
    wrap.append(el);
  });
  main().append(wrap);
}

// 7B.2 — dashboard hub: books fully memorized
function booksCompleteScreen() {
  setHeader('Books complete', { back: true });
  const wrap = document.createElement('div');
  const done = SC.allBooks.filter(b => { const s = SC.bookStats(b); return s.total > 0 && s.done === s.total; });
  if (!done.length) wrap.append(h(`<div class="muted" style="padding:8px 4px">No books fully memorized yet. Finish every verse in a book and it lands here.</div>`));
  done.forEach(b => {
    const st = SC.bookStats(b);
    const el = h(`<div class="list-item" style="cursor:pointer">
      <span class="badge ${b.t}">${b.t.toUpperCase()}</span>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="sub">${st.total} verses · 100%</div></div>
      <span class="chev">›</span></div>`).firstElementChild;
    el.onclick = () => render(() => bookScreen(b));
    wrap.append(el);
  });
  main().append(wrap);
}

function practiceScriptureLauncher() {
  setHeader('Practice Scripture', { back: true });
  const wrap = document.createElement('div');
  const books = SC.allBooks.filter(b => SC.bookStats(b).done > 0);
  if (!books.length) wrap.append(h(`<div class="muted" style="padding:8px 4px">Nothing to practice yet — start memorizing a book first.</div>`));
  else wrap.append(h(`<div class="muted" style="font-size:12px;padding:0 4px 8px">Pick a book, then choose whole-book, chapters, or specific verses.</div>`));
  books.forEach(b => {
    const st = SC.bookStats(b);
    const el = h(`<div class="list-item" style="cursor:pointer"><span class="badge ${b.t}">${b.t.toUpperCase()}</span>
      <div class="grow"><div class="title">${esc(b.name)}</div><div class="sub">${st.done}/${st.total} verses · ${st.pct}%</div></div><span class="chev">›</span></div>`).firstElementChild;
    el.onclick = () => render(() => practiceScope(b));
    wrap.append(el);
  });
  main().append(wrap);
}

function practiceCreedsLauncher() {
  setHeader('Practice Creeds', { back: true });
  const wrap = document.createElement('div');
  CR.docs().forEach(d => {
    const st = CR.docStats(d.id);
    const el = h(`<div class="list-item" style="cursor:pointer">
      <div class="grow"><div class="title">${esc(d.name)}</div><div class="sub">${st.done}/${st.total} ${d.group === 'catechisms' ? 'Q&As' : 'sections'} · ${st.pct}%</div></div><span class="chev">›</span></div>`).firstElementChild;
    el.onclick = () => render(() => practiceSetup(d));
    wrap.append(el);
  });
  main().append(wrap);
}

const INTERVALS = [[0, 'None'], [7, 'Weekly'], [14, '2 weeks'], [30, 'Monthly'], [90, '3 months']];

function bookScreen(b) {
  setHeader(b.name, { back: true });
  const wrap = document.createElement('div');
  const st = SC.bookStats(b);
  const stale = SC.isStale(b);
  const last = SC.lastReviewTs(b.name);
  const chaptersDone = b.verses.filter((_, ci) => { const c = SC.chapterStats(b, ci); return c.done === c.total; }).length;
  const isCurrent = (state.scripture.currentItems || []).some(it => it.book === b.name && it.ch == null);
  const days = SC.reviewIntervalDays(b.name);
  const it = isCurrent ? state.scripture.currentItems.find(x => x.book === b.name && x.ch == null) : null;

  // status card
  wrap.append(h(`
    <div class="card" style="${isCurrent ? 'border-color:var(--accent)' : ''}">
      <div class="row">
        <span class="badge ${b.t}">${b.t.toUpperCase()}</span>
        <div class="grow"><div class="big">${st.pct}%</div>
        <div class="muted">${st.done}/${st.total} verses · ${chaptersDone}/${b.chapters} chapters${isCurrent ? ' · <span style="color:var(--accent);font-weight:700">current book</span>' : ''}</div>
        ${(() => { const pi = it ? TG.memPaceInfo(it) : null; return pi ? `<div style="font-size:12px;font-weight:600;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? 'Overdue — ' + pi.remaining + ' verses left, due now' : pi.perDay + ' verses/day to finish by ' + shortDate(it.due)}</div>` : ''; })()}</div>
        ${stale ? '<div style="text-align:right;color:var(--danger);font-weight:700;font-size:13px">⚠ Review<br>needed</div>' : ''}
      </div>
      <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${st.pct}%;${stale ? 'background:var(--danger);opacity:.6' : ''}"></div></div>
      ${last ? `<div class="muted" style="font-size:12px;margin-top:8px">Last review: ${new Date(last).toLocaleDateString()}</div>` : ''}
    </div>`));

  // two large co-equal actions side by side — Practice + Review
  // (Review kept as prominent as Practice; its modes expand in upcoming phases)
  const actions = h(`<div class="row" style="margin-top:12px">
    <button class="btn" data-a="practice" style="margin-top:0;flex:1">Practice — ESV</button>
    <button class="btn" data-a="review" style="margin-top:0;flex:1">Review ⏱</button>
  </div>`).firstElementChild;
  actions.querySelector('[data-a=practice]').onclick = () => render(() => practiceScope(b));
  actions.querySelector('[data-a=review]').onclick = () => render(() => reviewTimer(b));
  wrap.append(actions);

  // chapters grid — core navigation for marking verses, directly beneath the actions
  wrap.append(sectionTitle('Chapters'));
  const grid = document.createElement('div');
  grid.className = 'grid';
  b.verses.forEach((_, ci) => {
    const c = SC.chapterStats(b, ci);
    const cell = document.createElement('div');
    cell.className = 'cell' + (c.done === c.total ? ' done' : c.done > 0 ? ' partial' : '');
    cell.textContent = ci + 1;
    cell.onclick = () => render(() => chapterScreen(b, ci));
    grid.append(cell);
  });
  wrap.append(grid);

  // secondary pill row → focused sheets
  const pills = h(`<div class="pillrow" style="margin-top:16px">
    <button class="pill" data-s="project">${isCurrent ? '✓ Project' : 'Project'}</button>
    <button class="pill" data-s="interval">Interval${days ? ' · ' + days + 'd' : ''}</button>
    <button class="pill" data-s="memorized">Memorized</button>
  </div>`);
  pills.querySelector('[data-s=project]').onclick = () => memProjectSheet(b);
  pills.querySelector('[data-s=interval]').onclick = () => memIntervalSheet(b);
  pills.querySelector('[data-s=memorized]').onclick = () => memMemorizedSheet(b);
  wrap.append(pills);

  main().append(wrap);
}
let bookUndoSnap = null;   // {book, snap} — survives within the session only

// Project sheet — current-memorization-project toggle + (when current) the finish-by pace control
function memProjectSheet(b) {
  openSheet('Memorization project', (body, close) => {
    const fill = () => {
      body.innerHTML = '';
      const isCurrent = (state.scripture.currentItems || []).some(it => it.book === b.name && it.ch == null);
      const tog = h(`<button class="btn secondary" style="margin-top:0">${isCurrent ? '✓ Current memorization project — tap to remove' : 'Set as current memorization project'}</button>`);
      tog.firstChild.onclick = () => {
        if (isCurrent) {
          const cur = state.scripture.currentItems.find(x => x.book === b.name && x.ch == null);
          SC.removeCurrentItem(cur.id);
          toast(b.name + ' removed from current projects');
        } else {
          SC.addCurrentItem(b.name, null);   // additive — multiple projects allowed (SM2)
          toast(b.name + ' is now a current project');
        }
        fill(); rerender();
      };
      body.append(tog);
      body.append(h(`<div class="muted" style="font-size:12px;margin:8px 4px 0">${isCurrent
        ? 'Set a finish-by date below for a self-adjusting verses/day pace — shown here and in Today, Week & Month.'
        : 'Make this a current project to give it a finish-by date and pace.'}</div>`));
      // 9.4 — finish-by date drives a verses/day pace (only while it's a current project)
      if (isCurrent) {
        const it = state.scripture.currentItems.find(x => x.book === b.name && x.ch == null);
        body.append(dueControl({
          label: 'Finish memorizing by',
          value: it.due, unit: 'verses', info: TG.memPaceInfo(it),
          onSet: v => { SC.setItemDue(it.id, v); fill(); rerender(); }
        }));
      }
    };
    fill();
  });
}

// Interval sheet — review requirement (how often before XP goes stale)
function memIntervalSheet(b) {
  openSheet('Review requirement', (body, close) => {
    const days = SC.reviewIntervalDays(b.name);
    const last = SC.lastReviewTs(b.name);
    const card = h(`<div>
      <div class="pillrow" style="margin-bottom:8px">
        ${INTERVALS.map(([d, l]) => `<button class="pill ${days === d ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}
      </div>
      <div class="muted" style="font-size:12px">${days
        ? `Must be reviewed every ${days} days or this book's XP is voided until reviewed. ${last ? 'Last review: ' + new Date(last).toLocaleDateString() : 'No timed review logged yet.'}`
        : 'No requirement — this book never goes stale.'}</div>
    </div>`).firstElementChild;
    card.querySelectorAll('[data-d]').forEach(btn => btn.onclick = () => {
      SC.setReviewInterval(b.name, Number(btn.dataset.d));
      close(); rerender();
    });
    body.append(card);
  });
}

// Memorized sheet — SM3 mark whole book memorized (undoable) + reset
function memMemorizedSheet(b) {
  openSheet('Memorized', (body, close) => {
    const st = SC.bookStats(b);
    const markBtn = h(`<button class="btn secondary" style="margin-top:0">${st.pct === 100 ? '✓ Whole book memorized' : 'Mark whole book memorized'}</button>`);
    markBtn.firstChild.onclick = () => {
      if (st.pct === 100) { toast('Already fully memorized'); return; }
      bookUndoSnap = { book: b.name, snap: SC.markBookMemorized(b) };
      toast(b.name + ' marked memorized — Undo available here');
      close(); rerender(); memMemorizedSheet(b);
    };
    body.append(markBtn);
    if (bookUndoSnap && bookUndoSnap.book === b.name) {
      const undo = h(`<button class="btn secondary" style="color:var(--gold)">Undo mark</button>`);
      undo.firstChild.onclick = () => {
        SC.restoreBookProgress(b, bookUndoSnap.snap);
        bookUndoSnap = null;
        toast('Restored previous progress');
        close(); rerender();
      };
      body.append(undo);
    }
    const reset = h(`<button class="btn secondary" style="color:var(--danger)">Reset this book</button>`);
    reset.firstChild.onclick = () => {
      if (!confirm('Erase all memorization progress for ' + b.name + '? Review history is kept.')) return;
      SC.resetBook(b);
      bookUndoSnap = null;
      toast(b.name + ' reset');
      close(); rerender();
    };
    body.append(reset);
  });
}

// SM5 — practice scope: whole book (≤28 chapters) / selected chapters / selected verses
const WHOLE_BOOK_CAP = 28;
let prScope = { book: null, mode: 'book', chapters: {}, vch: null, verses: {} };

function esvErrToast(e) {
  toast(e.message === 'no-key' ? 'Add your free ESV API key in Settings first'
    : e.message === 'bad-key' ? 'ESV key rejected — check it in Settings'
    : 'Could not load text — check your connection');
}

async function fetchChaptersProgress(b, cis, btn) {
  const parts = [];
  for (let i = 0; i < cis.length; i++) {
    btn.textContent = 'Fetching ' + b.name + ' ' + (cis[i] + 1) + ' — ' + (i + 1) + ' of ' + cis.length + '…';
    const entry = await esvFetchChapter(b.name, cis[i] + 1);
    parts.push({ ci: cis[i], verses: entry.verses });
  }
  return parts;
}

function practiceScope(b) {
  setHeader('Practice · ' + b.name, { back: true });
  if (prScope.book !== b.name) prScope = { book: b.name, mode: b.chapters <= WHOLE_BOOK_CAP ? 'book' : 'chapters', chapters: {}, vch: null, verses: {} };
  const s = prScope;
  const wrap = document.createElement('div');

  wrap.append(sectionTitle('Scope'));
  const pills = h(`<div class="pillrow">
    ${b.chapters <= WHOLE_BOOK_CAP ? `<button class="pill ${s.mode === 'book' ? 'on' : ''}" data-m="book">Whole book</button>` : ''}
    <button class="pill ${s.mode === 'chapters' ? 'on' : ''}" data-m="chapters">Chapters</button>
    <button class="pill ${s.mode === 'verses' ? 'on' : ''}" data-m="verses">Verses</button>
  </div>`);
  pills.querySelectorAll('[data-m]').forEach(p => p.onclick = () => { s.mode = p.dataset.m; rerender(); });
  wrap.append(pills);
  if (b.chapters > WHOLE_BOOK_CAP) wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Whole-book practice is capped at ${WHOLE_BOOK_CAP} chapters — use chapter or verse selection for ${esc(b.name)}.</div>`));

  if (s.mode === 'book') {
    wrap.append(h(`<div class="muted" style="margin:6px 4px 0">All ${b.chapters} chapters. Text is fetched once from the ESV API, then cached for offline practice.</div>`));
  }
  if (s.mode === 'chapters') {
    wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Tap the chapters to practice — any combination.</div>`));
    const grid = document.createElement('div');
    grid.className = 'grid';
    b.verses.forEach((_, ci) => {
      const cell = document.createElement('div');
      cell.className = 'cell' + (s.chapters[ci] ? ' done' : '');
      cell.textContent = ci + 1;
      cell.onclick = () => { s.chapters[ci] = !s.chapters[ci]; cell.classList.toggle('done'); };
      grid.append(cell);
    });
    wrap.append(grid);
  }
  if (s.mode === 'verses') {
    wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Pick one chapter, then tap the verses.</div>`));
    const grid = document.createElement('div');
    grid.className = 'grid';
    b.verses.forEach((_, ci) => {
      const cell = document.createElement('div');
      cell.className = 'cell' + (s.vch === ci ? ' done' : '');
      cell.textContent = ci + 1;
      cell.onclick = () => { s.vch = ci; s.verses = {}; rerender(); };
      grid.append(cell);
    });
    wrap.append(grid);
    if (s.vch != null) {
      wrap.append(sectionTitle(b.name + ' ' + (s.vch + 1) + ' — verses'));
      const vg = document.createElement('div');
      vg.className = 'grid';
      for (let v = 1; v <= b.verses[s.vch]; v++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (s.verses[v] ? ' done' : '');
        cell.textContent = v;
        cell.onclick = ((vv, c) => () => { s.verses[vv] = !s.verses[vv]; c.classList.toggle('done'); })(v, cell);
        vg.append(cell);
      }
      wrap.append(vg);
    }
  }

  const startFrag = h(`<button class="btn" style="margin-top:16px">Fetch text &amp; choose mode</button>`);
  const start = startFrag.firstChild;
  start.onclick = async () => {
    if (start.dataset.busy) return;
    let cis;
    if (s.mode === 'book') cis = b.verses.map((_, i) => i);
    else if (s.mode === 'chapters') {
      cis = Object.keys(s.chapters).filter(k => s.chapters[k]).map(Number).sort((x, y) => x - y);
      if (!cis.length) { toast('Tap at least one chapter'); return; }
    } else {
      if (s.vch == null) { toast('Pick a chapter first'); return; }
      if (!Object.keys(s.verses).some(k => s.verses[k])) { toast('Tap at least one verse'); return; }
      cis = [s.vch];
    }
    start.dataset.busy = '1';
    const orig = start.textContent;
    try {
      const parts = await fetchChaptersProgress(b, cis, start);
      delete start.dataset.busy;
      let doc;
      if (s.mode === 'verses') {
        const picks = Object.keys(s.verses).filter(k => s.verses[k]).map(Number);
        doc = bibleDoc(b, s.vch, parts[0].verses);
        doc.sections = doc.sections.filter(x => picks.includes(x.n));
      } else if (cis.length === 1) {
        doc = bibleDoc(b, cis[0], parts[0].verses);
      } else {
        doc = bibleMultiDoc(b, parts);
      }
      if (!doc.sections.length) { toast('No verses in that selection'); start.textContent = orig; return; }
      render(() => practiceSetup(doc));
    } catch (e) {
      delete start.dataset.busy;
      start.textContent = orig;
      esvErrToast(e);
    }
  };
  wrap.append(startFrag);
  main().append(wrap);
}

function chapterScreen(b, ci) {
  setHeader(b.name + ' ' + (ci + 1), { back: true });
  const wrap = document.createElement('div');

  // SM4 — next/previous chapter navigation (one at a time, both directions)
  const lastCi = b.verses.length - 1;
  if (lastCi > 0) {
    const nav = h(`<div class="row" style="margin-bottom:12px">
      <button class="btn secondary" data-a="prev" style="margin-top:0;flex:1;${ci === 0 ? 'visibility:hidden' : ''}">‹ ${SC.abbr(b.name)} ${ci}</button>
      <button class="btn secondary" data-a="next" style="margin-top:0;flex:1;${ci === lastCi ? 'visibility:hidden' : ''}">${SC.abbr(b.name)} ${ci + 2} ›</button>
    </div>`).firstElementChild;
    const go = to => { const s = () => chapterScreen(b, to); stack[stack.length - 1] = s; render(s, false); };
    nav.querySelector('[data-a=prev]').onclick = () => go(ci - 1);
    nav.querySelector('[data-a=next]').onclick = () => go(ci + 1);
    wrap.append(nav);
  }

  const c = SC.chapterStats(b, ci);
  const allDone = c.done === c.total;
  const toggleAll = h(`<button class="btn ${allDone ? 'secondary' : ''}" style="margin-bottom:12px">${allDone ? 'Unmark all verses' : 'Mark whole chapter memorized'}</button>`);
  toggleAll.firstChild.onclick = () => { SC.setChapter(b, ci, !allDone); render(() => chapterScreen(b, ci), false); };
  wrap.append(toggleAll);

  // SM2 — declare this chapter a standalone memorization item (gets its own review graph)
  const isItem = (state.scripture.currentItems || []).some(it => it.book === b.name && it.ch === ci + 1);
  const saBtn = h(`<button class="btn secondary" style="margin-bottom:12px">${isItem ? '✓ Standalone item — tap to remove' : 'Track as standalone memorization item'}</button>`);
  saBtn.firstChild.onclick = () => {
    if (isItem) {
      const it = state.scripture.currentItems.find(x => x.book === b.name && x.ch === ci + 1);
      SC.removeCurrentItem(it.id);
      toast('No longer a standalone item');
    } else {
      SC.addCurrentItem(b.name, ci + 1);
      toast(b.name + ' ' + (ci + 1) + ' is now a standalone item');
    }
    render(() => chapterScreen(b, ci), false);
  };
  wrap.append(saBtn);

  // 9.4 — finish-by date for a standalone chapter project
  if (isItem) {
    const it = state.scripture.currentItems.find(x => x.book === b.name && x.ch === ci + 1);
    wrap.append(dueControl({
      label: 'Finish memorizing by',
      value: it.due, unit: 'verses', info: TG.memPaceInfo(it),
      onSet: v => { SC.setItemDue(it.id, v); render(() => chapterScreen(b, ci), false); }
    }));
  }

  const grid = document.createElement('div');
  grid.className = 'grid';
  for (let v = 1; v <= b.verses[ci]; v++) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (SC.verseDone(b, ci, v) ? ' done' : '');
    cell.textContent = v;
    cell.onclick = () => { SC.toggleVerse(b, ci, v); cell.classList.toggle('done'); };
    grid.append(cell);
  }
  wrap.append(grid);

  const prFrag = h(`<button class="btn" style="margin-top:14px">Practice this chapter — ESV</button>`);
  const prB = prFrag.firstChild;
  prB.onclick = async () => {
    if (prB.dataset.busy) return;
    prB.dataset.busy = '1';
    const orig = prB.textContent;
    prB.textContent = 'Loading ESV text…';
    try {
      const entry = await esvFetchChapter(b.name, ci + 1);
      delete prB.dataset.busy;
      render(() => practiceSetup(bibleDoc(b, ci, entry.verses)));
    } catch (e) {
      delete prB.dataset.busy;
      prB.textContent = orig;
      esvErrToast(e);
    }
  };
  wrap.append(prFrag);
  wrap.append(h(`<div class="muted" style="font-size:11px;margin:6px 4px 0">Fade, First-Letter, Flashcards & Scramble on this chapter's ESV text. Fetched once, then works offline.</div>`));

  main().append(wrap);
}

function reviewTimer(b, presetScope = null) {
  setHeader('Review · ' + b.name, { back: true });
  const wrap = h(`
    <div class="card" style="text-align:center;padding:30px 14px">
      <div class="big" id="rt-clock" style="font-size:52px">0:00</div>
      <div class="muted" style="margin-top:4px">reviewing ${esc(b.name)}${presetScope ? ' · ' + SC.scopeLabel(presetScope) : ''}</div>
      ${presetScope ? '' : `<input id="rt-scope" placeholder="chapters — e.g. 5 or 1–7 · empty = whole book" style="width:100%;margin-top:14px;padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">`}
      <button class="btn" id="rt-done" style="margin-top:22px">Finish &amp; log</button>
      <button class="btn secondary" id="rt-peek" style="margin-top:10px">📖 View text — keeps timing</button>
      <div class="row" style="margin-top:10px;gap:8px">
        <input id="rt-manual" placeholder="or enter time — mm:ss" inputmode="numeric" style="flex:1;padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <button class="pill" id="rt-log" style="padding:11px 14px">Log</button>
      </div>
      <button class="btn secondary" id="rt-cancel">Cancel</button>
    </div>`);
  const el = document.createElement('div'); el.append(wrap);
  const sw = startStopwatch(() => el.querySelector('#rt-clock'));
  const logIt = (theSecs) => {
    let scope = presetScope;
    if (!scope) {
      const sc = SC.parseScopeInput(el.querySelector('#rt-scope') ? el.querySelector('#rt-scope').value : '', b);
      if (!sc.ok) { toast('Scope must be a chapter (5) or range (1–7) within ' + b.name); return; }
      scope = sc.scope;
    }
    sw.stop();
    SC.logReviewTime(b.name, theSecs, { scope });
    toast('Review logged — ' + SC.fmtSecs(theSecs) + (scope ? ' · ' + SC.scopeLabel(scope) : ''));
    goBack();
  };
  el.querySelector('#rt-done').onclick = () => logIt(sw.elapsed());
  el.querySelector('#rt-log').onclick = () => {
    const m = SC.parseDuration(el.querySelector('#rt-manual').value);
    if (m == null) { toast('Enter a time like 12:34 or 1:05:30'); return; }
    logIt(m);
  };
  // Phase 7.2 — peek at the text as a memory prompt without stopping the clock.
  // Opens as an overlay above this screen (not a navigation), so the timer node
  // stays mounted and the stopwatch keeps painting underneath.
  el.querySelector('#rt-peek').onclick = () => {
    let startCh = 1;
    if (presetScope) startCh = presetScope.kind === 'chapter' ? presetScope.ch : presetScope.from;
    else {
      const inp = el.querySelector('#rt-scope');
      const sc = inp ? SC.parseScopeInput(inp.value, b) : { ok: true, scope: null };
      if (sc.ok && sc.scope) startCh = sc.scope.kind === 'chapter' ? sc.scope.ch : sc.scope.from;
    }
    peekTextOverlay(b, Math.min(Math.max(1, startCh), b.chapters || 1));
  };
  el.querySelector('#rt-cancel').onclick = () => { sw.stop(); goBack(); };
  main().append(el);
}

// Phase 7.2 — full-screen text overlay for quick reference during a running review.
// Appended to <body>, so it floats above whatever timer screen invoked it without
// disturbing it. Chapter prev/next lets Baruch flip to whatever he needs as a prompt.
function peekTextOverlay(b, startCh) {
  const ov = h(`
    <div style="position:fixed;inset:0;z-index:200;background:var(--bg);display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line);background:var(--card)">
        <button class="pill" id="pk-prev" style="padding:9px 13px">‹</button>
        <div class="grow" style="text-align:center;font-family:var(--serif-display);font-size:13px;letter-spacing:.06em" id="pk-title">${esc(b.name)}</div>
        <button class="pill" id="pk-next" style="padding:9px 13px">›</button>
        <button class="pill" id="pk-close" style="padding:9px 13px">Close</button>
      </div>
      <div id="pk-body" style="flex:1;overflow:auto;padding:18px 18px 44px"></div>
    </div>`).firstElementChild;
  document.body.append(ov);
  const body = ov.querySelector('#pk-body');
  const title = ov.querySelector('#pk-title');
  const prev = ov.querySelector('#pk-prev');
  const next = ov.querySelector('#pk-next');
  const maxCh = b.chapters || 1;
  let cur = startCh;
  const load = async () => {
    title.textContent = b.name + ' ' + cur;
    prev.style.visibility = cur > 1 ? '' : 'hidden';
    next.style.visibility = cur < maxCh ? '' : 'hidden';
    body.innerHTML = '<div class="muted" style="text-align:center;margin-top:36px">Loading…</div>';
    try {
      const entry = await esvFetchChapter(b.name, cur);
      const vs = entry.verses;
      body.innerHTML = '';
      body.append(h(`<div style="font-family:var(--serif-body);font-size:19px;line-height:1.7;color:var(--text)">${
        Object.keys(vs).map(Number).sort((x, y) => x - y)
          .map(v => `<sup style="color:var(--gold);font-size:10px;font-family:var(--serif-body)">${v}</sup> ${esc(vs[v])}`).join(' ')
      }</div>`));
    } catch (e) {
      body.innerHTML = '';
      const msg = e.message === 'no-key' ? 'Add your ESV key in Settings to view text here.'
        : e.message === 'network' ? 'Offline — this chapter isn’t cached yet.'
        : 'Could not load the text.';
      body.append(h(`<div class="muted" style="text-align:center;margin-top:36px">${msg}</div>`));
    }
  };
  prev.onclick = () => { if (cur > 1) { cur--; load(); } };
  next.onclick = () => { if (cur < maxCh) { cur++; load(); } };
  ov.querySelector('#pk-close').onclick = () => ov.remove();
  load();
}

// B7 fix — `fmt` formats the corner labels, `hiLabel`/`loLabel` name them.
// Defaults keep the review-time behaviour; the weight chart passes its own so
// pounds are no longer run through fmtSecs and rendered as durations.
function timesGraph(entriesAsc, { fmt = SC.fmtSecs, hiLabel = 'slowest', loLabel = 'fastest' } = {}) {
  if (entriesAsc.length < 2) return '';
  const w = 300, hgt = 80, pad = 8;
  const min = Math.min(...entriesAsc.map(e => e.secs));
  const max = Math.max(...entriesAsc.map(e => e.secs));
  const span = (max - min) || 1;
  const pt = (e, i) => {
    const x = pad + i * (w - 2 * pad) / (entriesAsc.length - 1);
    const y = hgt - pad - (e.secs - min) * (hgt - 2 * pad) / span;
    return [x, y];
  };
  const line = entriesAsc.map((e, i) => pt(e, i).map(n => n.toFixed(1)).join(',')).join(' ');
  const dots = entriesAsc.map((e, i) => {
    const [x, y] = pt(e, i);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--accent)"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${hgt}" style="width:100%;height:auto;margin-top:10px">
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}
    <text x="${pad}" y="10" font-size="9" fill="var(--text-2)">${hiLabel} ${fmt(max)}</text>
    <text x="${pad}" y="${hgt - 1}" font-size="9" fill="var(--text-2)">${loLabel} ${fmt(min)}</text>
  </svg>`;
}

// multi-line review graph: one line per series, shared time axis, small legend
const SERIES_COLORS = ['var(--accent)', 'var(--midnight)', 'var(--forest)', 'var(--gold)', 'var(--ember)', 'var(--danger)', '#7a5c8a', '#4a7a8a'];
function multiGraph(series) {   // [{label, entries}] — entries any order
  const all = series.flatMap(s => s.entries);
  if (all.length < 2) return '';
  const w = 300, hgt = 90, pad = 8;
  const min = Math.min(...all.map(e => e.secs)), max = Math.max(...all.map(e => e.secs));
  const t0 = Math.min(...all.map(e => e.ts)), t1 = Math.max(...all.map(e => e.ts));
  const spanS = (max - min) || 1, spanT = (t1 - t0) || 1;
  const px = e => pad + (e.ts - t0) * (w - 2 * pad) / spanT;
  const py = e => hgt - pad - (e.secs - min) * (hgt - 2 * pad) / spanS;
  let svg = '', legend = '';
  series.forEach((s, i) => {
    if (!s.entries.length) return;
    const col = SERIES_COLORS[i % SERIES_COLORS.length];
    const asc = [...s.entries].sort((a, c) => a.ts - c.ts);
    if (asc.length > 1) svg += `<polyline points="${asc.map(e => px(e).toFixed(1) + ',' + py(e).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
    svg += asc.map(e => `<circle cx="${px(e).toFixed(1)}" cy="${py(e).toFixed(1)}" r="3" fill="${col}"/>` +
      (e.pl ? `<text x="${px(e).toFixed(1)}" y="${(py(e) - 6).toFixed(1)}" font-size="8" text-anchor="middle" fill="var(--text-2)">${e.pl}</text>` : '')).join('');
    legend += `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--text-2)"><span style="width:10px;height:2.5px;background:${col};display:inline-block"></span>${esc(s.label)}</span>`;
  });
  return `<svg viewBox="0 0 ${w} ${hgt}" style="width:100%;height:auto;margin-top:10px">
    ${svg}
    <text x="${pad}" y="10" font-size="9" fill="var(--text-2)">slowest ${SC.fmtSecs(max)}</text>
    <text x="${pad}" y="${hgt - 1}" font-size="9" fill="var(--text-2)">fastest ${SC.fmtSecs(min)}</text>
  </svg>
  <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">${legend}</div>`;
}

let timesOpen = null;   // book name whose entry list is expanded

function reviewArea() {
  setHeader('Scripture Review', { back: true });
  const wrap = document.createElement('div');
  main().append(wrap);
  renderTimes(wrap);
}

function renderTimes(container) {
  // manual entry
  const entry = h(`
    <div class="card"><h3>Log a review</h3>
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <select data-a="book" style="flex:1;min-width:120px;padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
          ${SC.allBooks.map(b => `<option${SC.bookStats(b).done > 0 ? '' : ''}>${esc(b.name)}</option>`).join('')}
        </select>
        <input data-a="date" type="date" value="${todayKey()}" style="padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
        <input data-a="scope" placeholder="chapters — e.g. 5 or 1–7 · empty = whole book" style="flex-basis:100%;padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
        <input data-a="dur" placeholder="mm:ss" inputmode="numeric" style="width:76px;padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <button class="pill on" data-a="add" style="padding:11px 16px">Add</button>
      </div>
    </div>`).firstElementChild;
  entry.querySelector('[data-a=add]').onclick = () => {
    const book = entry.querySelector('[data-a=book]').value;
    const dateStr = entry.querySelector('[data-a=date]').value;
    const secs = SC.parseDuration(entry.querySelector('[data-a=dur]').value);
    if (secs == null) { toast('Enter a time like 12:34 or 1:05:30'); return; }
    const bookObj = SC.allBooks.find(x => x.name === book);
    const sc = SC.parseScopeInput(entry.querySelector('[data-a=scope]').value, bookObj);
    if (!sc.ok) { toast('Scope must be a chapter (5) or range (1–7) within ' + book); return; }
    const ts = dateStr ? new Date(dateStr + 'T12:00:00').getTime() : Date.now();
    SC.logReviewTime(book, secs, { ts, scope: sc.scope });
    toast('Logged ' + SC.fmtSecs(secs) + ' for ' + book + (sc.scope ? ' · ' + SC.scopeLabel(sc.scope) : ''));
    rerender();
  };
  container.append(entry);

  // SM1 — entry-driven classification (agreed rules, July 2026):
  //   whole-book time            → OT/NT corpus graph, one line per book, always
  //   chapter/range, book is a current project (or any range) → that book's graph, points labeled
  //   chapter, any other book    → shared Individual Chapters graph, one line per chapter
  const projectSet = new Set((state.scripture.currentItems || []).filter(it => it.ch == null).map(it => it.book));
  const shortScope = e => !e.scope ? 'all' : e.scope.kind === 'chapter' ? String(e.scope.ch) : e.scope.from + '–' + e.scope.to;

  const corpus = { ot: {}, nt: {} };   // book → entries (whole-book)
  const bookGraphs = {};               // book → entries (chapter/range, project books or ranges)
  const chSeries = {};                 // 'Book N' → entries (chapter, non-project books)
  SC.allBooks.forEach(b => {
    SC.reviewHistory(b.name).forEach(e => {
      const entry = { ...e, book: b.name };
      if (!e.scope) { (corpus[b.t][b.name] = corpus[b.t][b.name] || []).push(entry); return; }
      if (projectSet.has(b.name) || e.scope.kind === 'range') {
        entry.pl = shortScope(e);
        (bookGraphs[b.name] = bookGraphs[b.name] || []).push(entry);
        return;
      }
      const k = b.name + ' ' + e.scope.ch;
      (chSeries[k] = chSeries[k] || []).push(entry);
    });
  });
  // project books with no scoped entries yet still deserve their card
  projectSet.forEach(name => { if (!bookGraphs[name]) bookGraphs[name] = []; });

  if (!Object.keys(corpus.ot).length && !Object.keys(corpus.nt).length && !Object.keys(bookGraphs).length && !Object.keys(chSeries).length) {
    container.append(h(`<div class="empty">Nothing to review yet.<br>Log one above, use a book's review timer,<br>or time a pathway step.</div>`));
    return;
  }

  // card: title + stats + supplied graph + expandable log
  const seriesCard = (key, title, sub, logEntries, graphHtml) => {
    const fastest = logEntries.length ? logEntries.reduce((a, c) => c.secs < a.secs ? c : a) : null;
    const avg = logEntries.length ? Math.round(logEntries.reduce((a, c) => a + c.secs, 0) / logEntries.length) : 0;
    const open = timesOpen === key;
    const card = h(`
      <div class="card">
        <div class="row" data-a="head" style="cursor:pointer">
          <div class="grow"><div class="title" style="font-size:15px;font-weight:600">${title}</div>
            <div class="sub" style="font-size:12px;color:var(--text-2)">${sub}</div></div>
          <span class="chev">${open ? '▾' : '▸'}</span>
        </div>
        ${logEntries.length ? `<div class="statgrid" style="margin-top:10px">
          <div class="stat"><div class="v">${SC.fmtSecs(fastest.secs)}</div><div class="l">Fastest</div></div>
          <div class="stat"><div class="v">${SC.fmtSecs(avg)}</div><div class="l">Average · ${logEntries.length} reviews</div></div>
        </div>` : '<div class="muted" style="margin-top:8px">No reviews logged yet.</div>'}
        ${graphHtml || ''}
        <div data-a="list"></div>
      </div>`);
    card.querySelector('[data-a=head]').onclick = () => { timesOpen = open ? null : key; rerender(); };
    if (open) {
      const list = card.querySelector('[data-a=list]');
      [...logEntries].sort((a, c) => c.ts - a.ts).forEach(e => {
        const row = h(`
          <div class="row" style="padding:8px 2px;border-top:1px solid var(--line);margin-top:8px">
            <div class="grow"><span style="font-weight:700">${SC.fmtSecs(e.secs)}</span>
              <span class="muted" style="margin-left:8px">${esc(e.book)} · ${SC.scopeLabel(e.scope)} · ${new Date(e.ts).toLocaleDateString()}</span></div>
            <button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>
          </div>`);
        row.querySelector('button').onclick = () => { SC.removeReviewTime(e.book, e.ts); toast('Entry removed'); rerender(); };
        list.append(row);
      });
    }
    return card;
  };

  // 1 & 2 — corpus graphs
  [['ot', 'OT', 'Old Testament'], ['nt', 'NT', 'New Testament']].forEach(([t, key, label]) => {
    const names = Object.keys(corpus[t]).sort();
    if (!names.length) return;
    const series = names.map(n => ({ label: n, entries: corpus[t][n] }));
    const logs = names.flatMap(n => corpus[t][n]);
    container.append(sectionTitle(label));
    container.append(seriesCard(key, label, names.length + ' book' + (names.length === 1 ? '' : 's') + ' · one line each · whole-book times', logs, multiGraph(series)));
  });

  // 3 — all individual chapters, one graph
  const chKeys = Object.keys(chSeries).sort();
  if (chKeys.length) {
    const series = chKeys.map(k => ({ label: k, entries: chSeries[k] }));
    container.append(sectionTitle('Individual chapters'));
    container.append(seriesCard('CH', 'Individual chapters', chKeys.length + ' chapter' + (chKeys.length === 1 ? '' : 's') + ' · one line each', chKeys.flatMap(k => chSeries[k]), multiGraph(series)));
  }

  // 4 — one graph per current project book, points labeled by chapters
  const projNames = Object.keys(bookGraphs).sort();
  if (projNames.length) {
    container.append(sectionTitle('Books in progress'));
    projNames.forEach(name => {
      const entries = bookGraphs[name];
      container.append(seriesCard('bk:' + name, name, 'chapter & range reviews · points show chapters', entries, multiGraph([{ label: name, entries }])));
    });
  }
}

// ---------- Reading ----------
let rdSort = 'status';   // Phase 6 (R4/R5): one list, every book, sortable
const RD_SORTS = [['status', 'Status'], ['title', 'Title'], ['author', 'Author'], ['category', 'Category']];
const RD_BADGE = {
  reading: ['READING', 'var(--accent)'], upnext: ['UP NEXT', 'var(--midnight)'],
  library: ['LIBRARY', 'var(--text-3)'], finished: ['FINISHED', 'var(--forest)']
};

function readingHome() {
  setHeader('Reading', { back: true });
  const wrap = document.createElement('div');
  const lib = RD.libraryLevel(), life = RD.lifetime();
  wrap.append(h(`
    <div class="card">
      <div class="row" style="gap:14px">
        <div class="grow"><div class="big">${lib.level}</div><div class="muted">library level · ${lib.finished}/${lib.total} finished</div></div>
        <div style="text-align:right"><div style="font-weight:700">${life.booksFinished} books</div><div class="muted" style="font-size:12px">${life.pagesRead.toLocaleString()} pages read</div></div>
      </div>
      <div class="progressbar" style="margin-top:8px"><div style="width:${lib.level}%"></div></div>
    </div>`));

  const research = h(`<div class="list-item" style="margin-bottom:12px"><div class="grow">
    <div class="title" style="font-size:14px">Research</div>
    <div class="sub">Search quotes &amp; questions across every book by tag or text.</div></div><span class="chev">›</span></div>`);
  research.querySelector('.list-item').onclick = () => render(researchScreen);
  wrap.append(research);

  const pills = h(`<div class="pillrow">${RD_SORTS.map(([m, l]) =>
    `<button class="pill ${rdSort === m ? 'on' : ''}" data-m="${m}">${l}</button>`).join('')}</div>`);
  pills.querySelectorAll('.pill').forEach(b => b.onclick = () => { rdSort = b.dataset.m; rerender(); });
  wrap.append(pills);

  const list = RD.allSorted(rdSort);
  const upnextOrder = RD.byStatus('upnext');
  list.forEach(b => {
    const est = RD.estimate(b);
    const [bl, bc] = RD_BADGE[b.status] || RD_BADGE.library;
    const qPos = b.status === 'upnext' ? upnextOrder.indexOf(b) + 1 : 0;
    const showQueue = rdSort === 'status' && b.status === 'upnext';
    const el = h(`
      <div class="list-item">
        ${showQueue ? `<div style="display:flex;flex-direction:column;gap:2px">
          <button data-a="up" style="border:1px solid var(--line);background:var(--card);border-radius:3px;font-size:11px;padding:2px 7px;cursor:pointer;color:var(--text)">▲</button>
          <button data-a="down" style="border:1px solid var(--line);background:var(--card);border-radius:3px;font-size:11px;padding:2px 7px;cursor:pointer;color:var(--text)">▼</button>
        </div>` : ''}
        <div class="grow">
          <div class="title">${esc(b.title)}</div>
          <div class="sub">${esc(b.author || '')}${b.category ? (b.author ? ' · ' : '') + esc(b.category) : ''}${b.pages ? ((b.author || b.category) ? ' · ' : '') + b.pages + ' pages' : ''}${b.status === 'reading' ? ' · ' + RD.pct(b) + '%' + (est ? ' · ~' + est.days + 'd left' : '') : ''}${b.status === 'finished' && b.finishedTs ? ' · ' + new Date(b.finishedTs).toLocaleDateString() : ''}</div>
          ${b.status === 'reading' ? `<div class="progressbar" style="margin-top:6px"><div style="width:${RD.pct(b)}%"></div></div>` : ''}
        </div>
        <span class="badge" style="background:${bc}">${bl}${qPos ? ' ' + qPos : ''}</span>
        <span class="chev">›</span>
      </div>`);
    el.querySelector('.list-item').onclick = () => render(() => bookDetail(b));
    const up = el.querySelector('[data-a=up]'), down = el.querySelector('[data-a=down]');
    if (up) up.onclick = e => { e.stopPropagation(); RD.moveInQueue(b, -1); rerender(); };
    if (down) down.onclick = e => { e.stopPropagation(); RD.moveInQueue(b, 1); rerender(); };
    wrap.append(el);
  });
  if (!list.length) wrap.append(h(`<div class="empty">No books yet. Add everything you want to read — the Library is unlimited.</div>`));

  const addCard = h(`
    <div class="card" style="margin-top:14px"><h3>Add a book</h3>
      <input data-a="title" placeholder="Title" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;margin-bottom:8px">
      <div class="row" style="margin-bottom:8px">
        <input data-a="author" placeholder="Author" style="flex:1;min-width:0;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px">
        <input data-a="pages" placeholder="Pages" inputmode="numeric" style="width:70px;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <input data-a="chapters" placeholder="Ch." inputmode="numeric" style="width:56px;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
      </div>
      <input data-a="cat" list="rd-cats" placeholder="Category (type to create or pick)" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px">
      <datalist id="rd-cats">${(state.reading.categories || []).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <button class="btn" data-a="add">Add to Library</button>
    </div>`).firstElementChild;
  addCard.querySelector('[data-a=add]').onclick = () => {
    const title = addCard.querySelector('[data-a=title]').value.trim();
    if (!title) { toast('Give the book a title'); return; }
    const cat = addCard.querySelector('[data-a=cat]').value.trim();
    if (cat) RD.addCategory(cat);
    RD.addBook({
      title,
      author: addCard.querySelector('[data-a=author]').value,
      pages: addCard.querySelector('[data-a=pages]').value,
      chapters: addCard.querySelector('[data-a=chapters]').value,
      category: cat || null
    });
    toast('Added to Library');
    rerender();
    requestAnimationFrame(() => { const t = main().querySelector('[data-a=title]'); if (t) t.focus(); });
  };
  wrap.append(addCard);
  main().append(wrap);
}

let rdNoteMode = 'summaries';

// ---- reusable bottom sheet (D-X) — a focused overlay for one action; dismiss to return ----
function openSheet(title, build) {
  const back = document.createElement('div');
  back.style.cssText = 'position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.38);display:flex;flex-direction:column;justify-content:flex-end';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:var(--card);border-top-left-radius:14px;border-top-right-radius:14px;max-height:88vh;overflow:auto;padding:4px 16px 26px;box-shadow:0 -8px 30px rgba(0,0,0,.28)';
  panel.innerHTML = `<div style="display:flex;justify-content:center;padding:8px 0 6px"><div style="width:38px;height:4px;border-radius:2px;background:var(--line)"></div></div>
    <div class="row" style="align-items:center;margin-bottom:12px"><h3 style="border:none;margin:0;padding:0;flex:1">${esc(title)}</h3><button data-a="x" style="border:none;background:none;color:var(--text-2);font-size:24px;line-height:1;cursor:pointer">×</button></div>`;
  const body = document.createElement('div');
  panel.append(body);
  back.append(panel);
  const close = () => back.remove();
  back.onclick = e => { if (e.target === back) close(); };
  panel.querySelector('[data-a=x]').onclick = close;
  build(body, close);
  document.body.append(back);
  return close;
}

function bookDetail(b) {
  setHeader(b.title, { back: true });
  const wrap = document.createElement('div');
  const est = RD.estimate(b);
  const curCh = RD.currentChapter(b);

  // status card
  wrap.append(h(`
    <div class="card">
      <div class="row">
        <div class="grow"><div class="big">${RD.pct(b)}%</div>
        <div class="muted">${esc(b.author || '')}${b.pages ? (b.author ? ' · ' : '') + 'p. ' + (b.currentPage || 0) + ' of ' + b.pages : ''}</div>
        ${curCh ? `<div class="muted" style="font-size:12px;color:var(--accent);font-weight:600">📖 Ch. ${curCh.n}${curCh.title ? ' — ' + esc(curCh.title) : ''}</div>` : ''}
        ${est ? `<div class="muted" style="font-size:12px">~${est.pace.toFixed(0)} pages/day · ~${est.days} days left · done ${est.finish.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>` : ''}
        ${(() => { const pi = TG.readPaceInfo(b); return pi ? `<div style="font-size:12px;font-weight:600;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? 'Overdue — ' + pi.remaining + ' pages left, due now' : pi.perDay + ' pages/day to finish by ' + shortDate(b.due)}</div>` : ''; })()}</div>
        <div style="text-align:right"><span class="badge" style="background:var(--accent)">${{ library: 'Library', upnext: 'Up Next', reading: 'Reading', finished: 'Finished' }[b.status]}</span></div>
      </div>
      <div class="progressbar" style="margin-top:8px"><div style="width:${RD.pct(b)}%"></div></div>
    </div>`));

  // primary action: Log progress while reading; otherwise the natural next status move
  if (b.status === 'reading') {
    const log = h(`
      <div class="card"><h3>Log progress</h3>
        <div class="row">
          <input data-a="page" placeholder="Page you're on" inputmode="numeric" style="flex:1;min-width:0;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px">
          <button class="pill on" data-a="log" style="padding:11px 16px">Log</button>
        </div>
      </div>`).firstElementChild;
    log.querySelector('[data-a=log]').onclick = () => {
      const pg = Number(log.querySelector('[data-a=page]').value);
      if (!pg && pg !== 0) { toast('Enter the page number'); return; }
      RD.logPage(b, pg);
      toast('Progress logged — ' + RD.pct(b) + '%');
      rerender();
    };
    wrap.append(log);
  } else {
    const primary = { library: ['Move to Up Next', 'upnext'], upnext: ['Start Reading', 'reading'], finished: ['Re-read — back to Reading', 'reading'] }[b.status];
    if (primary) {
      const pb = h(`<button class="btn">${primary[0]}</button>`);
      pb.firstChild.onclick = () => {
        const r = RD.setStatus(b, primary[1]); if (!r.ok) { toast(r.reason); return; }
        rerender();
      };
      wrap.append(pb);
    }
  }

  // pill row — each opens a focused sheet (or its full editor)
  const pills = h(`<div class="pillrow" style="margin-top:12px">
    <button class="pill" data-s="due">Finish by</button>
    <button class="pill" data-s="notes">Notes</button>
    <button class="pill" data-s="details">Details</button>
    <button class="pill" data-s="chapters">${b.chapterList && b.chapterList.length ? 'Chapters (' + b.chapterList.length + ')' : 'Chapters'}</button>
    <button class="pill" data-s="status">Status</button>
    <button class="pill" data-s="remove" style="color:var(--danger)">Remove</button>
  </div>`);
  pills.querySelector('[data-s=due]').onclick = () => bookDueSheet(b);
  pills.querySelector('[data-s=notes]').onclick = () => render(() => bookNotes(b));
  pills.querySelector('[data-s=details]').onclick = () => bookDetailsSheet(b);
  pills.querySelector('[data-s=chapters]').onclick = () => render(() => chapterEditor(b));
  pills.querySelector('[data-s=status]').onclick = () => bookStatusSheet(b);
  pills.querySelector('[data-s=remove]').onclick = () => bookRemoveSheet(b);
  wrap.append(pills);

  main().append(wrap);
}

// Finish-by (due date) sheet — reuses the shared dueControl
function bookDueSheet(b) {
  openSheet('Finish by', (body, close) => {
    body.append(dueControl({
      label: 'Finish by',
      hint: 'Set a date for a self-adjusting daily page pace — shows here and in Today, Week & Month.',
      value: b.due, unit: 'pages', info: TG.readPaceInfo(b),
      onSet: v => { RD.setBookDue(b, v); toast(v ? 'Target set' : 'Target cleared'); close(); rerender(); }
    }));
  });
}

// Details sheet — category + front matter
function bookDetailsSheet(b) {
  openSheet('Details', (body, close) => {
    const FIN2 = 'padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px';
    const det = h(`<div>
      <div class="row" style="margin-bottom:10px">
        <span class="muted" style="width:74px;font-size:13px">Category</span>
        <input data-a="cat" list="rd-cats-d" value="${esc(b.category || '')}" placeholder="type to create or pick" style="flex:1;min-width:0;${FIN2}">
        <datalist id="rd-cats-d">${(state.reading.categories || []).map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      </div>
      <div class="row">
        <span class="muted" style="width:74px;font-size:13px">Preface</span>
        <input data-a="pr" value="${b.prefaceRead || ''}" placeholder="read" inputmode="numeric" style="width:64px;${FIN2};text-align:center">
        <span class="muted" style="font-size:13px">of</span>
        <input data-a="pp" value="${b.prefacePages || ''}" placeholder="pages" inputmode="numeric" style="width:64px;${FIN2};text-align:center">
        <div class="grow muted" style="font-size:11px">roman-numeral pages — count toward %</div>
      </div>
      <button class="btn" data-a="save" style="margin-top:14px">Save details</button>
    </div>`).firstElementChild;
    det.querySelector('[data-a=save]').onclick = () => {
      RD.setBookCategory(b, det.querySelector('[data-a=cat]').value.trim());
      RD.setPrefacePages(b, det.querySelector('[data-a=pp]').value);
      RD.logPreface(b, det.querySelector('[data-a=pr]').value);
      toast('Details saved — ' + RD.pct(b) + '%');
      close(); rerender();
    };
    body.append(det);
  });
}

// Status sheet — every valid move for the current status
function bookStatusSheet(b) {
  openSheet('Status', (body, close) => {
    const moves = [];
    if (b.status === 'library') moves.push(['Move to Up Next', 'upnext']);
    if (b.status === 'upnext') moves.push(['Start Reading', 'reading'], ['Back to Library', 'library']);
    if (b.status === 'reading') moves.push(['Mark Finished 🎉', 'finished'], ['Pause — back to Up Next', 'upnext']);
    if (b.status === 'finished') moves.push(['Re-read — back to Reading', 'reading']);
    moves.forEach(([label, status]) => {
      const btn = h(`<button class="btn ${status === 'finished' || status === 'reading' ? '' : 'secondary'}">${label}</button>`);
      btn.firstChild.onclick = () => {
        const r = RD.setStatus(b, status); if (!r.ok) { toast(r.reason); return; }
        if (status === 'finished') celebrate('Book finished! 📚');
        close(); rerender();
      };
      body.append(btn);
    });
  });
}

// Remove sheet — destructive, explicit
function bookRemoveSheet(b) {
  openSheet('Remove book', (body, close) => {
    body.append(h(`<div class="muted" style="margin-bottom:14px">Remove “${esc(b.title)}” and its notes, quotes and questions? This can't be undone.</div>`));
    const del = h(`<button class="btn danger">Remove this book</button>`);
    del.firstChild.onclick = () => { RD.removeBook(b.id); toast('Book removed'); close(); goBack(); };
    body.append(del);
    const cancel = h(`<button class="btn secondary">Cancel</button>`);
    cancel.firstChild.onclick = close;
    body.append(cancel);
  });
}

// Notes — a full sub-screen (summaries / quotes / questions), opened from the Notes pill
function bookNotes(b) {
  setHeader('Notes · ' + b.title, { back: true });
  const wrap = document.createElement('div');
  const notePills = h(`<div class="pillrow">
    <button class="pill ${rdNoteMode === 'summaries' ? 'on' : ''}" data-n="summaries">Summaries</button>
    <button class="pill ${rdNoteMode === 'quotes' ? 'on' : ''}" data-n="quotes">Quotes (${b.quotes.length})</button>
    <button class="pill ${rdNoteMode === 'questions' ? 'on' : ''}" data-n="questions">Questions (${b.questions.length})</button>
  </div>`);
  notePills.querySelectorAll('.pill').forEach(x => x.onclick = () => { rdNoteMode = x.dataset.n; rerender(); });
  wrap.append(notePills);
  const noteBody = document.createElement('div');
  if (rdNoteMode === 'summaries') renderSummaries(noteBody, b);
  if (rdNoteMode === 'quotes') renderQuotes(noteBody, b);
  if (rdNoteMode === 'questions') renderQuestions(noteBody, b);
  wrap.append(noteBody);
  main().append(wrap);
}
// ---- TOC scan (camera + on-device OCR) & chapter editor ----
let tessPromise = null;
function loadTesseract() {
  if (!tessPromise) {
    tessPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tessPromise = null; reject(new Error('load failed')); };
      document.head.append(s);
    });
  }
  return tessPromise;
}

// "The Long Winter ........ 187" / "3  The Long Winter  187" → {title, page}
function parseTocText(text) {
  const rows = [];
  text.split('\n').forEach(line => {
    let s = line.trim().replace(/[.·•_]{2,}/g, ' ');
    if (!s || s.length < 3) return;
    const m = s.match(/^(?:(?:chapter\s+)?\d{1,3}[.):]?\s+)?(.+?)\s+(\d{1,4})$/i);
    if (m && m[1].replace(/[^a-zA-Z]/g, '').length >= 2) {
      rows.push({ title: m[1].trim(), page: Number(m[2]) });
    }
  });
  return rows;
}

// initialStatus carries the scan result line across the re-render that loads new rows —
// without it the "found N rows via …" message is built and then immediately discarded.
function chapterEditor(b, initialRows = null, initialStatus = '') {
  setHeader('Chapters · ' + b.title, { back: true });
  const wrap = document.createElement('div');
  const rows = initialRows || (b.chapterList ? b.chapterList.map(c => ({ ...c })) : []);
  if (!rows.length) rows.push({ title: '', page: '' });

  wrap.append(h(`<div class="muted" style="margin:2px 4px 10px">Chapter titles and the page each starts on. These become the book's milestones — edit freely.</div>`));

  // R3 — multi-image scan: photograph pages one at a time, or choose several photos at once.
  // Results append to whatever is already in the editor, so long TOCs build up across pages.
  const scan = h(`
    <div class="card"><h3>Scan a table of contents</h3>
      <input data-a="cam" type="file" accept="image/*" capture="environment" style="display:none">
      <input data-a="files" type="file" accept="image/*" multiple style="display:none">
      <div class="row">
        <button class="btn secondary" data-a="shoot" style="flex:1;margin-top:0">📷 Photograph a page</button>
        <button class="btn secondary" data-a="pick" style="flex:1;margin-top:0">🖼 Choose photos</button>
      </div>
      <div class="muted" data-a="status" style="font-size:12px;margin-top:6px">Multi-page TOC? Choose all the pages at once — read together, subheadings are judged across the whole table, so a page holding only subheadings is handled correctly. Scanning one at a time also works, but each page is then judged alone. Use ⌃ to rejoin a title that came through split.</div>
    </div>`).firstElementChild;
  const camInp = scan.querySelector('[data-a=cam]');
  const filesInp = scan.querySelector('[data-a=files]');
  const status = scan.querySelector('[data-a=status]');
  if (initialStatus) status.textContent = initialStatus;
  scan.querySelector('[data-a=shoot]').onclick = () => camInp.click();
  scan.querySelector('[data-a=pick]').onclick = () => filesInp.click();
  // Phase 6.1 — vision first, Tesseract as fallback. Which engine ran is always named in
  // the status line: a scan that silently degraded to the weaker parser and produced junk
  // is otherwise impossible to tell apart from a bad photo.
  const runOcr = async files => {
    if (!files.length) return;
    const kept = rows.filter(r => String(r.title).trim() || r.page);
    const found = [];
    let prefaceSeen = 0, flatSeen = false, usedFallback = false, visionErr = null;

    // All the photos picked in one go are pages of the same table, so they go to the
    // model in ONE call — hierarchy can only be judged across the whole table. Tesseract
    // has no cross-page notion at all, so its fallback still loops image by image.
    let visionDone = false;
    if (VIS.visionReady()) {
      status.textContent = files.length > 1
        ? 'Reading ' + files.length + ' pages together (vision)…'
        : 'Reading (vision)…';
      try {
        const out = await VIS.visionScanToc(files);
        found.push(...out.rows);
        prefaceSeen = out.prefacePages;
        flatSeen = !out.structured;
        visionDone = true;
      } catch (err) {
        visionErr = err.message;
        if (err.message === 'bad-key') status.textContent = 'Vision key rejected — falling back…';
      }
    }

    if (!visionDone) {
      usedFallback = true;
      for (let i = 0; i < files.length; i++) {
        const tag = files.length > 1 ? 'Image ' + (i + 1) + ' of ' + files.length + ' — ' : '';
        status.textContent = tag + 'reading (offline OCR)…';
        try {
          const T = await loadTesseract();
          const r = await T.recognize(files[i], 'eng', { logger: m => { if (m.status === 'recognizing text') status.textContent = tag + 'reading (offline OCR)… ' + Math.round(m.progress * 100) + '%'; } });
          found.push(...parseTocText(r.data.text));
        } catch (err) {
          status.textContent = 'Scan unavailable (offline?). Enter chapters manually below.';
          return;
        }
      }
    }

    if (!found.length) {
      status.textContent = usedFallback
        ? 'Couldn\'t find "title … page" lines — try straighter, closer photos, or enter manually below.'
        : 'No chapters found in that image — try a closer photo, or enter manually below.';
      return;
    }

    if (prefaceSeen && !b.prefacePages) RD.setPrefacePages(b, prefaceSeen);

    const engine = usedFallback
      ? (VIS.visionKey() ? 'offline OCR — vision failed (' + (visionErr || 'unknown') + ')' : 'offline OCR — add a vision key in Settings for better accuracy')
      : 'vision';
    const msg = 'Found ' + found.length + ' rows via ' + engine
      + (!usedFallback && files.length > 1 ? ' (' + files.length + ' pages read together)' : '') + '.'
      + (flatSeen ? ' No chapter/subheading hierarchy detected, so every entry came through as a chapter.' : '')
      + (prefaceSeen ? ' Preface pages set to ' + prefaceSeen + '.' : '')
      + ' Review below.';
    status.textContent = msg;
    render(() => chapterEditor(b, [...kept, ...found], msg), false);
  };
  camInp.onchange = e => { runOcr([...e.target.files]); e.target.value = ''; };
  filesInp.onchange = e => { runOcr([...e.target.files]); e.target.value = ''; };
  wrap.append(scan);

  const list = document.createElement('div');
  const ROLE_LABEL = { chapter: 'Ch', intro: 'Intro', conclusion: 'Concl' };
  const nextRole = r => r === 'chapter' ? 'intro' : r === 'intro' ? 'conclusion' : 'chapter';
  function drawRows() {
    list.innerHTML = '';
    let num = 0;
    rows.forEach((r, i) => {
      if (!r.role) r.role = 'chapter';
      if (r.role === 'chapter') num++;
      const row = h(`
        <div class="row" style="margin-bottom:8px">
          <span class="muted" style="width:22px;text-align:right;font-size:12px">${r.role === 'chapter' ? num : '–'}</span>
          <button data-a="r" title="chapter / intro / conclusion — intro & conclusion carry no number" style="width:46px;border:1px solid ${r.role === 'chapter' ? 'var(--line)' : 'var(--gold)'};background:var(--card);border-radius:3px;font-size:10px;padding:9px 2px;cursor:pointer;color:${r.role === 'chapter' ? 'var(--text-2)' : 'var(--gold)'};font-family:var(--serif-display);font-weight:700">${ROLE_LABEL[r.role]}</button>
          <input data-a="t" value="${esc(r.title)}" placeholder="${r.role === 'chapter' ? 'Chapter title' : r.role === 'intro' ? 'Introduction' : 'Conclusion'}" style="flex:1;min-width:0;${FIN}">
          <input data-a="p" value="${esc(r.page || '')}" placeholder="Pg" inputmode="numeric" style="width:62px;${FIN};text-align:center">
          ${i > 0 ? `<button data-a="m" title="Join this row onto the end of the row above — for titles that were split across two lines" style="border:none;background:none;color:var(--text-3);font-size:14px;cursor:pointer;padding:0 2px">⌃</button>` : ''}
          <button data-a="x" style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>
        </div>`).firstElementChild;
      row.querySelector('[data-a=r]').onclick = () => { r.role = nextRole(r.role); drawRows(); };
      row.querySelector('[data-a=t]').oninput = e => r.title = e.target.value;
      row.querySelector('[data-a=p]').oninput = e => r.page = e.target.value;
      row.querySelector('[data-a=x]').onclick = () => { rows.splice(i, 1); drawRows(); };
      // One-tap repair for a title the scanner split across two rows. The page number
      // lives on whichever row actually had one — usually the second — so prefer that.
      const mBtn = row.querySelector('[data-a=m]');
      if (mBtn) mBtn.onclick = () => {
        const prev = rows[i - 1];
        prev.title = [String(prev.title || '').trim(), String(r.title || '').trim()].filter(Boolean).join(' ');
        if (!prev.page && r.page) prev.page = r.page;
        rows.splice(i, 1);
        drawRows();
      };
      list.append(row);
    });
  }
  drawRows();
  wrap.append(list);

  const add = h(`<button class="btn secondary">＋ Add chapter</button>`);
  add.firstChild.onclick = () => { rows.push({ title: '', page: '' }); drawRows(); };
  wrap.append(add);
  const saveBtn = h(`<button class="btn" style="margin-top:8px">Save ${'{'}n${'}'} chapters</button>`);
  saveBtn.firstChild.textContent = 'Save chapters';
  saveBtn.firstChild.onclick = () => {
    RD.setChapterList(b, rows);
    toast(b.chapterList.length + ' chapters saved');
    goBack();
  };
  wrap.append(saveBtn);
  main().append(wrap);
}

let rdOpenChapter = null;

function renderSummaries(body, b) {
  const count = b.chapters || Math.max(0, ...Object.keys(b.summaries).map(Number), 0);
  if (!b.chapters) {
    body.append(h(`<div class="muted" style="margin:4px 4px 10px;font-size:12px">No chapter count set for this book — chapters appear as you add summaries to them.</div>`));
  }
  const totalCh = b.chapters || count + 1;
  for (let ch = 1; ch <= totalCh; ch++) {
    const has = b.summaries[ch];
    const open = rdOpenChapter === ch;
    const info = RD.chapterInfo(b, ch);
    const row = h(`
      <div class="card" style="padding:11px 13px;margin-bottom:8px">
        <div class="row" data-a="head" style="cursor:pointer">
          <div class="grow"><span style="font-weight:700;font-size:14px">Ch. ${ch}${info && info.title ? ' — ' + esc(info.title) : ''}</span>${info && info.page ? ` <span class="muted" style="font-size:11px">p. ${info.page}</span>` : ''}
          ${has && !open ? `<div class="muted" style="font-size:12px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(has)}</div>` : ''}</div>
          <span class="chev">${open ? '▾' : has ? '▸' : '+'}</span>
        </div>
        ${open ? `<textarea data-a="text" rows="5" placeholder="Summary of chapter ${ch}…" style="width:100%;margin-top:10px;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;resize:vertical">${esc(has || '')}</textarea>
        <button class="btn" data-a="save" style="margin-top:8px">Save summary</button>` : ''}
      </div>`).firstElementChild;
    row.querySelector('[data-a=head]').onclick = () => { rdOpenChapter = open ? null : ch; rerender(); };
    const saveBtn = row.querySelector('[data-a=save]');
    if (saveBtn) saveBtn.onclick = () => {
      RD.setSummary(b, ch, row.querySelector('[data-a=text]').value);
      toast('Chapter ' + ch + ' summary saved');
      rdOpenChapter = null;
      rerender();
    };
    body.append(row);
  }
}

// R7 — tag chips + comma-separated tag input backed by the managed tag list
function tagChips(tags) {
  if (!tags || !tags.length) return '';
  return `<div style="margin-top:6px">${tags.map(t => `<span style="display:inline-block;border:1px solid var(--gold);color:var(--gold);border-radius:999px;font-size:10.5px;font-weight:700;padding:2px 9px;margin:0 4px 4px 0">${esc(t)}</span>`).join('')}</div>`;
}
function parseTagInput(v) {
  const tags = String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  tags.forEach(t => RD.addTag(t));
  return tags;
}
function tagInputRow(id) {
  return `<input data-a="tags" list="${id}" placeholder="Tags — comma-separated (e.g. prayer, providence)" autocapitalize="off" style="width:100%;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:13px;margin-bottom:8px">
    <datalist id="${id}">${(state.reading.tags || []).map(t => `<option value="${esc(t)}">`).join('')}</datalist>`;
}

function renderQuotes(body, b) {
  b.quotes.forEach(q => {
    const row = h(`
      <div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div style="font-size:14px;line-height:1.5">“${esc(q.text)}”</div>
        ${tagChips(q.tags)}
        <div class="row" style="margin-top:6px">
          <div class="grow muted" style="font-size:12px">${q.ch ? 'ch. ' + esc(q.ch) : ''}${q.page ? (q.ch ? ' · ' : '') + 'p. ' + esc(q.page) : ''}</div>
          <button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>
        </div>
      </div>`).firstElementChild;
    row.querySelector('button').onclick = () => { RD.removeQuote(b, q.id); rerender(); };
    body.append(row);
  });
  if (!b.quotes.length) body.append(h(`<div class="empty">Quotes to remember, tagged to chapter and page.</div>`));
  const add = h(`
    <div class="card"><h3>Add quote</h3>
      <textarea data-a="text" rows="3" placeholder="The quote…" style="width:100%;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;margin-bottom:8px;resize:vertical"></textarea>
      ${tagInputRow('rd-tags-q')}
      <div class="row">
        <input data-a="ch" placeholder="Ch." inputmode="numeric" style="width:60px;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <input data-a="page" placeholder="Page" inputmode="numeric" style="width:70px;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <button class="pill on" data-a="add" style="flex:1;padding:10px">Add quote</button>
      </div>
    </div>`).firstElementChild;
  add.querySelector('[data-a=add]').onclick = () => {
    const text = add.querySelector('[data-a=text]').value.trim();
    if (!text) { toast('Write the quote first'); return; }
    RD.addQuote(b, { ch: add.querySelector('[data-a=ch]').value.trim(), page: add.querySelector('[data-a=page]').value.trim(), text, tags: parseTagInput(add.querySelector('[data-a=tags]').value) });
    rerender();
  };
  body.append(add);
}

function renderQuestions(body, b) {
  b.questions.forEach(q => {
    const row = h(`
      <div class="card" style="padding:12px 14px;margin-bottom:8px">
        <div style="font-size:14px;line-height:1.5">${esc(q.text)}</div>
        ${tagChips(q.tags)}
        <div class="row" style="margin-top:6px">
          <div class="grow muted" style="font-size:12px">${q.ch ? 'ch. ' + esc(q.ch) : ''}</div>
          <button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>
        </div>
      </div>`).firstElementChild;
    row.querySelector('button').onclick = () => { RD.removeQuestion(b, q.id); rerender(); };
    body.append(row);
  });
  if (!b.questions.length) body.append(h(`<div class="empty">Discussion questions as they come to you, tagged to chapter.</div>`));
  const add = h(`
    <div class="card"><h3>Add question</h3>
      <textarea data-a="text" rows="3" placeholder="The question…" style="width:100%;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;margin-bottom:8px;resize:vertical"></textarea>
      ${tagInputRow('rd-tags-qs')}
      <div class="row">
        <input data-a="ch" placeholder="Ch." inputmode="numeric" style="width:60px;padding:10px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;text-align:center">
        <button class="pill on" data-a="add" style="flex:1;padding:10px">Add question</button>
      </div>
    </div>`).firstElementChild;
  add.querySelector('[data-a=add]').onclick = () => {
    const text = add.querySelector('[data-a=text]').value.trim();
    if (!text) { toast('Write the question first'); return; }
    RD.addQuestion(b, { ch: add.querySelector('[data-a=ch]').value.trim(), text, tags: parseTagInput(add.querySelector('[data-a=tags]').value) });
    rerender();
  };
  body.append(add);
}

// ---------- Research (Phase 6 · R7) — search quotes & questions across all books ----------
let researchSel = {};   // tag → true
let researchText = '';
function researchScreen() {
  setHeader('Research', { back: true });
  const wrap = document.createElement('div');
  const tags = state.reading.tags || [];

  const search = h(`<input data-a="q" value="${esc(researchText)}" placeholder="Search text…" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:15px;margin-bottom:10px">`).firstElementChild;
  search.oninput = e => { researchText = e.target.value; drawResults(); };
  wrap.append(search);

  if (tags.length) {
    const pillrow = document.createElement('div');
    pillrow.className = 'pillrow';
    tags.forEach(t => {
      const p = h(`<button class="pill ${researchSel[t] ? 'on' : ''}">${esc(t)}</button>`).firstElementChild;
      p.onclick = () => { researchSel[t] = !researchSel[t]; p.classList.toggle('on'); drawResults(); };
      pillrow.append(p);
    });
    wrap.append(pillrow);
  } else {
    wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 10px">No tags yet — add tags to quotes and questions and they become filters here.</div>`));
  }

  const results = document.createElement('div');
  function drawResults() {
    results.innerHTML = '';
    const want = Object.keys(researchSel).filter(t => researchSel[t]);
    const txt = researchText.trim().toLowerCase();
    const items = [];
    RD.books().forEach(b => {
      (b.quotes || []).forEach(q => items.push({ kind: 'Quote', b, x: q }));
      (b.questions || []).forEach(q => items.push({ kind: 'Question', b, x: q }));
    });
    const hit = items.filter(({ x }) =>
      want.every(t => (x.tags || []).includes(t)) &&
      (!txt || String(x.text).toLowerCase().includes(txt)));
    hit.sort((a, c) => (c.x.ts || 0) - (a.x.ts || 0));
    hit.forEach(({ kind, b, x }) => {
      const row = h(`<div class="card" style="padding:12px 14px;margin-bottom:8px;cursor:pointer">
        <div style="font-size:14px;line-height:1.5">${kind === 'Quote' ? '“' + esc(x.text) + '”' : esc(x.text)}</div>
        ${tagChips(x.tags)}
        <div class="muted" style="font-size:12px;margin-top:6px">${kind} · ${esc(b.title)}${x.ch ? ' · ch. ' + esc(x.ch) : ''}${x.page ? ' · p. ' + esc(x.page) : ''}</div>
      </div>`).firstElementChild;
      row.onclick = () => render(() => bookDetail(b));
      results.append(row);
    });
    if (!hit.length) results.append(h(`<div class="empty">${items.length ? 'Nothing matches those filters.' : 'No quotes or questions saved yet — add them from any book\'s Notes.'}</div>`));
  }
  drawResults();
  wrap.append(results);
  main().append(wrap);
}

// ---------- Bible reading plans ----------
function plansScreen() {
  setHeader('Reading Plans', { back: true });
  const wrap = document.createElement('div');
  renderPlans(wrap);
  main().append(wrap);
}

function renderPlans(body) {
  RP.plans().forEach(p => {
    const st = RP.planStats(p);
    const done = RP.isDoneToday(p);
    const ref = RP.portionRef(p);
    const fin = RP.estFinish(p);
    const el = h(`
      <div class="list-item">
        <div class="grow">
          <div class="title">${esc(p.name)}${st.complete ? ' 🎉' : ''}</div>
          <div class="sub">${st.done}/${st.total} ${p.kind === 'fixed' ? 'days' : 'chapters'} · ${st.pct}%${st.complete ? '' : ref ? ' · today: ' + esc(ref) + (done ? ' ✓' : '') : ''}</div>
          <div class="progressbar" style="margin-top:6px"><div style="width:${st.pct}%"></div></div>
          ${fin && !st.complete ? `<div class="sub" style="margin-top:3px">${p.mode === 'bydate' ? 'target' : 'on pace to finish'} ${fin.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}
        </div>
        <span class="chev">›</span>
      </div>`);
    el.querySelector('.list-item').onclick = () => render(() => planDetail(p));
    body.append(el);
  });
  if (!RP.plans().length) body.append(h(`<div class="empty">No reading plans yet.<br>Whole Bible, one testament, or any set of books — at your pace.</div>`));
  const btn = h(`<button class="btn" style="margin-top:12px">＋ New reading plan</button>`);
  btn.firstChild.onclick = () => render(planCreate);
  body.append(btn);
}

function planCreate() {
  setHeader('New reading plan', { back: true });
  const wrap = document.createElement('div');
  let preset = 'whole', mode = 'perday';
  const picked = {};
  const days = new Set([0, 1, 2, 3, 4, 5, 6]);

  // prefabricated plans
  const prefabCard = h(`
    <div class="card"><h3>Start from a known plan</h3>
      ${RP.PREFABS.map(f => `
        <div class="list-item" data-pf="${f.key}" style="margin-bottom:6px">
          <div class="grow"><div class="title" style="font-size:14px">${f.name}</div>
          <div class="sub">${f.blurb}</div></div>
          <span class="chev">›</span>
        </div>`).join('')}
      <div class="muted" style="font-size:11px">Prefabs use your reading-day selection below. Or build your own underneath.</div>
    </div>`).firstElementChild;
  prefabCard.querySelectorAll('[data-pf]').forEach(el => el.onclick = () => {
    const p = RP.createPrefab(el.dataset.pf, [...days].sort());
    toast('Plan created — first portion: ' + (RP.portionRef(p) || 'starts on your next reading day'));
    render(() => planDetail(p));
  });
  wrap.append(prefabCard);

  const card = h(`
    <div class="card">
      <h3 style="margin-bottom:8px">Or build your own</h3>
      <input data-a="name" placeholder="Plan name (e.g. NT in 90 days)" style="width:100%;${FIN};margin-bottom:10px">
      <h3>Scope</h3>
      <div class="pillrow" data-a="presets">${RP.PLAN_PRESETS.map(([v, l]) => `<button class="pill ${v === 'whole' ? 'on' : ''}" data-p="${v}">${l}</button>`).join('')}</div>
      <div data-a="bookgrid"></div>
      <h3 style="margin-top:10px">Reading days</h3>
      <div class="pillrow" data-a="days">
        ${PL.DOW.map((d, i) => `<button class="pill on" data-dow="${i}">${d}</button>`).join('')}
      </div>
      <h3 style="margin-top:4px">Pace</h3>
      <div class="pillrow">
        <button class="pill on" data-md="perday">Chapters per day</button>
        <button class="pill" data-md="bydate">Finish by a date</button>
      </div>
      <div class="row" data-a="pace" style="margin-bottom:10px"></div>
      <div class="muted" data-a="summary" style="font-size:12px;margin-bottom:10px"></div>
      <button class="btn" data-a="create">Create plan</button>
    </div>`).firstElementChild;

  const grid = card.querySelector('[data-a=bookgrid]');
  const paceBox = card.querySelector('[data-a=pace]');
  const summary = card.querySelector('[data-a=summary]');

  function currentBooks() {
    if (preset !== 'custom') return RP.booksForPreset(preset);
    return SC.allBooks.filter(b => picked[b.name]).map(b => b.name);
  }
  function chapterCount() {
    return currentBooks().reduce((a, n) => a + (SC.allBooks.find(b => b.name === n) || { chapters: 0 }).chapters, 0);
  }
  function drawGrid() {
    grid.innerHTML = '';
    if (preset !== 'custom') return;
    const g = document.createElement('div');
    g.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:6px;margin-top:8px';
    SC.allBooks.forEach(b => {
      const cell = document.createElement('div');
      cell.className = 'cell' + (picked[b.name] ? ' done' : '');
      cell.style.fontSize = '10px';
      cell.textContent = SC.abbr(b.name);
      cell.title = b.name;
      cell.onclick = () => { picked[b.name] = !picked[b.name]; cell.classList.toggle('done'); drawSummary(); };
      g.append(cell);
    });
    grid.append(g);
  }
  function drawPace() {
    paceBox.innerHTML = '';
    if (mode === 'perday') {
      paceBox.append(h(`<input data-a="cpd" placeholder="Chapters/day" inputmode="numeric" value="3" style="width:140px;${FIN}">`).firstChild);
    } else {
      const def = new Date(Date.now() + 90 * 86400000);
      const defStr = def.getFullYear() + '-' + String(def.getMonth() + 1).padStart(2, '0') + '-' + String(def.getDate()).padStart(2, '0');
      paceBox.append(h(`<input data-a="target" type="date" value="${defStr}" style="${FIN}">`).firstChild);
    }
    const inp = paceBox.querySelector('input');
    inp.oninput = drawSummary;
  }
  function drawSummary() {
    const total = chapterCount();
    if (!total) { summary.textContent = ''; return; }
    const perWeek = days.size;
    const dayNote = perWeek === 7 ? '' : ' (' + perWeek + ' reading day' + (perWeek === 1 ? '' : 's') + '/week)';
    if (mode === 'perday') {
      const cpd = Math.max(1, Number(card.querySelector('[data-a=cpd]')?.value) || 3);
      const readDays = Math.ceil(total / cpd);
      const calDays = Math.ceil(readDays * 7 / perWeek);
      summary.textContent = total.toLocaleString() + ' chapters · ' + readDays + ' reading days ≈ ' + calDays + ' calendar days' + dayNote;
    } else {
      const t = card.querySelector('[data-a=target]')?.value;
      if (t) {
        const calDays = Math.max(1, Math.round((new Date(t + 'T12:00:00') - Date.now()) / 86400000) + 1);
        const readDays = Math.max(1, Math.round(calDays * perWeek / 7));
        summary.textContent = total.toLocaleString() + ' chapters · ~' + Math.ceil(total / readDays) + ' chapters per reading day' + dayNote;
      }
    }
  }

  card.querySelectorAll('[data-dow]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.dow);
    days.has(i) ? days.delete(i) : days.add(i);
    if (!days.size) days.add(i);   // at least one reading day
    card.querySelectorAll('[data-dow]').forEach(x => x.classList.toggle('on', days.has(Number(x.dataset.dow))));
    drawSummary();
  });
  card.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    preset = b.dataset.p;
    card.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x.dataset.p === preset));
    drawGrid(); drawSummary();
  });
  card.querySelectorAll('[data-md]').forEach(b => b.onclick = () => {
    mode = b.dataset.md;
    card.querySelectorAll('[data-md]').forEach(x => x.classList.toggle('on', x.dataset.md === mode));
    drawPace(); drawSummary();
  });
  card.querySelector('[data-a=create]').onclick = () => {
    const books = currentBooks();
    if (!books.length) { toast('Pick at least one book'); return; }
    const name = card.querySelector('[data-a=name]').value.trim() ||
      (RP.PLAN_PRESETS.find(x => x[0] === preset) || ['', 'Reading plan'])[1];
    const cpd = Number(card.querySelector('[data-a=cpd]')?.value) || 3;
    const target = card.querySelector('[data-a=target]')?.value || null;
    if (mode === 'bydate' && !target) { toast('Pick a target date'); return; }
    const p = RP.createPlan({ name, books, mode, chaptersPerDay: cpd, targetDate: target, readingDays: [...days].sort() });
    toast('Plan created — first portion: ' + (RP.portionRef(p) || 'starts on your next reading day'));
    render(() => planDetail(p));
  };

  drawPace(); drawSummary();
  wrap.append(card);
  main().append(wrap);
}

function planDetail(p) {
  setHeader(p.name, { back: true });
  const wrap = document.createElement('div');
  const st = RP.planStats(p);
  const fin = RP.estFinish(p);
  wrap.append(h(`
    <div class="card">
      <div class="row"><div class="grow"><div class="big">${st.pct}%</div>
      <div class="muted">${st.done}/${st.total} ${p.kind === 'fixed' ? 'days' : 'chapters'}${RP.upNext(p) ? ' · up next: ' + esc(RP.upNext(p)) : ''}</div></div></div>
      <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${st.pct}%"></div></div>
      <div class="muted" style="font-size:12px;margin-top:8px">${p.kind === 'fixed' ? "M'Cheyne fixed calendar · 4 readings per reading day" : p.mode === 'perday' ? p.chaptersPerDay + ' chapters/day' : 'finish by ' + new Date(p.targetDate + 'T12:00:00').toLocaleDateString()}${fin && !st.complete ? ' · projected ' + fin.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''} · started ${new Date(p.created).toLocaleDateString()}</div>
    </div>`));

  if (!st.complete) {
    const done = RP.isDoneToday(p);
    const ref = RP.portionRef(p);
    const restDay = !done && !RP.isReadingDay(p);
    const dayNames = (p.readingDays || []).length === 7 ? 'every day' : (p.readingDays || []).map(d => PL.DOW[d]).join(' · ');
    const today = h(`
      <div class="card" style="${done || restDay ? '' : 'border-color:var(--accent)'}">
        <h3>Today's portion</h3>
        ${restDay
          ? `<div class="muted" style="font-size:15px">Rest day — this plan reads ${esc(dayNames)}.</div>`
          : `${p.kind === 'fixed' ? ref.split(' · ').map(r => '<div style="font-size:16px;font-weight:700;">' + esc(r) + '</div>').join('') : '<div style="font-size:17px;font-weight:700;">' + esc(ref) + '</div>'}
             <button class="btn ${done ? 'secondary' : ''}" style="margin-top:12px">${done ? '✓ Done today — tap to undo' : 'Mark read'}</button>`}
      </div>`).firstElementChild;
    const btn = today.querySelector('button');
    if (btn) btn.onclick = () => {
      if (done) RP.uncompleteToday(p);
      else { RP.completeToday(p); celebrate('Portion read ✓'); }
      rerender();
    };
    wrap.append(today);
  } else {
    wrap.append(h(`<div class="card" style="text-align:center;padding:22px"><div class="big">🎉</div><div style="font-weight:700;margin-top:6px">Plan complete</div></div>`));
  }

  const recent = Object.entries(p.log || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
  if (recent.length) {
    wrap.append(sectionTitle('Recent days'));
    recent.forEach(([dk, n]) => wrap.append(h(`
      <div class="list-item" style="cursor:default"><div class="grow">
        <span style="font-weight:700">${p.kind === 'fixed' ? 'Daily readings ✓' : n + ' chapter' + (n === 1 ? '' : 's')}</span>
        <span class="muted" style="margin-left:8px">${PL.fmtDate(dk)}</span>
      </div></div>`)));
  }

  const del = h(`<button class="btn danger" style="margin-top:16px">Delete this plan</button>`);
  del.firstChild.onclick = () => { RP.removePlan(p.id); toast('Plan deleted'); goBack(); };
  wrap.append(del);
  main().append(wrap);
}

// ---------- Creeds, Catechisms & Confessions ----------
function creedsHome() {
  setHeader('Creeds, Catechisms & Confessions', { back: true });
  const wrap = document.createElement('div');

  const currents = CR.currentDocs();
  if (currents.length) {
    wrap.append(sectionTitle('In progress'));
    currents.forEach(cur => {
      const st = CR.docStats(cur.id);
      const tr = CR.trackOf(cur.id);
      const hero = h(`
        <div class="card" style="border-color:var(--accent);cursor:pointer;margin-bottom:8px">
          <div class="row">
            <div class="grow">
              <div style="font-size:17px;font-weight:700;">${esc(cur.name)}</div>
              <div class="muted" style="font-size:12px">${tr === 'memorize' ? 'memorizing' : tr === 'read' ? 'reading' : 'not tracked'} · ${st.done}/${st.total} · level ${st.level}</div>
            </div>
            <div class="big" style="color:var(--accent)">${st.pct}%</div>
          </div>
          <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${st.pct}%"></div></div>
        </div>`).firstElementChild;
      hero.onclick = () => render(() => creedDocScreen(cur));
      wrap.append(hero);
    });
  }

  CR.GROUPS.forEach(([g, label]) => {
    wrap.append(sectionTitle(label));
    CR.docs().filter(d => d.group === g).forEach(d => {
      const st = CR.docStats(d.id);
      const tr = CR.trackOf(d.id);
      const el = h(`
        <div class="list-item">
          <div class="grow">
            <div class="title">${esc(d.name)}</div>
            <div class="sub">${d.sections.length} ${d.group === 'catechisms' ? 'Q&As' : 'sections'}${tr ? ' · ' + (tr === 'memorize' ? 'memorizing' : 'reading') : ''}${st.done ? ' · ' + st.pct + '%' : ''}</div>
            ${st.done ? `<div class="progressbar" style="margin-top:6px"><div style="width:${st.pct}%"></div></div>` : ''}
          </div>
          ${tr ? `<span class="badge" style="background:${tr === 'memorize' ? 'var(--gold)' : 'var(--accent)'}">${tr === 'memorize' ? 'MEM' : 'READ'}</span>` : ''}
          <span class="chev">›</span>
        </div>`);
      el.querySelector('.list-item').onclick = () => render(() => creedDocScreen(d));
      wrap.append(el);
    });
  });
  main().append(wrap);
}

let crOpenSection = null;

function creedDocScreen(d) {
  setHeader(d.name.replace(/^The /, ''), { back: true });
  const wrap = document.createElement('div');
  const st = CR.docStats(d.id);
  const tr = CR.trackOf(d.id);
  const isCurrent = CR.isCurrentDoc(d.id);
  const unit = d.group === 'catechisms' ? 'Q&As' : 'sections';

  // status card (+ 🎯 pace line when a finish-by date is set)
  wrap.append(h(`
    <div class="card" style="${isCurrent ? 'border-color:var(--accent)' : ''}">
      <div class="row">
        <div class="grow"><div class="big">${st.pct}%</div>
        <div class="muted">${st.done}/${st.total} ${unit} ${tr ? '· ' + (tr === 'memorize' ? 'memorizing' : 'reading') : ''}${isCurrent ? ' · <span style="color:var(--accent);font-weight:700">current</span>' : ''}</div>
        ${(() => { const pi = TG.creedPaceInfo(d.id); return pi ? `<div style="font-size:12px;font-weight:600;${pi.overdue ? 'color:var(--danger)' : 'color:var(--accent)'}">🎯 ${pi.overdue ? 'Overdue — ' + pi.remaining + ' ' + unit + ' left, due now' : pi.perDay + ' ' + unit + '/day to finish by ' + shortDate(CR.docDueOf(d.id))}</div>` : ''; })()}</div>
        <div style="text-align:right"><div class="big" style="color:var(--gold)">${st.level}</div><div class="muted">level</div></div>
      </div>
      <div class="progressbar" style="margin-top:8px;height:7px"><div style="width:${st.pct}%"></div></div>
    </div>`));

  // primary action — Practice (catechisms only, as before)
  if (d.group === 'catechisms') {
    const prBtn = h(`<button class="btn">🎯 Practice</button>`);
    prBtn.firstChild.onclick = () => render(() => practiceSetup(d));
    wrap.append(prBtn);
  }

  // sections as numbered squares, grouped like Scripture chapters.
  // Heidelberg carries Lord's Days (clickable header → whole group written out);
  // other docs are a single flat grid. Each square opens that section.
  // Each group gets a clickable subtitle → the whole group written out. For the Heidelberg
  // that's per Lord's Day; for a flat doc (creeds/confessions) it's the whole document.
  const groups = creedGroups(d);
  groups.forEach(g => {
    const flat = g.ld == null;
    if (!flat || g.sections.length > 1) {
      const gd = g.sections.filter(s => CR.isDone(d.id, s.n)).length;
      const title = flat ? (d.group === 'catechisms' ? 'Questions' : 'Sections') : "Lord's Day " + g.ld;
      const head = h(`<h3 style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);margin:16px 4px 8px;cursor:pointer;display:flex;align-items:center;gap:8px">
        <span>${title}</span>
        <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">${gd}/${g.sections.length}</span></h3>`).firstElementChild;
      head.onclick = () => render(() => creedGroupScreen(d, g.ld));
      wrap.append(head);
    }
    wrap.append(creedGrid(d, g.sections));
  });

  // secondary pills — Finish by, then Track (Baruch's order), like Scripture
  const pills = h(`<div class="pillrow" style="margin-top:16px">
    <button class="pill" data-s="due">Finish by</button>
    <button class="pill" data-s="track">Track${tr ? ' · ' + (tr === 'memorize' ? 'Memorize' : 'Read') : ''}${isCurrent ? ' ★' : ''}</button>
  </div>`);
  pills.querySelector('[data-s=due]').onclick = () => creedDueSheet(d);
  pills.querySelector('[data-s=track]').onclick = () => creedTrackSheet(d);
  wrap.append(pills);

  main().append(wrap);
}

// Order-preserving grouping: Lord's Days if the doc carries them, else one flat group.
function creedGroups(d) {
  const secs = d.sections;
  if (!secs.some(s => s.ld != null)) return [{ ld: null, sections: secs }];
  const groups = [], byLd = new Map();
  secs.forEach(s => {
    if (!byLd.has(s.ld)) { const g = { ld: s.ld, sections: [] }; byLd.set(s.ld, g); groups.push(g); }
    byLd.get(s.ld).sections.push(s);
  });
  return groups;
}

// A grid of numbered squares (done = filled), each opening that section's text.
function creedGrid(d, sections) {
  const grid = document.createElement('div');
  grid.className = 'grid';
  sections.forEach(s => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (CR.isDone(d.id, s.n) ? ' done' : '');
    cell.textContent = s.n;
    cell.onclick = () => creedSectionSheet(d, s);
    grid.append(cell);
  });
  return grid;
}

// Single section — the question (catechism) or article shown in a sheet, with a done toggle.
function creedSectionSheet(d, s) {
  const isCat = d.group === 'catechisms';
  openSheet(isCat ? 'Q' + s.n : CR.sectionLabel(d, s), (body, close) => {
    const fill = () => {
      body.innerHTML = '';
      if (isCat && s.label) body.append(h(`<div style="font-size:15px;font-weight:700;line-height:1.5;margin-bottom:10px">${esc(s.label)}</div>`));
      body.append(h(`<div style="font-size:15px;line-height:1.65;white-space:pre-line">${esc(s.text)}</div>`));
      if (s.refs) body.append(h(`<div class="muted" style="font-size:12px;line-height:1.5;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">${esc(s.refs)}</div>`));
      const done = CR.isDone(d.id, s.n);
      const tog = h(`<button class="btn ${done ? 'secondary' : ''}" style="margin-top:16px">${done ? '✓ Done — tap to unmark' : 'Mark done'}</button>`);
      tog.firstChild.onclick = () => { CR.toggleSection(d.id, s.n); fill(); rerender(); };
      body.append(tog);
    };
    fill();
  });
}

// A group written out in full — every section/Q&A, each markable. ld null = the whole doc.
function creedGroupScreen(d, ld) {
  setHeader(d.name.replace(/^The /, '') + (ld != null ? " · Lord's Day " + ld : ''), { back: true });
  const wrap = document.createElement('div');
  d.sections.filter(s => ld == null || s.ld === ld).forEach(s => {
    const done = CR.isDone(d.id, s.n);
    const el = h(`
      <div class="card" style="padding:12px 14px;margin-bottom:8px;${done ? 'opacity:.65;' : ''}">
        <div class="row">
          <div class="check ${done ? 'on' : ''}">✓</div>
          <div class="grow"><div style="font-size:14px;font-weight:700">${d.group === 'catechisms' ? 'Q' + s.n + '. ' : ''}${esc(s.label || CR.sectionLabel(d, s))}</div></div>
        </div>
        <div style="font-size:14px;line-height:1.65;margin-top:10px;white-space:pre-line">${esc(s.text)}</div>
        ${s.refs ? `<div class="muted" style="font-size:11.5px;line-height:1.5;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">${esc(s.refs)}</div>` : ''}
      </div>`).firstElementChild;
    el.querySelector('.check').onclick = () => { CR.toggleSection(d.id, s.n); render(() => creedGroupScreen(d, ld), false); };
    wrap.append(el);
  });
  main().append(wrap);
}

// Finish-by (due date) sheet — reuses the shared dueControl
function creedDueSheet(d) {
  openSheet('Finish by', (body, close) => {
    body.append(dueControl({
      label: 'Finish by',
      hint: 'Set a date for a self-adjusting daily pace — shows here and in Today, Week & Month.',
      value: CR.docDueOf(d.id), unit: (d.group === 'catechisms' ? 'Q&As' : 'sections'), info: TG.creedPaceInfo(d.id),
      onSet: v => { CR.setDocDue(d.id, v); toast(v ? 'Target set' : 'Target cleared'); close(); rerender(); }
    }));
  });
}

// Track sheet — Read / Memorize / ★ Current
function creedTrackSheet(d) {
  openSheet('Track', (body, close) => {
    const fill = () => {
      body.innerHTML = '';
      const tr = CR.trackOf(d.id);
      const isCurrent = CR.isCurrentDoc(d.id);
      const row = h(`<div class="pillrow" style="margin-bottom:0">
        <button class="pill ${tr === 'read' ? 'on' : ''}" data-t="read">Read</button>
        <button class="pill ${tr === 'memorize' ? 'on' : ''}" data-t="memorize">Memorize</button>
        <button class="pill ${isCurrent ? 'on' : ''}" data-t="current">★ Current</button>
      </div>`).firstElementChild;
      row.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
        if (b.dataset.t === 'current') {
          CR.toggleCurrentDoc(d.id);
          toast(isCurrent ? d.name + ' removed from current' : d.name + ' set as current');
        } else {
          CR.setTrack(d.id, tr === b.dataset.t ? null : b.dataset.t);
        }
        fill(); rerender();
      });
      body.append(row);
      body.append(h(`<div class="muted" style="font-size:12px;margin-top:10px">Read or Memorize sets how this document is tracked. ★ Current pins it to the dashboard — you can have several current at once.</div>`));
    };
    fill();
  });
}

// ---------- Practice (Fade · First-Letter · Flashcards) ----------
// Session-only; results never touch memorized status.

function tokenize(text) {
  // words per line (structure preserved); key = first alphanumeric char, lowercased.
  // Dash-joined words (belong—body, only-begotten) split into separate typeable words.
  return text.split('\n').map(line =>
    line.split(/\s+/).filter(w => w).flatMap(chunk =>
      chunk.replace(/([—–-])(?=\S)/g, '$1 ').split(' ')
    ).map(raw => {
      const m = raw.toLowerCase().match(/[a-z0-9]/);
      return { raw, key: m ? m[0] : null };
    })
  );
}
function prand(seed) { return (Math.imul(seed, 2654435761) >>> 0) % 100; }

let prSetup = { mode: 'fade', sel: 'all', from: 1, to: 10, lds: {}, picked: {}, weakN: 12, budget: 20, flashOrder: 'adaptive' };

// SM5 — combined (multi-chapter) docs carry per-section docId/vn so every verse's
// mastery lives with its own chapter doc, shared with single-chapter practice.
const prDocId = (d, x) => x.docId || d.id;
const prN = x => x.vn != null ? x.vn : x.n;

// gradient tile: white = 100% mastery → black = never practiced
function masteryTileStyle(m) {
  const L = m === null ? 0 : 18 + m * 0.82;   // 0 (black) for never; 18%→100% lightness by mastery
  const txt = L > 55 ? '#1c1b18' : '#f2efe8';
  return `background:hsl(40,8%,${L}%);color:${txt};border:1px solid var(--line)`;
}

// Phase 7.5 — the chapter/range this practice doc reviews, for timed Review mode.
// bibleDoc carries a single ci; bibleMultiDoc carries per-section ci.
function reviewScopeFromDoc(d) {
  if (!d.bible) return null;
  if (!d.bible.multi && d.bible.ci != null) return { kind: 'chapter', ch: d.bible.ci + 1 };
  const chs = [...new Set(d.sections.map(sec => (sec.ci != null ? sec.ci : d.bible.ci) + 1))].sort((a, b) => a - b);
  if (chs.length === 1) return { kind: 'chapter', ch: chs[0] };
  const contiguous = chs.every((c, i) => i === 0 || c === chs[i - 1] + 1);
  return contiguous ? { kind: 'range', from: chs[0], to: chs[chs.length - 1] } : null;
}

function practiceSetup(d) {
  setHeader('Practice', { back: true });
  const wrap = document.createElement('div');
  const s = prSetup;
  // Review is Scripture-only; the shared setup is reused for creeds, so fall back.
  if (s.mode === 'review' && !d.bible) s.mode = 'flash';
  if (s.sel === 'ld' && d.bible) s.sel = 'all';   // Lord's Days is a creeds-only grouping

  // ---- mastery dashboard: every question at a glance ----
  wrap.append(sectionTitle('Mastery'));
  const dash = document.createElement('div');
  dash.className = 'grid';
  d.sections.forEach(sec => {
    const m = CR.mastery(prDocId(d, sec), prN(sec));
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.style.cssText = masteryTileStyle(m);
    cell.textContent = sec.n;
    cell.onclick = () => {
      const hist = CR.practiceHistory(prDocId(d, sec), prN(sec));
      toast(m === null ? `Q${sec.n} — never practiced` : `Q${sec.n} — ${m}% over last ${Math.min(hist.length, 10)} attempt${hist.length === 1 ? '' : 's'}`);
    };
    dash.append(cell);
  });
  wrap.append(dash);
  wrap.append(h(`<div class="muted" style="font-size:11px;margin:8px 4px 0">White = strong · darker = weaker · black = never practiced. Fade sessions never score.</div>`));

  wrap.append(sectionTitle('Mode'));
  const modes = h(`<div class="pillrow">
    <button class="pill ${s.mode === 'fade' ? 'on' : ''}" data-m="fade">Fade</button>
    <button class="pill ${s.mode === 'typer' ? 'on' : ''}" data-m="typer">First-Letter</button>
    <button class="pill ${s.mode === 'flash' ? 'on' : ''}" data-m="flash">Flashcards</button>
    <button class="pill ${s.mode === 'scramble' ? 'on' : ''}" data-m="scramble">Scramble</button>
    ${d.bible ? `<button class="pill ${s.mode === 'review' ? 'on' : ''}" data-m="review">Review ⏱</button>` : ''}
  </div>`);
  modes.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { s.mode = b.dataset.m; rerender(); });
  wrap.append(modes);
  wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 4px">${{
    fade: 'Recite while the text disappears in stages — tap a blank to peek. Pure learning; never scored.',
    typer: 'Type the first letter of each word. Three misses reveals the word. Accuracy feeds mastery.',
    flash: 'Adaptive deck: weak cards return often, new cards enter once the active ones reach 3+. Exit ratings feed mastery.',
    scramble: 'Rebuild the text by tapping the pieces in order. First-try accuracy feeds mastery.',
    review: 'Timed recitation of this selection — logs to the review tracker. Tap 📖 View text to peek without stopping the clock.'
  }[s.mode]}</div>`));

  const inputStyle = 'padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px;text-align:center';

  // Phase 7.5 — Review mode: skip the card-selection UI entirely and just time the
  // chapter/range this doc covers. Lands on the same background-safe reviewTimer
  // (with peek-text) that the book screen uses, but scoped to the individual chapter.
  if (s.mode === 'review') {
    const bk = allBooks[bookIndex[d.bible.book]];
    const scope = reviewScopeFromDoc(d);
    wrap.append(h(`<div class="card"><div class="muted">Reviewing <b>${esc(bk ? bk.name : d.bible.book)}${scope ? ' · ' + SC.scopeLabel(scope) : ''}</b>. The timer keeps running while you peek at the text, and logs to your review history when you finish.</div></div>`));
    const startR = h(`<button class="btn" style="margin-top:16px">⏱ Start review timer</button>`).firstChild;
    startR.onclick = () => render(() => reviewTimer(bk, scope));
    wrap.append(startR);
    main().append(wrap);
    return;
  }

  if (s.mode === 'flash') {
    // Phase 7.4 — three orders, all additive:
    //  adaptive — weakest-first weighted deck (original).
    //  seq      — starts at the beginning; introduces the next card in written order
    //             as you learn, shuffling the active set adaptively (weakest favored).
    //  inorder  — one plain pass, each card once, front to back.
    const ord = h(`<div class="pillrow">
      <button class="pill ${s.flashOrder === 'adaptive' ? 'on' : ''}" data-o="adaptive">Adaptive</button>
      <button class="pill ${s.flashOrder === 'seq' ? 'on' : ''}" data-o="seq">Sequential</button>
      <button class="pill ${s.flashOrder === 'inorder' ? 'on' : ''}" data-o="inorder">In order</button>
    </div>`);
    ord.querySelectorAll('[data-o]').forEach(btn => btn.onclick = () => { s.flashOrder = btn.dataset.o; rerender(); });
    wrap.append(ord);
    wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 4px">${{
      adaptive: 'Weakest cards return often; the deck works outward from your weak spots.',
      seq: 'Starts at the beginning and adds the next card in order as you learn each — the active set still shuffles, favoring the weakest.',
      inorder: 'One pass through the selection in written order — each card once, front to back.'
    }[s.flashOrder]}</div>`));
    if (s.flashOrder !== 'inorder') {
      const b = h(`<div class="card"><div class="row">
        <span class="muted grow">Cards this session (repeats count)</span>
        <input data-a="budget" inputmode="numeric" value="${s.budget}" style="width:70px;${inputStyle}">
      </div></div>`).firstElementChild;
      b.querySelector('[data-a=budget]').onchange = e => s.budget = Math.max(1, Number(e.target.value) || 20);
      wrap.append(b);
    }
  }

  wrap.append(sectionTitle('Questions'));
  const sels = h(`<div class="pillrow">
    <button class="pill ${s.sel === 'all' ? 'on' : ''}" data-s="all">All</button>
    <button class="pill ${s.sel === 'memorized' ? 'on' : ''}" data-s="memorized">Memorized</button>
    ${d.bible ? '' : `<button class="pill ${s.sel === 'ld' ? 'on' : ''}" data-s="ld">Lord's Days</button>`}
    <button class="pill ${s.sel === 'range' ? 'on' : ''}" data-s="range">Range</button>
    <button class="pill ${s.sel === 'pick' ? 'on' : ''}" data-s="pick">${d.bible ? 'Pick verses' : 'Pick'}</button>
    <button class="pill ${s.sel === 'weakest' ? 'on' : ''}" data-s="weakest">Weakest</button>
  </div>`);
  sels.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { s.sel = b.dataset.s; rerender(); });
  wrap.append(sels);

  if (s.sel === 'range') {
    const r = h(`<div class="card"><div class="row">
      <span class="muted">Q</span><input data-a="from" inputmode="numeric" value="${s.from}" style="width:70px;${inputStyle}">
      <span class="muted">to</span><input data-a="to" inputmode="numeric" value="${s.to}" style="width:70px;${inputStyle}">
      <span class="muted grow">of ${d.sections.length}</span>
    </div></div>`).firstElementChild;
    r.querySelector('[data-a=from]').onchange = e => s.from = Number(e.target.value) || 1;
    r.querySelector('[data-a=to]').onchange = e => s.to = Number(e.target.value) || 1;
    wrap.append(r);
  }
  if (s.sel === 'ld') {
    const lds = [...new Set(d.sections.map(x => x.ld).filter(Boolean))];
    if (lds.length) {
      wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Tap as many Lord's Days as you want.</div>`));
      const grid = document.createElement('div');
      grid.className = 'grid';
      lds.forEach(ld => {
        const cell = document.createElement('div');
        cell.className = 'cell' + (s.lds[ld] ? ' done' : '');
        cell.textContent = ld;
        cell.onclick = () => { s.lds[ld] = !s.lds[ld]; cell.classList.toggle('done'); };
        grid.append(cell);
      });
      wrap.append(grid);
    } else {
      wrap.append(h(`<div class="muted" style="margin:0 4px">This document has no Lord's Day groupings — use Range or Pick.</div>`));
    }
  }
  if (s.sel === 'pick') {
    wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Tap any ${d.bible ? 'verses' : 'questions'} you want — non-consecutive is fine, memorized or not.</div>`));
    const grid = document.createElement('div');
    grid.className = 'grid';
    d.sections.forEach(sec => {
      const cell = document.createElement('div');
      cell.className = 'cell' + (s.picked[sec.n] ? ' done' : '');
      cell.textContent = sec.n;
      cell.onclick = () => { s.picked[sec.n] = !s.picked[sec.n]; cell.classList.toggle('done'); };
      grid.append(cell);
    });
    wrap.append(grid);
  }
  if (s.sel === 'weakest') {
    const practiced = d.sections.filter(x => CR.mastery(prDocId(d, x), prN(x)) !== null).length;
    const r = h(`<div class="card"><div class="row">
      <span class="muted grow">Weakest</span>
      <input data-a="n" inputmode="numeric" value="${s.weakN}" style="width:70px;${inputStyle}">
      <span class="muted">of ${practiced} practiced</span>
    </div>
    <div class="muted" style="font-size:12px;margin-top:6px">Only questions with practice history — never-practiced don't count as weak.</div></div>`).firstElementChild;
    r.querySelector('[data-a=n]').onchange = e => s.weakN = Math.max(1, Number(e.target.value) || 12);
    wrap.append(r);
  }

  const startBtn = h(`<button class="btn" style="margin-top:16px">Start practice</button>`);
  startBtn.firstChild.onclick = () => {
    let list = [];
    if (s.sel === 'all') list = d.sections.slice();   // practice anything — memorized or not (that's the point)
    if (s.sel === 'memorized') list = d.sections.filter(x => d.bible ? SC.verseDone(allBooks[bookIndex[d.bible.book]], x.ci != null ? x.ci : d.bible.ci, prN(x)) : CR.isDone(d.id, x.n));
    if (s.sel === 'range') list = d.sections.filter(x => x.n >= Math.min(s.from, s.to) && x.n <= Math.max(s.from, s.to));
    if (s.sel === 'ld') list = d.sections.filter(x => s.lds[x.ld]);
    if (s.sel === 'pick') list = d.sections.filter(x => s.picked[x.n]);
    if (s.sel === 'weakest') {
      list = d.sections.filter(x => CR.mastery(prDocId(d, x), prN(x)) !== null)
        .sort((a, b) => CR.mastery(prDocId(d, a), prN(a)) - CR.mastery(prDocId(d, b), prN(b)))
        .slice(0, s.weakN);
    }
    if (!list.length) {
      toast({ memorized: 'Nothing marked memorized yet.', weakest: 'No practice history yet — run a session first.', ld: "No Lord's Days selected." }[s.sel] || 'No questions selected.');
      return;
    }
    const queue = list.map(x => ({ n: x.n, q: x.label, a: x.text, docId: x.docId, vn: x.vn }));
    if (s.mode === 'fade') render(() => fadeScreen(d, queue, 0, 0, []));
    if (s.mode === 'typer') render(() => typerScreen(d, queue, 0, []));
    if (s.mode === 'flash') {
      if (s.flashOrder === 'inorder') {
        const ordered = queue.slice().sort((a, b) => a.n - b.n);   // written order, always
        render(() => orderedFlashCard(d, ordered, 0, {}));
      } else render(() => flashSession(d, queue, s.budget, s.flashOrder));
    }
    if (s.mode === 'scramble') render(() => scrambleScreen(d, queue, 0, []));
  };
  wrap.append(startBtn);
  main().append(wrap);
}

// ---- Fade ----
const FADE_STAGES = [
  ['Full text', 0, false], ['Some blanks', 40, false], ['Mostly blanks', 80, false],
  ['First letters', 100, true], ['Nothing', 100, false]
];

function fadeScreen(d, queue, qi, stage, results) {
  const item = queue[qi];
  if (!item) { practiceSummary(d, 'Fade', results.map(r => `Q${r.n} — ${r.peeks} peek${r.peeks === 1 ? '' : 's'}`), queue.length); return; }
  const [label, pct, hints] = FADE_STAGES[stage];
  setHeader(`Fade · Q${item.n}`, { back: true });
  if (!item._peeks) item._peeks = 0;

  const wrap = document.createElement('div');
  wrap.append(h(`
    <div class="muted" style="margin:2px 4px 10px">Question ${qi + 1} of ${queue.length} · stage ${stage + 1} of ${FADE_STAGES.length}: ${label}</div>
    <div class="card"><div style="font-weight:700;font-size:15px;line-height:1.5">Q${item.n}. ${esc(item.q)}</div></div>`));

  const card = document.createElement('div');
  card.className = 'card';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:15px;line-height:1.9';
  tokenize(item.a).forEach(line => {
    const div = document.createElement('div');
    line.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'pw-word';
      const blanked = w.key && prand(item.n * 131 + i * 7 + 1) < pct;
      if (!blanked || stage === 0) {
        span.textContent = w.raw + ' ';
      } else if (hints) {
        span.className = 'pw-word pw-hint';
        span.textContent = ' ' + w.key + '·'.repeat(Math.max(1, Math.min(6, w.raw.length - 1))) + ' ';
        span.onclick = () => { span.className = 'pw-word pw-missed'; span.textContent = w.raw + ' '; item._peeks++; };
      } else {
        span.className = 'pw-word pw-blank';
        span.textContent = ' ' + '▁'.repeat(Math.max(3, Math.min(9, w.raw.length))) + ' ';
        span.onclick = () => { span.className = 'pw-word pw-missed'; span.textContent = w.raw + ' '; item._peeks++; };
      }
      div.append(span, document.createTextNode(' '));
    });
    body.append(div);
  });
  card.append(body);
  wrap.append(card);

  const nextStage = stage + 1 < FADE_STAGES.length;
  const btn = h(`<button class="btn">${nextStage ? 'Next stage →' : (qi + 1 < queue.length ? 'Done — next question →' : 'Done — finish')}</button>`);
  btn.firstChild.onclick = () => {
    if (nextStage) render(() => fadeScreen(d, queue, qi, stage + 1, results), false);
    else {
      results.push({ n: item.n, peeks: item._peeks });
      render(() => fadeScreen(d, queue, qi + 1, 0, results), false);
    }
  };
  wrap.append(btn);
  if (nextStage) {
    const skip = h(`<button class="btn secondary">Skip to next question</button>`);
    skip.firstChild.onclick = () => { results.push({ n: item.n, peeks: item._peeks }); render(() => fadeScreen(d, queue, qi + 1, 0, results), false); };
    wrap.append(skip);
  }
  main().append(wrap);
}

// ---- First-Letter typer ----
function typerScreen(d, queue, qi, results) {
  const item = queue[qi];
  if (!item) { practiceSummary(d, 'First-Letter', results.map(r => `Q${r.n} — ${r.acc}% (${r.missed.length ? 'missed: ' + r.missed.join(', ') : 'perfect'})`), queue.length); return; }
  setHeader(`First-Letter · Q${item.n}`, { back: true });

  const words = tokenize(item.a).flatMap((line, li) => [...line.map(w => ({ ...w, li })), { raw: '\n', key: null, br: true, li }]);
  words.pop();
  let pos = 0, misses = 0, missedWords = [], wordMisses = 0;
  const startTs = Date.now();

  const wrap = document.createElement('div');
  wrap.append(h(`
    <div class="muted" style="margin:2px 4px 10px">Question ${qi + 1} of ${queue.length} · type the first letter of each word</div>
    <div class="card"><div style="font-weight:700;font-size:15px;line-height:1.5">Q${item.n}. ${esc(item.q)}</div></div>`));

  const card = document.createElement('div');
  card.className = 'card';
  card.style.minHeight = '120px';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:15px;line-height:1.9';
  const cursor = h(`<span style="color:var(--gold);font-weight:700">▊</span>`).firstChild;
  body.append(cursor);
  card.append(body);
  const inp = h(`<input autocapitalize="off" autocomplete="off" autocorrect="off" style="position:absolute;opacity:0.01;height:1px;width:1px;border:none">`).firstChild;
  card.append(inp);
  card.onclick = () => inp.focus();
  wrap.append(card);
  wrap.append(h(`<div class="muted" style="font-size:12px;margin:0 4px 8px">Tap the card if the keyboard hides. Three misses on a word reveals it.</div>`));

  const bar = h(`<div class="progressbar"><div style="width:0%"></div></div>`).firstElementChild;
  wrap.append(bar);

  const total = words.filter(w => w.key).length;
  let correct = 0;

  function placeWord(w, missed) {
    const span = document.createElement('span');
    span.className = 'pw-word ' + (missed ? 'pw-missed' : 'pw-revealed');
    span.textContent = w.raw + ' ';
    body.insertBefore(span, cursor);
  }
  function advanceAutos() {
    while (pos < words.length && !words[pos].key) {
      if (words[pos].br) body.insertBefore(document.createElement('br'), cursor);
      else placeWord(words[pos], false);
      pos++;
    }
    bar.firstElementChild.style.width = (pos / words.length * 100) + '%';
    if (pos >= words.length) finish();
  }
  function finish() {
    const secs = Math.round((Date.now() - startTs) / 1000);
    const acc = total ? Math.round(100 * correct / total) : 100;
    results.push({ n: item.n, acc, missed: missedWords, secs });
    CR.logPractice(prDocId(d, item), prN(item), 'typer', acc);
    toast(`Q${item.n}: ${acc}% in ${SC.fmtSecs(secs)}`);
    render(() => typerScreen(d, queue, qi + 1, results), false);
  }
  function handle(ch) {
    if (pos >= words.length) return;
    const w = words[pos];
    if (ch === w.key) {
      placeWord(w, wordMisses >= 3);
      if (wordMisses < 3) correct++;
      pos++; wordMisses = 0;
      advanceAutos();
    } else {
      misses++; wordMisses++;
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      if (wordMisses >= 3) {
        missedWords.push(w.raw.replace(/[.,;:!?”’)]+$/, ''));
        placeWord(w, true);
        pos++; wordMisses = 0;
        advanceAutos();
      }
    }
  }
  inp.oninput = () => {
    const v = inp.value.toLowerCase();
    inp.value = '';
    const m = v.match(/[a-z0-9]/);
    if (m) handle(m[0]);
  };
  advanceAutos();
  setTimeout(() => inp.focus(), 100);

  const skip = h(`<button class="btn secondary" style="margin-top:14px">Skip this question</button>`);
  skip.firstChild.onclick = () => { render(() => typerScreen(d, queue, qi + 1, results), false); };
  wrap.append(skip);
  main().append(wrap);
}

// ---- Scramble: rebuild the text by tapping pieces in order ----
function scrambleScreen(d, queue, qi, results) {
  const item = queue[qi];
  if (!item) { practiceSummary(d, 'Scramble', results.map(r => `Q${r.n} — ${r.acc}%${r.hints ? ' (' + r.hints + ' hint' + (r.hints === 1 ? '' : 's') + ')' : ''}`), queue.length); return; }
  setHeader(`Scramble · Q${item.n}`, { back: true });

  const flat = tokenize(item.a).flat().filter(w => w.raw && w.raw.trim());
  const per = flat.length > 60 ? 4 : flat.length > 28 ? 2 : 1;   // long texts scramble in phrases
  const chips = [];
  for (let i = 0; i < flat.length; i += per) chips.push(flat.slice(i, i + per).map(w => w.raw).join(' '));
  const idx = chips.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }

  let next = 0, firstTry = 0, attemptedThis = false, hints = 0;
  const wrap = document.createElement('div');
  wrap.append(h(`
    <div class="muted" style="margin:2px 4px 10px">Question ${qi + 1} of ${queue.length} · tap the pieces in order</div>
    <div class="card"><div style="font-weight:700;font-size:15px;line-height:1.5">Q${item.n}. ${esc(item.q)}</div></div>`));

  const built = document.createElement('div');
  built.className = 'card';
  built.style.cssText = 'min-height:90px;font-size:15px;line-height:1.9';
  wrap.append(built);

  const bar = h(`<div class="progressbar" style="margin:10px 0"><div style="width:0%"></div></div>`).firstElementChild;
  wrap.append(bar);

  const pool = document.createElement('div');
  pool.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:4px';
  wrap.append(pool);

  const btns = [];
  idx.forEach(ci => {
    const b = document.createElement('button');
    b.textContent = chips[ci];
    b.style.cssText = 'padding:9px 12px;border-radius:3px;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:14px;cursor:pointer;max-width:100%;text-align:left';
    b.onclick = () => tap(b);
    pool.append(b);
    btns.push(b);
  });

  const hintFrag = h(`<button class="btn secondary" style="margin-top:14px">Hint — flash the next piece</button>`);
  hintFrag.firstChild.onclick = () => {
    const b = btns.find(x => x.isConnected && x.textContent === chips[next]);
    if (!b) return;
    hints++; attemptedThis = true;
    b.style.boxShadow = '0 0 0 2px var(--gold)';
    setTimeout(() => { b.style.boxShadow = ''; }, 900);
  };
  wrap.append(hintFrag);
  const skip = h(`<button class="btn secondary">Skip this question</button>`);
  skip.firstChild.onclick = () => { render(() => scrambleScreen(d, queue, qi + 1, results), false); };
  wrap.append(skip);

  function tap(b) {
    if (b.textContent === chips[next]) {
      if (!attemptedThis) firstTry++;
      attemptedThis = false;
      b.remove();
      const span = document.createElement('span');
      span.textContent = chips[next] + ' ';
      built.append(span);
      next++;
      bar.firstElementChild.style.width = (next / chips.length * 100) + '%';
      if (next >= chips.length) finish();
    } else {
      attemptedThis = true;
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      b.style.borderColor = 'var(--danger)';
      setTimeout(() => { b.style.borderColor = 'var(--line)'; }, 500);
    }
  }
  function finish() {
    const acc = chips.length ? Math.round(100 * firstTry / chips.length) : 100;
    results.push({ n: item.n, acc, hints });
    CR.logPractice(prDocId(d, item), prN(item), 'scramble', acc);
    toast(`Q${item.n}: ${acc}%`);
    render(() => scrambleScreen(d, queue, qi + 1, results), false);
  }
  main().append(wrap);
}

// ---- Flashcards: adaptive session queue ----
// Pool = authorized cards (priority: weakest mastery, then stalest, then question order for new).
// Active set starts with up to 3; a new card enters only when every active card's latest
// session rating is 3+. Selection is weighted (6−rating)² with a no-immediate-repeat gap.
// Budget counts presentations (repeats count). Exit ratings (×20) feed mastery — one entry per card.

function buildFlashPool(d, queue, order = 'adaptive') {
  const arr = queue.map(item => ({ ...item, m: CR.mastery(prDocId(d, item), prN(item)), last: CR.lastPracticeTs(prDocId(d, item), prN(item)) }));
  // 'seq' — introduce cards strictly in written order (v1, v2, v3…). The active-set
  // rotation (flashNext) still favors the weakest, so it's adaptive from the start
  // outward, never dropping you at a random verse.
  if (order === 'seq') return arr.sort((a, b) => a.n - b.n);
  return arr.sort((a, b) => {
    const am = a.m === null ? 999 : a.m, bm = b.m === null ? 999 : b.m;
    if (am !== bm) return am - bm;          // weakest practiced first, new (999) last
    if (a.last !== b.last) return a.last - b.last;  // staler first
    return a.n - b.n;
  });
}

function flashNext(session) {
  // choose next card among active, weighted by (6-rating)^2, avoiding the most recent 1-2 shows
  const act = session.active;
  if (!act.length) return null;
  const gap = act.length >= 3 ? 2 : act.length === 2 ? 1 : 0;
  const recent = session.shown.slice(-gap);
  const eligible = act.filter(c => !recent.includes(c.n));
  const cands = eligible.length ? eligible : act;
  const weights = cands.map(c => Math.pow(6 - (session.ratings[c.n] || 1), 2));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) { roll -= weights[i]; if (roll <= 0) return cands[i]; }
  return cands[cands.length - 1];
}

function flashIntroduce(session) {
  if (!session.pool.length) return;
  // session start, or active set emptied by retirements: seed with up to `seed`.
  // Sequential mode seeds 1 so it truly starts at the beginning and grows outward.
  const seed = session.seed || 3;
  if (session.active.length === 0 || session.shown.length === 0) {
    while (session.pool.length && session.active.length < seed) session.active.push(session.pool.shift());
    return;
  }
  // mid-session: one new card at a time, only when every active card is rated 3+,
  // and never past 8 in rotation (keeps sessions focused)
  if (session.active.length < 8 && session.active.every(c => (session.ratings[c.n] || 0) >= 3)) {
    session.active.push(session.pool.shift());
  }
}

function flashSession(d, queue, budget, order = 'adaptive') {
  const session = {
    pool: buildFlashPool(d, queue, order),
    byN: Object.fromEntries(queue.map(i => [i.n, i])),   // SM5: n → item, for per-chapter mastery logging
    active: [], shown: [], ratings: {}, exit: {}, reps: 0, budget,
    seed: order === 'seq' ? 1 : 3
  };
  flashIntroduce(session);
  flashCard(d, session);
}

function flashEnd(d, session) {
  const touched = Object.keys(session.exit);
  touched.forEach(n => { const it = session.byN[n] || { n: Number(n) }; CR.logPractice(prDocId(d, it), prN(it), 'flash', session.exit[n] * 20); });
  const dist = [1, 2, 3, 4, 5].map(r => `${r}: ${touched.filter(n => session.exit[n] === r).length}`).join('  ·  ');
  practiceSummary(d, 'Flashcards', [
    `${session.reps} card${session.reps === 1 ? '' : 's'} studied · ${touched.length} question${touched.length === 1 ? '' : 's'} touched`,
    `Exit ratings — ${dist}`,
    ...(session.pool.length ? [`${session.pool.length} authorized card${session.pool.length === 1 ? '' : 's'} never came up — that's fine.`] : [])
  ], touched.length);
}

function flashCard(d, session) {
  if (session.reps >= session.budget || (!session.active.length && !session.pool.length)) {
    render(() => flashEnd(d, session), false);
    return;
  }
  if (!session.active.length) flashIntroduce(session);
  const item = flashNext(session);
  if (!item) { render(() => flashEnd(d, session), false); return; }
  setHeader(`Flashcards · Q${item.n}`, { back: true });
  let flipped = false;

  const wrap = document.createElement('div');
  const isNew = session.exit[item.n] === undefined && CR.mastery(prDocId(d, item), prN(item)) === null;
  wrap.append(h(`<div class="row" style="margin:2px 4px 10px">
    <div class="grow muted">card ${session.reps + 1} of ${session.budget} · ${session.active.length} in rotation${session.pool.length ? ' · ' + session.pool.length + ' waiting' : ''}</div>
    ${isNew ? '<span class="badge" style="background:var(--gold)">NEW</span>' : ''}
  </div>`));
  const bar = h(`<div class="progressbar" style="margin-bottom:12px"><div style="width:${session.reps / session.budget * 100}%"></div></div>`);
  wrap.append(bar);

  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'min-height:220px;display:flex;flex-direction:column;justify-content:center;cursor:pointer;text-align:center;padding:24px 18px';
  draw();
  wrap.append(card);

  const endBtn = h(`<button class="btn secondary" style="margin-top:14px">End session</button>`);
  endBtn.firstChild.onclick = () => render(() => flashEnd(d, session), false);
  wrap.append(endBtn);
  main().append(wrap);

  function draw() {
    card.innerHTML = '';
    if (!flipped) {
      card.append(h(`
        <div><div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Question ${item.n}</div>
        <div style="font-size:17px;font-weight:700;line-height:1.5">${esc(item.q)}</div>
        <div class="muted" style="margin-top:18px;font-size:13px">tap to flip</div></div>`));
      card.onclick = () => { flipped = true; draw(); };
    } else {
      card.onclick = null;
      card.append(h(`
        <div><div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Answer</div>
        <div style="font-size:14px;line-height:1.65;text-align:left;white-space:pre-line">${esc(item.a)}</div>
        <div class="muted" style="margin:16px 0 8px;font-size:12px">How well did you know it?</div>
        <div class="row" style="justify-content:center;gap:10px" data-a="ratings"></div></div>`));
      const row = card.querySelector('[data-a=ratings]');
      const colors = { 1: 'var(--danger)', 2: 'var(--ember)', 3: 'var(--gold)', 4: 'var(--forest)', 5: 'var(--accent)' };
      for (let r = 1; r <= 5; r++) {
        const btn = h(`<button style="width:44px;height:44px;border-radius:50%;border:2px solid ${colors[r]};background:none;color:${colors[r]};font-size:16px;font-weight:700;cursor:pointer">${r}</button>`).firstChild;
        btn.onclick = () => rate(r);
        row.append(btn);
      }
    }
  }
  function rate(r) {
    session.reps++;
    session.shown.push(item.n);
    session.ratings[item.n] = r;
    session.exit[item.n] = r;
    if (r === 5) session.active = session.active.filter(c => c.n !== item.n);   // retire
    flashIntroduce(session);
    render(() => flashCard(d, session), false);
  }
}

// Phase 7.4 — plain in-order flashcards: one linear pass, each card once, front to
// back. No adaptive reordering. Ratings feed mastery just like the adaptive deck
// (rating × 20), one entry per card. `exit` accumulates ratings across the recursion.
function orderedFlashCard(d, queue, idx, exit) {
  if (idx >= queue.length) {
    const touched = Object.keys(exit);
    const dist = [1, 2, 3, 4, 5].map(r => `${r}: ${touched.filter(n => exit[n] === r).length}`).join('  ·  ');
    practiceSummary(d, 'Flashcards (in order)', [
      `${touched.length} of ${queue.length} card${queue.length === 1 ? '' : 's'} rated`,
      ...(touched.length ? [`Exit ratings — ${dist}`] : [])
    ], touched.length);
    return;
  }
  const item = queue[idx];
  setHeader(`Flashcards · Q${item.n}`, { back: true });
  let flipped = false;

  const wrap = document.createElement('div');
  wrap.append(h(`<div class="row" style="margin:2px 4px 10px">
    <div class="grow muted">card ${idx + 1} of ${queue.length} · in order</div>
  </div>`));
  wrap.append(h(`<div class="progressbar" style="margin-bottom:12px"><div style="width:${idx / queue.length * 100}%"></div></div>`));

  const card = document.createElement('div');
  card.className = 'card';
  card.style.cssText = 'min-height:220px;display:flex;flex-direction:column;justify-content:center;cursor:pointer;text-align:center;padding:24px 18px';
  draw();
  wrap.append(card);

  const endBtn = h(`<button class="btn secondary" style="margin-top:14px">End session</button>`).firstChild;
  endBtn.onclick = () => render(() => orderedFlashCard(d, queue, queue.length, exit), false);
  wrap.append(endBtn);
  main().append(wrap);

  function draw() {
    card.innerHTML = '';
    if (!flipped) {
      card.append(h(`
        <div><div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Question ${item.n}</div>
        <div style="font-size:17px;font-weight:700;line-height:1.5">${esc(item.q)}</div>
        <div class="muted" style="margin-top:18px;font-size:13px">tap to flip</div></div>`));
      card.onclick = () => { flipped = true; draw(); };
    } else {
      card.onclick = null;
      card.append(h(`
        <div><div class="muted" style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Answer</div>
        <div style="font-size:14px;line-height:1.65;text-align:left;white-space:pre-line">${esc(item.a)}</div>
        <div class="muted" style="margin:16px 0 8px;font-size:12px">How well did you know it?</div>
        <div class="row" style="justify-content:center;gap:10px" data-a="ratings"></div></div>`));
      const row = card.querySelector('[data-a=ratings]');
      const colors = { 1: 'var(--danger)', 2: 'var(--ember)', 3: 'var(--gold)', 4: 'var(--forest)', 5: 'var(--accent)' };
      for (let r = 1; r <= 5; r++) {
        const btn = h(`<button style="width:44px;height:44px;border-radius:50%;border:2px solid ${colors[r]};background:none;color:${colors[r]};font-size:16px;font-weight:700;cursor:pointer">${r}</button>`).firstChild;
        btn.onclick = () => rate(r);
        row.append(btn);
      }
    }
  }
  function rate(r) {
    exit[item.n] = r;
    CR.logPractice(prDocId(d, item), prN(item), 'flash', r * 20);
    render(() => orderedFlashCard(d, queue, idx + 1, exit), false);
  }
}

function practiceSummary(d, mode, lines, count) {
  setHeader('Practice complete', { back: true });
  const wrap = document.createElement('div');
  wrap.append(h(`
    <div class="card" style="text-align:center;padding:26px 16px">
      <div class="big">🎉</div>
      <div style="font-weight:700;font-size:17px;margin-top:6px">${mode} session complete</div>
      <div class="muted" style="margin-top:4px">${count} question${count === 1 ? '' : 's'} practiced</div>
    </div>`));
  if (lines.length) {
    const card = document.createElement('div');
    card.className = 'card';
    lines.forEach(l => card.append(h(`<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--line)">${esc(l)}</div>`)));
    wrap.append(card);
  }
  const again = h(`<button class="btn">Practice again</button>`);
  again.firstChild.onclick = () => { stack.pop(); rerender(); };
  wrap.append(again);
  const done = h(`<button class="btn secondary">Done</button>`);
  done.firstChild.onclick = () => { stack.pop(); stack.pop(); rerender(); };
  wrap.append(done);
  main().append(wrap);
}

// ---------- Fitness ----------
let ftMode = 'level';
let ftSearch = '';

const FIN = 'padding:11px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px';

function fitnessHome() {
  setHeader('Fitness', { back: true });
  const wrap = document.createElement('div');
  const tabs = [['level', 'Level'], ['workouts', 'Workouts'], ['log', 'Logbook'], ['weight', 'Weight'], ['water', 'Water'], ['diet', 'Macros'], ['sleep', 'Sleep'], ['timers', 'Timers']];
  const pills = h(`<div class="pillrow">${tabs.map(([m, l]) => `<button class="pill ${ftMode === m ? 'on' : ''}" data-m="${m}">${l}</button>`).join('')}</div>`);
  pills.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { ftMode = b.dataset.m; rerender(); });
  wrap.append(pills);
  const body = document.createElement('div');
  wrap.append(body);
  main().append(wrap);
  ({ log: ftLogbook, level: ftLevel, workouts: ftWorkouts, weight: ftWeight, water: ftWater, diet: ftDiet, sleep: ftSleep, timers: ftTimers })[ftMode](body);
}

// ---- assessment / Level view ----
let ftLevelWindow = 'live';   // default Live; locked/empty is fine — a motivator to log fresh (Baruch)

function fmtBench(item) {
  if (item.rtype === 'time') return SC.fmtSecs(Math.round(item.best));
  if (item.rtype === 'rounds') return String(item.best).replace(/\.(\d+)$/, (m, d) => '+' + Number('0.' + d) * 1000);
  return item.best + ' lb';
}

// Ring radial (Phase 8 chunk c): number centered, brass progress arc around it (folio —
// arc is a hairline, never a fill). Optional `best` draws a brass notch marking the
// all-time best as a target to chase. Locked domains show a lock in a plain track ring.
function levelRing(level, size, { best = null, stroke = 4 } = {}) {
  const r = size / 2 - stroke, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r;
  const locked = level == null;
  const pct = locked ? 0 : Math.min(1, level / 99);
  const fs = Math.round(size * 0.34);
  let notch = '';
  if (best != null && best > 0 && !locked && Math.abs(best - level) >= 1) {
    const ang = -Math.PI / 2 + 2 * Math.PI * Math.min(1, best / 99);
    const ix = cx + (r - stroke) * Math.cos(ang), iy = cy + (r - stroke) * Math.sin(ang);
    const ox = cx + (r + stroke) * Math.cos(ang), oy = cy + (r + stroke) * Math.sin(ang);
    notch = `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="var(--gold)" stroke-width="1.5"/>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    ${locked ? '' : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--gold)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`}
    ${notch}
    <text x="${cx}" y="${(cy + fs * 0.35).toFixed(1)}" text-anchor="middle" style="font-family:var(--serif-display);font-size:${fs}px;font-weight:700;fill:${locked ? 'var(--text-3)' : 'var(--text)'}">${locked ? '🔒' : level}</text>
  </svg>`;
}
function tierTag(t) { return t === 'E' ? ' <span class="muted" style="font-size:10px">(modeled)</span>' : t === 'P' ? ' <span class="muted" style="font-size:10px">(provisional)</span>' : ''; }

function ftLevel(body) {
  const a = FT.assessment();
  const view = a[ftLevelWindow];
  const liveView = ftLevelWindow === 'live';
  const toggle = h(`<div class="pillrow">
    <button class="pill ${ftLevelWindow === 'live' ? 'on' : ''}" data-w="live">Live (12 mo)</button>
    <button class="pill ${ftLevelWindow === 'alltime' ? 'on' : ''}" data-w="alltime">All-time</button>
  </div>`);
  toggle.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { ftLevelWindow = b.dataset.w; rerender(); });
  body.append(toggle);

  body.append(h(`
    <div class="card" style="text-align:center;padding:22px 14px">
      <div style="display:flex;justify-content:center">${levelRing(view.overall ?? null, 96, { best: liveView ? a.alltime.overall : null, stroke: 5 })}</div>
      <div style="font-weight:700;margin-top:8px">Fitness Level</div>
      <div class="muted" style="font-size:12px">${view.overall != null
        ? view.unlockedCount + ' of 7 domains unlocked · 99 ≈ average professional'
        : liveView ? 'No results in the last 12 months — log fresh benchmarks or view All-time.' : 'Not enough data yet.'}</div>
    </div>`));

  FT.ASSESS_DOMAINS.forEach(([d, label]) => {
    const dom = view.domains[d];
    const hasDetail = dom.items.length || dom.targets.length;
    const bestLvl = liveView && a.alltime.domains[d] ? a.alltime.domains[d].level : null;
    const sub = hasDetail
      ? (dom.count + ' result' + (dom.count === 1 ? '' : 's') + (dom.unlocked ? (dom.confidence === 'estimated' ? ' · incl. estimated' : '') : ' — ' + Math.max(1, FT.UNLOCK_MIN - dom.count) + ' more to unlock'))
      : 'No scored results yet — tap to find benchmarks';
    const card = h(`
      <div class="card" style="padding:12px 14px;cursor:pointer">
        <div class="row">
          <div style="flex-shrink:0">${levelRing(dom.unlocked ? dom.level : null, 46, { best: bestLvl })}</div>
          <div class="grow">
            <div style="font-weight:700">${label}</div>
            <div class="muted" style="font-size:12px">${sub}</div>
          </div>
          <span class="chev">›</span>
        </div>
      </div>`);
    card.firstElementChild.onclick = () => render(() => ftDomainScreen(d));
    body.append(card);
  });
  const notes = [`Levels weight measured anchors above provisional and modeled (death-by) ones. Lifts score from true 1RMs only, bodyweight-relative — rep work shows as an estimated target (~lb) to chase. A domain unlocks with ${FT.UNLOCK_MIN} results${liveView ? ' inside the 12-month window' : ''}.`];
  if (a.bw && a.bw.assumed) notes.push(`Lifts scored at an assumed ~${a.bw.lbs} lb bodyweight — log your weight to refine.`);
  if (liveView && a.alltime.overall != null) notes.push('The brass notch marks your all-time best — a target to chase.');
  body.append(h(`<div class="muted" style="font-size:11px;margin:8px 4px">${notes.join(' ')}</div>`));
}

// ---- domain screen (§5): tap a domain → its assessment benchmarks + full library ----
let ftDomainView = 'assess';
function workoutForBenchmark(key) {
  const ws = FT.allWorkouts().filter(w => FT.benchmarkFor(w) === key);
  if (!ws.length) return null;
  return ws.find(w => /^1RM:/i.test(w.name)) || ws[0];
}
function benchRow(key, item) {
  const b = FT.BENCHMARKS[key];
  const w = workoutForBenchmark(key);
  const badge = b.tier === 'E' ? 'modeled' : (b.tier === 'P' || b.provisional) ? 'provisional' : 'sourced';
  const el = h(`<div class="list-item">
      <div style="flex-shrink:0;margin-right:4px">${levelRing(item ? item.level : null, 38, { stroke: 3 })}</div>
      <div class="grow"><div class="title" style="font-size:14px">${esc(b.label)}</div>
      <div class="sub">${item ? 'Best ' + fmtBench(item) + ' · ' + item.count + ' log' + (item.count === 1 ? '' : 's') : 'Not done yet'} · ${badge}</div></div>
      <span class="chev">›</span></div>`);
  el.querySelector('.list-item').onclick = () => { if (w) render(() => workoutDetail(w)); else toast('No workout for this benchmark yet — create one'); };
  return el;
}
function libRow(w) {
  const n = FT.logsFor(w.id).length, pr = FT.prFor(w.id);
  const el = h(`<div class="list-item">
      <div class="grow"><div class="title" style="font-size:14px">${esc(w.name)}${w.custom ? ' <span class="muted" style="font-size:11px">(custom)</span>' : ''}</div>
      <div class="sub">${n ? n + ' log' + (n === 1 ? '' : 's') : 'never done'}${pr ? ' · PR ' + esc(pr.result) : ''}</div></div>
      <span class="badge" style="background:var(--nt)">${w.resultType.toUpperCase()}</span><span class="chev">›</span></div>`);
  el.querySelector('.list-item').onclick = () => render(() => workoutDetail(w));
  return el;
}
function ftDomainScreen(d) {
  const label = (FT.ASSESS_DOMAINS.find(x => x[0] === d) || ['', d])[1];
  setHeader(label, { back: true });
  const wrap = document.createElement('div');
  const a = FT.assessment();
  const domA = a.alltime.domains[d], domL = a.live.domains[d];
  const shownLevel = domL.unlocked ? domL.level : (domA.unlocked ? domA.level : null);
  const summary = domL.unlocked ? 'Live level ' + domL.level
    : domA.unlocked ? 'All-time ' + domA.level + ' · nothing in the last 12 months'
    : Math.max(1, FT.UNLOCK_MIN - domL.count) + ' more result' + (FT.UNLOCK_MIN - domL.count === 1 ? '' : 's') + ' to unlock';
  wrap.append(h(`<div class="card" style="text-align:center;padding:16px 14px">
      <div style="display:flex;justify-content:center">${levelRing(shownLevel, 74, { best: domL.unlocked ? null : (domA.unlocked ? domA.level : null), stroke: 5 })}</div>
      <div style="font-weight:700;margin-top:6px">${label}</div>
      <div class="muted" style="font-size:12px">${summary}</div>
    </div>`));
  const toggle = h(`<div class="pillrow">
      <button class="pill ${ftDomainView === 'assess' ? 'on' : ''}" data-v="assess">Assessment</button>
      <button class="pill ${ftDomainView === 'lib' ? 'on' : ''}" data-v="lib">Full library</button>
    </div>`);
  toggle.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { ftDomainView = b.dataset.v; render(() => ftDomainScreen(d)); });
  wrap.append(toggle);
  const list = document.createElement('div');
  if (ftDomainView === 'assess') {
    const keys = Object.keys(FT.BENCHMARKS).filter(k => FT.BENCHMARKS[k].domain === d);
    const itemByKey = {}; domA.items.forEach(it => itemByKey[it.key] = it);
    const done = keys.filter(k => itemByKey[k]).sort((x, y) => itemByKey[y].level - itemByKey[x].level);
    const todo = keys.filter(k => !itemByKey[k]);
    if (done.length) { list.append(sectionTitle('Your benchmarks')); done.forEach(k => list.append(benchRow(k, itemByKey[k]))); }
    if (todo.length) { list.append(sectionTitle('Try these to raise ' + label)); todo.forEach(k => list.append(benchRow(k, null))); }
    list.append(h(`<div class="muted" style="font-size:11px;margin:8px 4px">These are the workouts that move ${label}'s level. Do one and log it to add it to your assessment. Rings show your level on each; "modeled" = a death-by estimate, "provisional" = a tunable anchor.</div>`));
  } else {
    const pool = FT.byDomain(d);
    list.append(h(`<div class="muted" style="font-size:12px;margin:2px 4px 8px">${pool.length} workouts tagged ${label} — every one you can browse or log, scored or not.</div>`));
    pool.slice(0, 80).forEach(w => list.append(libRow(w)));
  }
  wrap.append(list);
  main().append(wrap);
}

function logRow(l, { showName = true } = {}) {
  const w = FT.getWorkout(l.wid);
  const pr = FT.prFor(l.wid);
  const isPr = pr && pr.ts === l.ts && pr.result === l.result;
  const el = h(`
    <div class="list-item">
      <div class="grow">
        <div class="title" style="font-size:14px">${showName && w ? esc(w.name) : esc(l.result)}${isPr ? ' <span style="color:var(--gold)">★ PR</span>' : ''}</div>
        <div class="sub">${showName ? esc(l.result) + ' · ' : ''}${new Date(l.ts).toLocaleDateString()}${l.rx ? ' · ' + esc(l.rx) : ''}${l.weights ? ' · ' + esc(l.weights) : ''}</div>
        ${(l.details || []).map(x => `<div class="sub">↳ ${esc(x.exercise)}${x.weight ? ' · ' + esc(x.weight) + ' lb' : ''}${x.reps ? ' · ' + esc(x.reps) + ' reps' : ''}${x.sets ? ' × ' + esc(x.sets) + ' sets' : ''}</div>`).join('')}
        ${l.notes ? `<div class="sub" style="font-style:italic">${esc(l.notes)}</div>` : ''}
      </div>
      ${l.user ? '<button data-a="del" style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>' : ''}
      ${showName ? '<span class="chev">›</span>' : ''}
    </div>`);
  const del = el.querySelector('[data-a=del]');
  if (del) del.onclick = e => { e.stopPropagation(); FT.removeLog(l.id); toast('Entry removed'); rerender(); };
  if (showName && w) el.querySelector('.list-item').onclick = () => render(() => workoutDetail(w));
  return el;
}

function ftLogbook(body) {
  const btn = h(`<button class="btn" style="margin-bottom:8px">＋ Log a workout</button>`);
  btn.firstChild.onclick = () => render(workoutPicker);
  body.append(btn);
  const cbtn = h(`<button class="btn secondary" style="margin-bottom:14px">＋ Build a workout (multi-part)</button>`);
  cbtn.firstChild.onclick = () => { cardDraft = null; render(workoutTemplatePicker); };
  body.append(cbtn);
  const cards = FT.allCards();
  if (cards.length) {
    body.append(sectionTitle('Workouts'));
    cards.slice(0, 10).forEach(c => {
      const logged = c.parts.filter(p => p.logId).length;
      const el = h(`<div class="list-item"><div class="grow"><div class="title" style="font-size:14px">${esc(c.name)}</div>
        <div class="sub">${c.parts.length} part${c.parts.length === 1 ? '' : 's'}${logged < c.parts.length ? ' · ' + logged + '/' + c.parts.length + ' logged' : ''} · ${new Date(c.ts).toLocaleDateString()}</div></div><span class="chev">›</span></div>`);
      el.querySelector('.list-item').onclick = () => render(() => workoutCardDetail(FT.getCard(c.id)));
      body.append(el);
    });
  }
  body.append(sectionTitle('Recent'));
  FT.allLogs().slice(0, 25).forEach(l => body.append(logRow(l)));
}

let cardDraft = null;   // {name, ts, parts:[wid], slots:[label]}
function workoutTemplatePicker() {
  setHeader('Choose a template', { back: true });
  const wrap = document.createElement('div');
  wrap.append(h(`<div class="muted" style="font-size:12px;margin:2px 4px 10px">Pick a shape for today's workout, then drop your movements in. Everything's editable.</div>`));
  FT.WORKOUT_TEMPLATES.forEach(tpl => {
    const el = h(`<div class="list-item"><div class="grow"><div class="title" style="font-size:14px">${esc(tpl.name)}</div>
        <div class="sub">${tpl.slots.length ? tpl.slots.join(' · ') : 'Start from scratch'}</div></div><span class="chev">›</span></div>`);
    el.querySelector('.list-item').onclick = () => {
      cardDraft = { name: tpl.id === 'custom' ? '' : tpl.name, ts: Date.now(), parts: [], slots: tpl.slots.slice() };
      render(workoutCardBuilder);
    };
    wrap.append(el);
  });
  main().append(wrap);
}
function workoutCardBuilder() {
  setHeader('Build a workout', { back: true });
  if (!cardDraft) cardDraft = { name: '', ts: Date.now(), parts: [], slots: [] };
  const wrap = document.createElement('div');
  const card = h(`<div class="card">
      <input data-a="name" placeholder="${esc(FT.defaultCardName(cardDraft.ts))}" value="${esc(cardDraft.name)}" style="width:100%;${FIN};margin-bottom:8px">
      <input data-a="date" type="date" value="${new Date(cardDraft.ts - new Date(cardDraft.ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10)}" style="${FIN};margin-bottom:10px">
      <h3 style="margin-top:0">Components</h3>
      <div data-a="parts"></div>
      <button class="btn secondary" data-a="addpart" style="margin:6px 0 10px">＋ Add component</button>
      <button class="btn" data-a="save">Save workout</button>
    </div>`).firstElementChild;
  const nameI = card.querySelector('[data-a=name]'); nameI.oninput = () => cardDraft.name = nameI.value;
  const dateI = card.querySelector('[data-a=date]'); dateI.onchange = () => { cardDraft.ts = dateI.value ? new Date(dateI.value + 'T12:00:00').getTime() : Date.now(); };
  const partsBox = card.querySelector('[data-a=parts]');
  const slots = cardDraft.slots || [];
  if (!cardDraft.parts.length && !slots.length) partsBox.append(h(`<div class="muted" style="font-size:13px;margin-bottom:6px">No components yet — add your Part A, Part B…</div>`));
  cardDraft.parts.forEach((wid, i) => {
    const w = FT.getWorkout(wid);
    const slot = slots[i] ? ` <span class="muted" style="font-size:11px">(${esc(slots[i])})</span>` : '';
    const row = h(`<div class="list-item"><div class="grow"><div class="title" style="font-size:14px">${FT.cardPartLabel(i)}: ${esc(w ? w.name : '—')}${slot}</div></div><button data-x="rm" style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button></div>`);
    row.querySelector('[data-x=rm]').onclick = () => { cardDraft.parts.splice(i, 1); render(workoutCardBuilder); };
    partsBox.append(row);
  });
  slots.slice(cardDraft.parts.length).forEach((label, j) => {
    const idx = cardDraft.parts.length + j;
    partsBox.append(h(`<div class="list-item" style="cursor:default;opacity:.6"><div class="grow"><div class="title" style="font-size:14px">${FT.cardPartLabel(idx)}: <span class="muted">${esc(label)}</span></div></div><span class="muted" style="font-size:12px">to fill</span></div>`));
  });
  card.querySelector('[data-a=addpart]').onclick = () => render(cardComponentPicker);
  card.querySelector('[data-a=save]').onclick = () => {
    if (!cardDraft.parts.length) { toast('Add at least one component'); return; }
    const c = FT.addCard({ name: cardDraft.name, ts: cardDraft.ts, parts: cardDraft.parts.map(wid => ({ wid })) });
    cardDraft = null;
    render(() => workoutCardDetail(c));
  };
  wrap.append(card);
  main().append(wrap);
}

function cardComponentPicker() {
  setHeader('Add component', { back: true });
  const wrap = document.createElement('div');
  const inp = h(`<input placeholder="Search workouts…" style="width:100%;${FIN};margin-bottom:10px">`).firstChild;
  const list = document.createElement('div');
  const draw = () => {
    list.innerHTML = '';
    const q = inp.value.toLowerCase();
    FT.allWorkouts().filter(w => !q || w.name.toLowerCase().includes(q)).slice(0, 30).forEach(w => {
      const el = h(`<div class="list-item"><div class="grow"><div class="title" style="font-size:14px">${esc(w.name)}</div></div><span class="chev">＋</span></div>`);
      el.querySelector('.list-item').onclick = () => { cardDraft.parts.push(w.id); render(workoutCardBuilder); };
      list.append(el);
    });
  };
  inp.oninput = draw;
  wrap.append(inp, list);
  main().append(wrap);
  draw();
  setTimeout(() => inp.focus(), 50);
}

function workoutCardDetail(card) {
  if (!card) { goBack(); return; }
  setHeader(card.name, { back: true });
  const wrap = document.createElement('div');
  wrap.append(h(`<div class="muted" style="margin-bottom:8px">${new Date(card.ts).toLocaleDateString()}</div>`));
  card.parts.forEach((p, i) => {
    const w = FT.getWorkout(p.wid);
    const log = p.logId ? FT.allLogs().find(l => l.id === p.logId) : null;
    const c = h(`<div class="card" style="padding:12px 14px">
        <div class="row"><div class="grow"><div style="font-weight:700">${FT.cardPartLabel(i)}: ${esc(w ? w.name : '—')}</div>
        <div class="muted" style="font-size:12px">${log ? esc(log.result) + (log.rx ? ' · ' + esc(log.rx) : '') : 'Not logged yet'}</div></div>
        ${log ? '' : '<button class="pill on" data-a="log" style="padding:9px 15px">Log</button>'}</div></div>`);
    const lb = c.querySelector('[data-a=log]');
    if (lb) lb.onclick = () => render(() => logForm(w, '', { cardId: card.id, partIdx: i }));
    wrap.append(c);
  });
  const del = h(`<button class="btn danger" style="margin-top:12px">Delete workout</button>`);
  del.firstChild.onclick = () => { FT.removeCard(card.id); toast('Workout deleted'); goBack(); };
  wrap.append(del);
  main().append(wrap);
}

function workoutPicker() {
  setHeader('Log a workout', { back: true });
  const wrap = document.createElement('div');
  const inp = h(`<input placeholder="Search ${FT.allWorkouts().length} workouts…" value="${esc(ftSearch)}" style="width:100%;${FIN};margin-bottom:10px">`).firstChild;
  const list = document.createElement('div');
  const draw = () => {
    list.innerHTML = '';
    const q = inp.value.toLowerCase();
    ftSearch = inp.value;
    FT.allWorkouts().filter(w => !q || w.name.toLowerCase().includes(q) || (w.movements || '').toLowerCase().includes(q))
      .slice(0, 30).forEach(w => {
        const n = FT.logsFor(w.id).length;
        const el = h(`<div class="list-item">
          <div class="grow"><div class="title" style="font-size:14px">${esc(w.name)}</div>
          <div class="sub">${esc((w.movements || '').slice(0, 60))}${n ? ' · ' + n + ' log' + (n === 1 ? '' : 's') : ''}</div></div>
          <span class="badge" style="background:var(--nt)">${w.resultType.toUpperCase()}</span>
        </div>`);
        el.querySelector('.list-item').onclick = () => render(() => logForm(w));
        list.append(el);
      });
  };
  inp.oninput = draw;
  const create = h(`<button class="btn" style="margin-bottom:12px">＋ New workout</button>`);
  create.firstChild.onclick = () => render(workoutBuilder);
  wrap.append(create, inp, list);
  main().append(wrap);
  draw();
  setTimeout(() => inp.focus(), 50);
}

function ftMoveRow(m = {}) {
  return `<div class="row ft-move" style="gap:6px;margin-bottom:6px;align-items:center">
      <input data-m="movement" placeholder="Movement" value="${esc(m.movement || '')}" style="flex:2;min-width:88px;${FIN}">
      <input data-m="load" placeholder="Load" value="${esc(m.load || '')}" style="width:66px;${FIN};text-align:center">
      <input data-m="reps" placeholder="Reps" value="${esc(m.reps || '')}" style="width:66px;${FIN};text-align:center">
      <button class="pill ft-move-del" style="padding:8px 11px" aria-label="Remove movement">×</button>
    </div>`;
}
function ftSetRow(reps = '', load = '') {
  return `<div class="row ft-set" style="gap:6px;margin-bottom:6px">
      <input data-s="reps" inputmode="numeric" placeholder="Reps" value="${esc(reps)}" style="flex:1;${FIN};text-align:center">
      <input data-s="load" inputmode="decimal" placeholder="Load (lb)" value="${esc(load)}" style="flex:1;${FIN};text-align:center">
    </div>`;
}
function ftResultZone(fmt, w, prefill) {
  const P = { time: 'e.g. 12:34', load: 'e.g. 225 lbs', reps: 'e.g. 42', rounds: 'e.g. 5+12', completed: 'done' }[w.resultType] || 'Result';
  const hasMoves = w.moves && w.moves.length;
  const partBlock = label => hasMoves
    ? `<div class="muted" style="font-size:12px;margin:6px 0 4px">${label}</div>` +
      w.moves.map((m, i) => `<div class="row" style="gap:6px;margin-bottom:6px;align-items:center">
          <div class="grow" style="font-size:13px">${esc(m.movement)}</div>
          <input data-p="${i}" inputmode="numeric" placeholder="0" style="width:66px;${FIN};text-align:center">
        </div>`).join('')
    : `<input data-r="reps" inputmode="numeric" placeholder="${label}" style="width:100%;${FIN};text-align:center">`;
  if (fmt === 'amrap') return `<div class="row" style="gap:6px;margin-bottom:6px">
      <input data-r="min" inputmode="numeric" placeholder="Min" style="width:64px;${FIN};text-align:center">
      <input data-r="rounds" inputmode="numeric" placeholder="Full rounds" style="flex:1;${FIN};text-align:center">
    </div>${partBlock('Reps into partial round')}`;
  if (fmt === 'emom') return `<input data-r="rounds" inputmode="numeric" placeholder="Rounds / minutes" style="width:100%;${FIN};text-align:center;margin-bottom:6px">${partBlock('Reps in the last round')}`;
  if (fmt === 'fortime' || fmt === 'chipper') return `<div class="row" style="gap:6px;align-items:center">
      <input data-r="time" placeholder="mm:ss" value="${esc(prefill)}" style="flex:1;${FIN};text-align:center">
      <label class="muted" style="display:flex;align-items:center;gap:4px;font-size:12px"><input type="checkbox" data-r="capped"> capped</label>
      <input data-r="reps" inputmode="numeric" placeholder="reps" style="width:64px;${FIN};text-align:center">
    </div>`;
  if (fmt === 'strength') return `<div data-r="sets">${ftSetRow()}</div>
    <button class="btn secondary" data-r="addset" style="margin-bottom:4px">＋ Add set</button>`;
  if (fmt === 'cardio') return `<input data-r="modality" placeholder="run / row / bike / swim" value="${esc((w.movements || '').split('\n')[0] || '')}" style="width:100%;${FIN};margin-bottom:6px">
    <div class="row" style="gap:6px">
      <input data-r="dist" placeholder="Distance (e.g. 5 km)" style="flex:1;${FIN}">
      <input data-r="time" placeholder="Time mm:ss" value="${esc(prefill)}" style="flex:1;${FIN};text-align:center"></div>`;
  if (fmt === 'tabata') return `<input data-r="per" placeholder="Reps per round, comma-separated" style="width:100%;${FIN}">
    <div class="muted" style="font-size:11px;margin-top:4px">Score = lowest round · total.</div>`;
  if (fmt === 'intervals') return `<input data-r="per" placeholder="Result per round, comma-separated" style="width:100%;${FIN};margin-bottom:6px">
    <input data-r="total" placeholder="Total (optional)" style="width:100%;${FIN}">`;
  return `<input data-r="result" placeholder="${P}" value="${esc(prefill)}" style="width:100%;${FIN}">`;
}
function ftReadResult(form, fmt, w) {
  const val = k => { const el = form.querySelector(`[data-r=${k}]`); return el ? el.value : ''; };
  if (fmt === 'strength') {
    const sets = [...form.querySelectorAll('.ft-set')].map(r => ({
      reps: r.querySelector('[data-s=reps]').value.trim(),
      load: r.querySelector('[data-s=load]').value.trim()
    }));
    return FT.buildResult('strength', { sets });
  }
  if (fmt === 'amrap' || fmt === 'emom') {
    const hasMoves = w && w.moves && w.moves.length;
    const parts = hasMoves ? w.moves.map((m, i) => { const el = form.querySelector(`[data-p="${i}"]`); return el ? el.value : 0; }) : null;
    const base = { min: val('min'), rounds: val('rounds'), reps: val('reps') };
    return FT.buildResult(fmt, hasMoves ? { ...base, parts } : base);
  }
  if (fmt === 'fortime' || fmt === 'chipper') {
    const capped = form.querySelector('[data-r=capped]');
    return FT.buildResult(fmt, { time: val('time'), capped: capped && capped.checked, reps: val('reps') });
  }
  if (fmt === 'cardio') return FT.buildResult('cardio', { modality: val('modality'), dist: val('dist'), time: val('time') });
  if (fmt === 'tabata') return FT.buildResult('tabata', { per: val('per').split(',').map(s => s.trim()).filter(Boolean) });
  if (fmt === 'intervals') return FT.buildResult('intervals', { per: val('per').split(',').map(s => s.trim()).filter(Boolean), total: val('total') });
  return FT.buildResult('other', { result: val('result') });
}

function logForm(w, prefillResult = '', ctx = null) {
  setHeader(w.name, { back: true });
  const wrap = document.createElement('div');
  const pr = FT.prFor(w.id);
  wrap.append(h(`
    <div class="card">
      ${w.movements ? `<div style="font-size:14px;line-height:1.6;white-space:pre-line">${esc(w.movements)}</div>` : '<div class="muted">No description</div>'}
      ${pr ? `<div class="muted" style="margin-top:8px;font-size:12px">★ PR: ${esc(pr.result)} (${new Date(pr.ts).toLocaleDateString()})</div>` : ''}
    </div>`));
  const fmt = FT.formatOf(w);
  const form = h(`
    <div class="card"><h3>Result <span class="muted" style="font-size:11px;font-weight:400">· ${esc((FT.FORMATS.find(f => f[0] === fmt) || ['', ''])[1])}</span></h3>
      <div class="row" style="margin-bottom:8px">
        <input data-a="date" type="date" value="${todayKey()}" style="${FIN}">
      </div>
      <div data-a="resultzone" style="margin-bottom:8px">${ftResultZone(fmt, w, prefillResult)}</div>
      <div class="pillrow" style="margin-bottom:8px">
        <button class="pill on" data-rx="rx">Rx</button>
        <button class="pill" data-rx="down">−Rx</button>
        <button class="pill" data-rx="up">+Rx</button>
      </div>
      <div class="pillrow" style="margin-bottom:8px;align-items:center">
        <span class="muted" style="font-size:12px;margin-right:2px">Effort</span>
        <button class="pill" data-rpe="1">1</button>
        <button class="pill" data-rpe="2">2</button>
        <button class="pill" data-rpe="3">3</button>
        <button class="pill" data-rpe="4">4</button>
        <button class="pill" data-rpe="5">5</button>
      </div>
      <input data-a="weights" placeholder="Weights used (optional)" style="width:100%;${FIN};margin-bottom:8px">
      <input data-a="notes" placeholder="Notes (optional)" style="width:100%;${FIN};margin-bottom:8px">
      <div data-a="details"></div>
      <button class="btn secondary" data-a="adddetail" style="margin-bottom:8px">＋ Add exercise line (weight · reps · sets)</button>
      <button class="btn" data-a="save">Save to logbook</button>
    </div>`).firstElementChild;
  const detailBox = form.querySelector('[data-a=details]');
  form.querySelector('[data-a=adddetail]').onclick = () => {
    detailBox.append(h(`
      <div class="row detail-line" style="margin-bottom:8px;flex-wrap:wrap">
        <input data-d="exercise" placeholder="Exercise" style="flex:2;min-width:110px;${FIN}">
        <input data-d="weight" placeholder="Wt" inputmode="decimal" style="width:64px;${FIN};text-align:center">
        <input data-d="reps" placeholder="Reps" inputmode="numeric" style="width:62px;${FIN};text-align:center">
        <input data-d="sets" placeholder="Sets" inputmode="numeric" style="width:62px;${FIN};text-align:center">
      </div>`));
    const rows = detailBox.querySelectorAll('.detail-line');
    rows[rows.length - 1].querySelector('[data-d=exercise]').focus();
  };
  const addSetBtn = form.querySelector('[data-r=addset]');
  if (addSetBtn) addSetBtn.onclick = () => {
    const box = form.querySelector('[data-r=sets]');
    box.append(h(ftSetRow()));
    box.lastElementChild.querySelector('[data-s=reps]').focus();
  };
  let rxStatus = 'rx';
  form.querySelectorAll('[data-rx]').forEach(b => b.onclick = () => {
    rxStatus = b.dataset.rx;
    form.querySelectorAll('[data-rx]').forEach(x => x.classList.toggle('on', x.dataset.rx === rxStatus));
  });
  let rpe = null;
  form.querySelectorAll('[data-rpe]').forEach(b => b.onclick = () => {
    rpe = rpe === b.dataset.rpe ? null : b.dataset.rpe;
    form.querySelectorAll('[data-rpe]').forEach(x => x.classList.toggle('on', rpe && x.dataset.rpe === rpe));
  });
  form.querySelector('[data-a=save]').onclick = () => {
    const built = ftReadResult(form, fmt, w);
    const result = built.result || (w.resultType === 'completed' ? 'Completed' : '');
    if (!result) { toast('Enter your result'); return; }
    const dateStr = form.querySelector('[data-a=date]').value;
    const ts = dateStr ? new Date(dateStr + 'T12:00:00').getTime() : Date.now();
    const wasPr = FT.isPR(w.id, result);
    const details = [...form.querySelectorAll('.detail-line')].map(row => ({
      exercise: row.querySelector('[data-d=exercise]').value.trim(),
      weight: row.querySelector('[data-d=weight]').value.trim(),
      reps: row.querySelector('[data-d=reps]').value.trim(),
      sets: row.querySelector('[data-d=sets]').value.trim()
    })).filter(x => x.exercise);
    const newLog = FT.addLog({ wid: w.id, ts, result, resultType: w.resultType, rxStatus, rpe, score: built.score, groupId: ctx ? ctx.cardId : null, weights: form.querySelector('[data-a=weights]').value.trim(), notes: form.querySelector('[data-a=notes]').value.trim(), details });
    if (wasPr) celebrate('New PR! ★');
    toast(wasPr ? 'PR logged — ' + result : 'Logged ' + result);
    if (ctx) { FT.cardSetPartLog(ctx.cardId, ctx.partIdx, newLog.id); render(() => workoutCardDetail(FT.getCard(ctx.cardId))); }
    else goBack();
  };
  wrap.append(form);

  const timerBtn = h(`<button class="btn secondary">⏱ Start a timer for this workout</button>`);
  timerBtn.firstChild.onclick = () => render(() => ftTimersScreen(w));
  wrap.append(timerBtn);
  main().append(wrap);
}

let ftDomainFilter = 'all';

function ftWorkouts(body) {
  const doms = [['all', 'All'], ...FT.ASSESS_DOMAINS];
  const dpills = h(`<div class="pillrow">${doms.map(([d, l]) =>
    `<button class="pill ${ftDomainFilter === d ? 'on' : ''}" data-d="${d}">${l}${d === 'all' ? '' : ' (' + FT.byDomain(d).length + ')'}</button>`).join('')}</div>`);
  dpills.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { ftDomainFilter = b.dataset.d; rerender(); });
  body.append(dpills);

  const pool = ftDomainFilter === 'all' ? FT.allWorkouts() : FT.byDomain(ftDomainFilter);
  const inp = h(`<input placeholder="Search ${pool.length} workouts…" style="width:100%;${FIN};margin-bottom:10px">`).firstChild;
  const list = document.createElement('div');
  const draw = () => {
    list.innerHTML = '';
    const q = inp.value.toLowerCase();
    pool.filter(w => !q || w.name.toLowerCase().includes(q) || (w.movements || '').toLowerCase().includes(q))
      .slice(0, q ? 60 : 40).forEach(w => {
        const n = FT.logsFor(w.id).length;
        const pr = FT.prFor(w.id);
        const el = h(`<div class="list-item">
          <div class="grow"><div class="title" style="font-size:14px">${esc(w.name)}${w.custom ? ' <span class="muted" style="font-size:11px">(custom)</span>' : ''}${String(w.id).startsWith('cl') ? ' <span class="muted" style="font-size:11px">(classic)</span>' : ''}</div>
          <div class="sub">${(FT.ASSESS_DOMAINS.find(x => x[0] === w.domain) || ['', ''])[1]}${n ? ' · ' + n + ' log' + (n === 1 ? '' : 's') : ' · never done'}${pr ? ' · PR ' + esc(pr.result) : ''}</div></div>
          <span class="badge" style="background:var(--nt)">${w.resultType.toUpperCase()}</span>
          <span class="chev">›</span>
        </div>`);
        el.querySelector('.list-item').onclick = () => render(() => workoutDetail(w));
        list.append(el);
      });
  };
  inp.oninput = draw;
  const create = h(`<button class="btn" style="margin-bottom:10px">＋ New workout</button>`);
  create.firstChild.onclick = () => render(workoutBuilder);
  body.append(create, inp, list);
  draw();
}

function workoutDetail(w) {
  setHeader(w.name, { back: true });
  const wrap = document.createElement('div');
  const logs = FT.logsFor(w.id);
  const pr = FT.prFor(w.id);
  wrap.append(h(`
    <div class="card">
      ${w.movements ? `<div style="font-size:14px;line-height:1.6;white-space:pre-line">${esc(w.movements)}</div>` : '<div class="muted">No description</div>'}
      <div class="statgrid" style="margin-top:12px">
        <div class="stat"><div class="v">${logs.length}</div><div class="l">Times done</div></div>
        <div class="stat"><div class="v" style="color:var(--gold)">${pr ? esc(pr.result) : '—'}</div><div class="l">Personal record</div></div>
      </div>
    </div>`));
  // primary action — log a result
  const logBtn = h(`<button class="btn">＋ Log a result</button>`);
  logBtn.firstChild.onclick = () => render(() => logForm(w));
  wrap.append(logBtn);

  // secondary actions collapse into a pill row
  const pills = h(`<div class="pillrow" style="margin-top:12px">
    <button class="pill" data-s="timer">⏱ Timer</button>
    <button class="pill" data-s="addcard">Add to card</button>
    ${w.custom ? '<button class="pill" data-s="delete" style="color:var(--danger)">Delete</button>' : ''}
  </div>`);
  pills.querySelector('[data-s=timer]').onclick = () => render(() => ftTimersScreen(w));
  pills.querySelector('[data-s=addcard]').onclick = () => { if (!cardDraft) cardDraft = { name: '', ts: Date.now(), parts: [] }; cardDraft.parts.push(w.id); toast('Added — build the card'); render(workoutCardBuilder); };
  const delPill = pills.querySelector('[data-s=delete]');
  if (delPill) delPill.onclick = () => workoutRemoveSheet(w);
  wrap.append(pills);

  if (logs.length) {
    wrap.append(sectionTitle('History'));
    logs.forEach(l => wrap.append(logRow(l, { showName: false })));
  }
  main().append(wrap);
}

// Delete-workout confirm sheet (custom workouts only)
function workoutRemoveSheet(w) {
  openSheet('Delete workout', (body, close) => {
    body.append(h(`<div class="muted" style="margin-bottom:14px">Delete “${esc(w.name)}” and its log history? This can't be undone.</div>`));
    const del = h(`<button class="btn danger">Delete this workout</button>`);
    del.firstChild.onclick = () => { FT.removeCustomWorkout(w.id); toast('Workout deleted'); close(); goBack(); };
    body.append(del);
    const cancel = h(`<button class="btn secondary">Cancel</button>`);
    cancel.firstChild.onclick = close;
    body.append(cancel);
  });
}

function workoutBuilder() {
  setHeader('New workout', { back: true });
  const wrap = document.createElement('div');
  const form = h(`
    <div class="card">
      <input data-a="name" placeholder="Workout name" style="width:100%;${FIN};margin-bottom:10px">
      <h3 style="margin-top:0">Movements</h3>
      <div data-a="moves">${ftMoveRow()}</div>
      <button class="btn secondary" data-a="addmove" style="margin-bottom:12px">＋ Add movement</button>
      <h3>Format</h3>
      <div class="pillrow" data-a="formats">${FT.FORMATS.map(([v, l], i) => `<button class="pill ${i === 0 ? 'on' : ''}" data-f="${v}">${l}</button>`).join('')}</div>
      <h3>Scored by</h3>
      <div class="pillrow" data-a="types">${FT.RESULT_TYPES.map(([v, l], i) => `<button class="pill ${i === 0 ? 'on' : ''}" data-t="${v}">${l}</button>`).join('')}</div>
      <h3>Domain</h3>
      <div class="pillrow" data-a="domains">${FT.ASSESS_DOMAINS.map(([v, l]) => `<button class="pill ${v === 'light' ? 'on' : ''}" data-dm="${v}">${l}</button>`).join('')}</div>
      <div class="row" data-a="extras" style="margin-bottom:10px;flex-wrap:wrap"></div>
      <button class="btn" data-a="save">Create workout</button>
    </div>`).firstElementChild;
  let format = 'fortime', rtype = 'time', wdomain = 'light';
  form.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => {
    wdomain = b.dataset.dm;
    form.querySelectorAll('[data-dm]').forEach(x => x.classList.toggle('on', x.dataset.dm === wdomain));
  });
  const movesBox = form.querySelector('[data-a=moves]');
  form.querySelector('[data-a=addmove]').onclick = () => {
    movesBox.append(h(ftMoveRow()));
    movesBox.lastElementChild.querySelector('[data-m=movement]').focus();
  };
  movesBox.addEventListener('click', e => {
    const del = e.target.closest('.ft-move-del');
    if (!del) return;
    e.preventDefault();
    if (movesBox.querySelectorAll('.ft-move').length > 1) del.closest('.ft-move').remove();
  });
  const extras = form.querySelector('[data-a=extras]');
  function drawExtras() {
    extras.innerHTML = '';
    if (format === 'amrap' || format === 'fortime') extras.append(h(`<input data-x="cap" placeholder="Time cap (min)" inputmode="numeric" style="width:130px;${FIN}">`).firstChild);
    if (format === 'emom') {
      extras.append(h(`<input data-x="interval" placeholder="Interval (sec)" inputmode="numeric" style="width:120px;${FIN}">`).firstChild);
      extras.append(h(`<input data-x="rounds" placeholder="Rounds" inputmode="numeric" style="width:90px;${FIN}">`).firstChild);
    }
    if (format === 'tabata') {
      extras.append(h(`<input data-x="work" placeholder="Work (sec)" inputmode="numeric" value="20" style="width:100px;${FIN}">`).firstChild);
      extras.append(h(`<input data-x="rest" placeholder="Rest (sec)" inputmode="numeric" value="10" style="width:100px;${FIN}">`).firstChild);
      extras.append(h(`<input data-x="rounds" placeholder="Rounds" inputmode="numeric" value="8" style="width:90px;${FIN}">`).firstChild);
    }
    if (format === 'intervals') {
      extras.append(h(`<input data-x="rounds" placeholder="Rounds" inputmode="numeric" style="width:90px;${FIN}">`).firstChild);
      extras.append(h(`<input data-x="work" placeholder="Work (sec)" inputmode="numeric" style="width:100px;${FIN}">`).firstChild);
      extras.append(h(`<input data-x="rest" placeholder="Rest (sec)" inputmode="numeric" style="width:100px;${FIN}">`).firstChild);
    }
  }
  form.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    format = b.dataset.f;
    form.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x.dataset.f === format));
    const auto = { fortime: 'time', amrap: 'rounds', emom: 'completed', intervals: 'time', tabata: 'reps', strength: 'load', chipper: 'time', cardio: 'time', skill: 'completed', other: 'time' }[format];
    rtype = auto;
    form.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === rtype));
    drawExtras();
  });
  form.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    rtype = b.dataset.t;
    form.querySelectorAll('[data-t]').forEach(x => x.classList.toggle('on', x.dataset.t === rtype));
  });
  drawExtras();
  form.querySelector('[data-a=save]').onclick = () => {
    const name = form.querySelector('[data-a=name]').value.trim();
    if (!name) { toast('Give the workout a name'); return; }
    const gx = k => { const el = form.querySelector(`[data-x=${k}]`); return el ? Number(el.value) || 0 : 0; };
    const moves = [...form.querySelectorAll('.ft-move')].map(r => ({
      movement: r.querySelector('[data-m=movement]').value.trim(),
      load: r.querySelector('[data-m=load]').value.trim(),
      reps: r.querySelector('[data-m=reps]').value.trim()
    })).filter(m => m.movement);
    const w = FT.addCustomWorkout({
      name, moves,
      resultType: rtype, format, domain: wdomain,
      cap: gx('cap') * 60, interval: gx('interval'), rounds: gx('rounds'), work: gx('work'), rest: gx('rest')
    });
    toast('Workout created');
    render(() => workoutDetail(w));
  };
  wrap.append(form);
  main().append(wrap);
}

// ---- weight ----
function ftWeight(body) {
  const entry = h(`
    <div class="card"><h3>Log weight</h3>
      <div class="row">
        <input data-a="date" type="date" value="${todayKey()}" style="${FIN}">
        <input data-a="lbs" placeholder="lbs" inputmode="decimal" style="width:90px;${FIN};text-align:center">
        <button class="pill on" data-a="add" style="padding:11px 16px">Add</button>
      </div>
    </div>`).firstElementChild;
  entry.querySelector('[data-a=add]').onclick = () => {
    const lbs = Number(entry.querySelector('[data-a=lbs]').value);
    if (!lbs) { toast('Enter your weight'); return; }
    const dateStr = entry.querySelector('[data-a=date]').value;
    FT.addWeight(dateStr ? new Date(dateStr + 'T12:00:00').getTime() : Date.now(), lbs);
    toast('Weight logged');
    rerender();
  };
  body.append(entry);

  // goal config (§6) collapses into a pill → sheet
  const g = FT.weightGoal();
  const pills = h(`<div class="pillrow" style="margin-top:2px">
    <button class="pill" data-s="goal">Goal${g && g.lbs ? ' · ' + g.lbs + ' lb' : ''}</button>
  </div>`);
  pills.querySelector('[data-s=goal]').onclick = () => weightGoalSheet();
  body.append(pills);

  const ws = FT.weights();
  if (ws.length >= 2) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h3>Trend</h3>` + timesGraph(
      ws.map(x => ({ ts: x.ts, secs: x.lbs })),
      { fmt: n => n + ' lbs', hiLabel: 'high', loLabel: 'low' }
    );
    body.append(card);
  }
  if (ws.length) {
    body.append(sectionTitle('Entries'));
    [...ws].reverse().slice(0, 20).forEach(x => {
      const row = h(`<div class="list-item" style="cursor:default">
        <div class="grow"><span style="font-weight:700">${x.lbs} lbs</span>
        <span class="muted" style="margin-left:8px">${new Date(x.ts).toLocaleDateString()}</span></div>
        <button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button>
      </div>`);
      row.querySelector('button').onclick = () => { FT.removeWeight(x.ts); rerender(); };
      body.append(row);
    });
  } else {
    body.append(h(`<div class="empty">One number a day. The trend chart appears after two entries.</div>`));
  }
}

// Weight goal (§6): target weight + date → needed change per week
function weightGoalSheet() {
  openSheet('Weight goal', (body, close) => {
    const g = FT.weightGoal(), pace = FT.weightGoalPace();
    const card = h(`<div>
      <div class="row" style="gap:6px">
        <input data-a="glbs" placeholder="Target lbs" inputmode="decimal" value="${g && g.lbs ? g.lbs : ''}" style="flex:1;${FIN};text-align:center">
        <input data-a="gdate" type="date" value="${g && g.byTs ? todayKey(new Date(g.byTs)) : ''}" style="flex:1;${FIN}">
      </div>
      ${pace ? `<div class="muted" style="font-size:12px;margin-top:8px">${pace.delta >= 0 ? 'Gain' : 'Lose'} ${Math.abs(pace.delta).toFixed(1)} lb in ${pace.days} day${pace.days === 1 ? '' : 's'} — about <span style="font-weight:700;color:var(--text)">${Math.abs(pace.perWeek).toFixed(1)} lb/week</span> (${Math.abs(pace.perDay).toFixed(2)}/day).</div>`
        : (g && g.lbs ? '<div class="muted" style="font-size:12px;margin-top:8px">Log a weight to see your needed pace.</div>' : '')}
      <button class="btn" data-a="gsave" style="margin-top:14px">${g && g.lbs ? 'Update goal' : 'Set goal'}</button>
    </div>`).firstElementChild;
    card.querySelector('[data-a=gsave]').onclick = () => {
      const lbs = Number(card.querySelector('[data-a=glbs]').value);
      const ds = card.querySelector('[data-a=gdate]').value;
      FT.setWeightGoal(lbs, ds ? new Date(ds + 'T12:00:00').getTime() : 0);
      toast(lbs ? 'Goal set' : 'Goal cleared');
      close(); rerender();
    };
    body.append(card);
  });
}

// progress ring for trackers (fraction of a goal, not a 0–99 level)
function pctRing(centerText, pct, size = 88, stroke = 6) {
  const r = size / 2 - stroke, cx = size / 2, cy = size / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--gold)" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(p * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 5}" text-anchor="middle" style="font-family:var(--serif-display);font-size:16px;font-weight:700;fill:var(--text)">${centerText}</text></svg>`;
}
function fmtDur(mins) { const hh = Math.floor(mins / 60), mm = mins % 60; return hh + 'h' + (mm ? ' ' + mm + 'm' : ''); }

// ---- water (§7) ----
function ftWater(body) {
  const goal = FT.waterGoal(), today = FT.waterForDay();
  body.append(h(`<div class="card" style="text-align:center;padding:16px 14px">
      ${goal ? `<div style="display:flex;justify-content:center;margin-bottom:6px">${pctRing(today, today / goal)}</div>` : ''}
      <div style="font-family:var(--serif-display);font-size:26px;font-weight:700">${today} oz</div>
      <div class="muted" style="font-size:12px">${goal ? 'of ' + goal + ' oz today' : 'today · set a daily goal below'}</div>
    </div>`));
  const add = h(`<div class="card"><h3>Add water</h3>
      <div class="row" style="gap:6px"><input data-a="oz" placeholder="oz" inputmode="numeric" style="flex:1;${FIN};text-align:center"><button class="pill on" data-a="add" style="padding:11px 16px">Add</button></div>
      <div class="pillrow" style="margin-top:8px">${[8, 12, 16, 24, 32].map(o => `<button class="pill" data-q="${o}">+${o}</button>`).join('')}</div></div>`).firstElementChild;
  const ozI = add.querySelector('[data-a=oz]');
  const addOz = oz => { if (!oz) return; FT.addWater(Date.now(), oz); toast('+' + oz + ' oz'); rerender(); };
  add.querySelector('[data-a=add]').onclick = () => addOz(Number(ozI.value));
  add.querySelectorAll('[data-q]').forEach(b => b.onclick = () => addOz(Number(b.dataset.q)));
  body.append(add);
  // daily-goal config collapses into a pill → sheet
  const gpills = h(`<div class="pillrow" style="margin-top:2px"><button class="pill" data-s="goal">Daily goal${goal ? ' · ' + goal + ' oz' : ''}</button></div>`);
  gpills.querySelector('[data-s=goal]').onclick = () => waterGoalSheet();
  body.append(gpills);
  const te = FT.waterEntriesForDay();
  if (te.length) {
    body.append(sectionTitle("Today's log"));
    te.forEach(w => { const row = h(`<div class="list-item" style="cursor:default"><div class="grow"><span style="font-weight:700">${w.oz} oz</span> <span class="muted" style="margin-left:8px">${new Date(w.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div><button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button></div>`); row.querySelector('button').onclick = () => { FT.removeWater(w.id); rerender(); }; body.append(row); });
  }
  const days = FT.waterDays().filter(([k]) => k !== todayKey()).slice(0, 14);
  if (days.length) { body.append(sectionTitle('History')); days.forEach(([k, oz]) => body.append(h(`<div class="list-item" style="cursor:default"><div class="grow">${new Date(k + 'T12:00').toLocaleDateString()}</div><span style="font-weight:700">${oz} oz</span></div>`))); }
}

// Water daily-goal sheet
function waterGoalSheet() {
  openSheet('Daily water goal', (body, close) => {
    const goal = FT.waterGoal();
    const card = h(`<div>
      <div class="row" style="gap:6px"><input data-a="g" placeholder="oz/day" inputmode="numeric" value="${goal || ''}" style="flex:1;${FIN};text-align:center"></div>
      <button class="btn" data-a="save" style="margin-top:14px">${goal ? 'Update goal' : 'Set goal'}</button>
    </div>`).firstElementChild;
    card.querySelector('[data-a=save]').onclick = () => { FT.setWaterGoal(Number(card.querySelector('[data-a=g]').value)); toast('Goal set'); close(); rerender(); };
    body.append(card);
  });
}

// ---- diet / macros (§9) ----
function ftDiet(body) {
  const t = FT.macroTotals(), tg = FT.dietTargets();
  const bar = (lab, val, goal, unit) => `<div style="margin-bottom:8px"><div class="row" style="justify-content:space-between"><span style="font-size:13px;font-weight:700">${lab}</span><span class="muted" style="font-size:12px">${val}${goal ? ' / ' + goal : ''} ${unit}</span></div><div class="progressbar" style="margin-top:4px"><div style="width:${goal ? Math.min(100, val / goal * 100) : 0}%;background:var(--gold)"></div></div></div>`;
  body.append(h(`<div class="card"><h3>Today</h3>${bar('Protein', t.p, tg.p, 'g')}${bar('Carbs', t.c, tg.c, 'g')}${bar('Fat', t.f, tg.f, 'g')}${bar('Calories', t.cal, tg.cal, 'kcal')}</div>`));
  // daily-targets config collapses into a pill → sheet
  const tgpills = h(`<div class="pillrow" style="margin-top:2px"><button class="pill" data-s="targets">Targets${tg.cal ? ' · ' + tg.cal + ' kcal' : tg.p || tg.c || tg.f ? ' · set' : ''}</button></div>`);
  tgpills.querySelector('[data-s=targets]').onclick = () => dietTargetsSheet();
  body.append(tgpills);
  const add = h(`<div class="card"><h3>Add a meal</h3>
      <input data-a="name" placeholder="Meal name (optional)" style="width:100%;${FIN};margin-bottom:8px">
      <div class="row" style="gap:6px;margin-bottom:6px">
        <input data-a="p" placeholder="P (g)" inputmode="numeric" style="flex:1;${FIN};text-align:center">
        <input data-a="c" placeholder="C (g)" inputmode="numeric" style="flex:1;${FIN};text-align:center">
        <input data-a="f" placeholder="F (g)" inputmode="numeric" style="flex:1;${FIN};text-align:center"></div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Calories compute automatically (4·P + 4·C + 9·F).</div>
      <div class="row" style="gap:6px"><button class="btn" data-a="add" style="flex:2">Add meal</button><button class="btn secondary" data-a="preset" style="flex:1">Save preset</button></div></div>`).firstElementChild;
  const gv = k => add.querySelector(`[data-a=${k}]`).value;
  add.querySelector('[data-a=add]').onclick = () => { if (!gv('p') && !gv('c') && !gv('f')) { toast('Enter some macros'); return; } FT.addMeal({ name: gv('name'), p: gv('p'), f: gv('f'), c: gv('c') }); toast('Meal added'); rerender(); };
  add.querySelector('[data-a=preset]').onclick = () => { const name = gv('name').trim(); if (!name) { toast('Name it to save a preset'); return; } FT.addMealPreset({ name, p: gv('p'), f: gv('f'), c: gv('c') }); toast('Preset saved'); rerender(); };
  body.append(add);
  const ps = FT.mealPresets();
  if (ps.length) {
    const box = h(`<div class="card"><h3>Quick meals</h3><div class="pillrow" data-a="ps"></div></div>`).firstElementChild;
    const pr = box.querySelector('[data-a=ps]');
    ps.forEach(m => { const b = h(`<button class="pill" title="${FT.kcal(m.p, m.f, m.c)} kcal">${esc(m.name)} +</button>`).firstChild; b.onclick = () => { FT.addMeal({ name: m.name, p: m.p, f: m.f, c: m.c }); toast('Added ' + m.name); rerender(); }; b.oncontextmenu = e => { e.preventDefault(); FT.removeMealPreset(m.id); toast('Preset removed'); rerender(); }; pr.append(b); });
    box.append(h(`<div class="muted" style="font-size:11px;margin-top:6px">Tap to add · long-press / right-click to remove a preset.</div>`));
    body.append(box);
  }
  const meals = FT.mealsForDay();
  if (meals.length) {
    body.append(sectionTitle("Today's meals"));
    meals.forEach(m => { const row = h(`<div class="list-item" style="cursor:default"><div class="grow"><div class="title" style="font-size:14px">${esc(m.name || 'Meal')}</div><div class="sub">${m.p}p · ${m.c}c · ${m.f}f · ${FT.kcal(m.p, m.f, m.c)} kcal</div></div><button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button></div>`); row.querySelector('button').onclick = () => { FT.removeMeal(m.id); rerender(); }; body.append(row); });
  }
}

// Macro daily-targets sheet
function dietTargetsSheet() {
  openSheet('Daily targets', (body, close) => {
    const tg = FT.dietTargets();
    const tc = h(`<div>
      <div class="row" style="gap:6px;margin-bottom:6px">
        <input data-a="p" placeholder="P g" inputmode="numeric" value="${tg.p || ''}" style="flex:1;${FIN};text-align:center">
        <input data-a="c" placeholder="C g" inputmode="numeric" value="${tg.c || ''}" style="flex:1;${FIN};text-align:center">
        <input data-a="f" placeholder="F g" inputmode="numeric" value="${tg.f || ''}" style="flex:1;${FIN};text-align:center">
        <input data-a="cal" placeholder="kcal" inputmode="numeric" value="${tg.cal || ''}" style="flex:1.3;${FIN};text-align:center"></div>
      <div class="muted" style="font-size:12px;margin-top:2px">Leave calories blank to auto-track against P/C/F only.</div>
      <button class="btn" data-a="save" style="margin-top:14px">Set targets</button></div>`).firstElementChild;
    tc.querySelector('[data-a=save]').onclick = () => { const q = k => tc.querySelector(`[data-a=${k}]`).value; FT.setDietTargets({ p: q('p'), c: q('c'), f: q('f'), cal: q('cal') }); toast('Targets set'); close(); rerender(); };
    body.append(tc);
  });
}

// ---- sleep (§8) ----
function ftSleep(body) {
  const last = FT.lastNightSleep();
  body.append(h(`<div class="card" style="text-align:center;padding:16px 14px">
      <div style="font-family:var(--serif-display);font-size:26px;font-weight:700">${last ? fmtDur(last.mins) : '—'}</div>
      <div class="muted" style="font-size:12px">${last ? 'last night · woke ' + new Date(last.wakeTs).toLocaleDateString() : 'no sleep logged yet'}</div></div>`));
  const now = new Date();
  const defBed = new Date(now); defBed.setDate(defBed.getDate() - (now.getHours() < 12 ? 1 : 0)); defBed.setHours(23, 0, 0, 0);
  const dtVal = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const add = h(`<div class="card"><h3>Log a night</h3>
      <div style="margin-bottom:8px"><div class="muted" style="font-size:12px;margin-bottom:3px">Bedtime</div><input data-a="bed" type="datetime-local" value="${dtVal(defBed)}" style="width:100%;${FIN}"></div>
      <div style="margin-bottom:8px"><div class="muted" style="font-size:12px;margin-bottom:3px">Wake time</div><input data-a="wake" type="datetime-local" value="${dtVal(now)}" style="width:100%;${FIN}"></div>
      <div class="muted" data-a="dur" style="font-size:12px;margin-bottom:8px"></div>
      <button class="btn" data-a="save">Save</button></div>`).firstElementChild;
  const bedI = add.querySelector('[data-a=bed]'), wakeI = add.querySelector('[data-a=wake]'), durEl = add.querySelector('[data-a=dur]');
  const upd = () => { const b = new Date(bedI.value).getTime(), w = new Date(wakeI.value).getTime(); durEl.textContent = (b && w && w > b) ? 'Duration: ' + fmtDur(Math.round((w - b) / 60000)) : ''; };
  bedI.oninput = upd; wakeI.oninput = upd; upd();
  add.querySelector('[data-a=save]').onclick = () => { const b = new Date(bedI.value).getTime(), w = new Date(wakeI.value).getTime(); if (!b || !w || w <= b) { toast('Wake must be after bedtime'); return; } FT.addSleep({ bedTs: b, wakeTs: w }); toast('Sleep logged'); rerender(); };
  body.append(add);
  const list = FT.sleepList();
  if (list.length) {
    body.append(sectionTitle('History'));
    list.slice(0, 20).forEach(s => { const row = h(`<div class="list-item" style="cursor:default"><div class="grow"><div class="title" style="font-size:14px">${fmtDur(s.mins)}</div><div class="sub">${new Date(s.bedTs).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} → ${new Date(s.wakeTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div><button style="border:none;background:none;color:var(--danger);font-size:15px;cursor:pointer">✕</button></div>`); row.querySelector('button').onclick = () => { FT.removeSleep(s.id); rerender(); }; body.append(row); });
  }
}

// ---- timers ----
function ftTimers(body) {
  body.append(h(`<div class="muted" style="margin:2px 4px 12px">Audio cues on round changes and the final 3 seconds.</div>`));
  ftTimerConfig(body, null);
}

function ftTimersScreen(w) {
  setHeader('Timer · ' + (w ? w.name : ''), { back: true });
  const wrap = document.createElement('div');
  ftTimerConfig(wrap, w);
  main().append(wrap);
}

function ftTimerConfig(body, w) {
  const defaults = w && w.custom ? w : {};
  const configs = [
    ['Stopwatch', 'For Time — counts up', () => ({ kind: 'stopwatch' })],
    ['Countdown', 'AMRAP — set the minutes', null],
    ['EMOM', 'Every minute (or interval) on the minute', null],
    ['Tabata', 'Work / rest intervals', null],
  ];
  const card = h(`
    <div class="card">
      <div class="pillrow" data-a="kinds">
        <button class="pill on" data-k="stopwatch">Stopwatch</button>
        <button class="pill" data-k="countdown">Countdown</button>
        <button class="pill" data-k="emom">EMOM</button>
        <button class="pill" data-k="tabata">Tabata</button>
      </div>
      <div class="row" data-a="opts" style="flex-wrap:wrap;margin-bottom:10px"></div>
      <button class="btn" data-a="go">Start</button>
    </div>`).firstElementChild;
  let kind = w && w.custom && w.format === 'amrap' ? 'countdown' : w && w.custom && ['emom', 'tabata'].includes(w.format) ? w.format : 'stopwatch';
  const opts = card.querySelector('[data-a=opts]');
  function drawOpts() {
    card.querySelectorAll('[data-k]').forEach(x => x.classList.toggle('on', x.dataset.k === kind));
    opts.innerHTML = '';
    if (kind === 'countdown') opts.append(h(`<input data-o="min" placeholder="Minutes" inputmode="numeric" value="${defaults.cap ? defaults.cap / 60 : 20}" style="width:110px;${FIN}">`).firstChild);
    if (kind === 'emom') {
      opts.append(h(`<input data-o="interval" placeholder="Interval sec" inputmode="numeric" value="${defaults.interval || 60}" style="width:130px;${FIN}">`).firstChild);
      opts.append(h(`<input data-o="rounds" placeholder="Rounds" inputmode="numeric" value="${defaults.rounds || 10}" style="width:100px;${FIN}">`).firstChild);
    }
    if (kind === 'tabata') {
      opts.append(h(`<input data-o="work" placeholder="Work" inputmode="numeric" value="${defaults.work || 20}" style="width:90px;${FIN}">`).firstChild);
      opts.append(h(`<input data-o="rest" placeholder="Rest" inputmode="numeric" value="${defaults.rest || 10}" style="width:90px;${FIN}">`).firstChild);
      opts.append(h(`<input data-o="rounds" placeholder="Rounds" inputmode="numeric" value="${defaults.rounds || 8}" style="width:100px;${FIN}">`).firstChild);
    }
  }
  card.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; drawOpts(); });
  drawOpts();
  card.querySelector('[data-a=go]').onclick = () => {
    const gv = k => { const el = card.querySelector(`[data-o=${k}]`); return el ? Number(el.value) || 0 : 0; };
    const cfg = { kind };
    if (kind === 'countdown') cfg.total = gv('min') * 60;
    if (kind === 'emom') { cfg.interval = gv('interval') || 60; cfg.rounds = gv('rounds') || 10; }
    if (kind === 'tabata') { cfg.work = gv('work') || 20; cfg.rest = gv('rest') || 10; cfg.rounds = gv('rounds') || 8; }
    render(() => timerRun(cfg, w));
  };
  body.append(card);
}

let audioCtx = null;
function beep(freq = 880, ms = 160) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    o.start();
    o.stop(audioCtx.currentTime + ms / 1000);
  } catch (e) {}
}

function timerRun(cfg, w) {
  setHeader({ stopwatch: 'Stopwatch', countdown: 'Countdown', emom: 'EMOM', tabata: 'Tabata' }[cfg.kind], { back: true });
  let elapsed = 0, running = true, done = false, lastBeepSecond = -1;
  const totalSecs = cfg.kind === 'countdown' ? cfg.total
    : cfg.kind === 'emom' ? cfg.interval * cfg.rounds
    : cfg.kind === 'tabata' ? (cfg.work + cfg.rest) * cfg.rounds
    : null;

  const wrap = h(`
    <div class="card" style="text-align:center;padding:34px 14px">
      <div class="muted" id="tm-phase" style="font-weight:700;letter-spacing:.05em;text-transform:uppercase;font-size:13px"></div>
      <div class="big" id="tm-clock" style="font-size:64px;margin-top:6px">0:00</div>
      <div class="muted" id="tm-sub" style="margin-top:4px"></div>
      <button class="btn" id="tm-pause" style="margin-top:24px">Pause</button>
      <button class="btn secondary" id="tm-done">Finish</button>
    </div>`).firstElementChild;
  const el = document.createElement('div'); el.append(wrap);
  if (w) el.append(h(`<div class="muted" style="text-align:center;margin-top:10px;font-size:13px">${esc(w.name)}</div>`));
  main().append(el);

  function view() {
    const clock = wrap.querySelector('#tm-clock');
    if (!clock || !clock.isConnected) { clearInterval(iv); return; }
    let display, phase = '', sub = '';
    if (cfg.kind === 'stopwatch') {
      display = SC.fmtSecs(elapsed);
    } else if (cfg.kind === 'countdown') {
      const remain = Math.max(0, cfg.total - elapsed);
      display = SC.fmtSecs(remain);
      if (remain <= 3 && remain > 0 && elapsed !== lastBeepSecond) { beep(660); lastBeepSecond = elapsed; }
      if (remain === 0 && !done) { done = true; beep(440, 700); phaseEnd(); }
    } else if (cfg.kind === 'emom') {
      const round = Math.min(cfg.rounds, Math.floor(elapsed / cfg.interval) + 1);
      const inRound = elapsed % cfg.interval;
      const remain = cfg.interval - inRound;
      display = SC.fmtSecs(remain);
      phase = 'Round ' + round + ' of ' + cfg.rounds;
      if (inRound === 0 && elapsed > 0 && elapsed < cfg.interval * cfg.rounds && elapsed !== lastBeepSecond) { beep(880, 250); lastBeepSecond = elapsed; }
      if (remain <= 3 && elapsed !== lastBeepSecond) { beep(660); lastBeepSecond = elapsed; }
      if (elapsed >= cfg.interval * cfg.rounds && !done) { done = true; beep(440, 700); phaseEnd(); }
    } else if (cfg.kind === 'tabata') {
      const cyc = cfg.work + cfg.rest;
      const round = Math.min(cfg.rounds, Math.floor(elapsed / cyc) + 1);
      const inCyc = elapsed % cyc;
      const working = inCyc < cfg.work;
      const remain = working ? cfg.work - inCyc : cyc - inCyc;
      display = SC.fmtSecs(remain);
      phase = (working ? 'WORK' : 'REST') + ' · round ' + round + ' of ' + cfg.rounds;
      wrap.style.borderColor = working ? 'var(--danger)' : 'var(--accent)';
      if ((inCyc === 0 || inCyc === cfg.work) && elapsed > 0 && elapsed !== lastBeepSecond) { beep(working ? 880 : 550, 250); lastBeepSecond = elapsed; }
      if (elapsed >= cyc * cfg.rounds && !done) { done = true; beep(440, 700); phaseEnd(); }
    }
    clock.textContent = display;
    wrap.querySelector('#tm-phase').textContent = phase;
    wrap.querySelector('#tm-sub').textContent = totalSecs ? 'total ' + SC.fmtSecs(Math.min(elapsed, totalSecs)) + ' / ' + SC.fmtSecs(totalSecs) : '';
  }
  function phaseEnd() { running = false; wrap.querySelector('#tm-pause').style.display = 'none'; }

  const iv = setInterval(() => { if (running && !done) { elapsed++; view(); } }, 1000);
  wrap.querySelector('#tm-pause').onclick = () => {
    running = !running;
    wrap.querySelector('#tm-pause').textContent = running ? 'Pause' : 'Resume';
  };
  wrap.querySelector('#tm-done').onclick = () => {
    clearInterval(iv);
    if (w) {
      const prefill = w.resultType === 'time' ? SC.fmtSecs(elapsed) : '';
      render(() => logForm(w, prefill), false);
      toast('Timer: ' + SC.fmtSecs(elapsed) + ' — log your result');
    } else {
      goBack();
    }
  };
  beep(880, 200);
  view();
}

// ---------- Areas hub ----------
function areas() {
  setHeader('Areas');
  const items = [
    ['Pathways', 'Step-by-step accomplishments across every area', () => render(pathwaysHome)],
    ['Scripture Memorization', 'Tracking · practice', () => render(scriptureHome)],
    ['Scripture Review', 'Times · trends · logs by corpus & chapter', () => render(reviewArea)],
    ['Scripture Reading', 'Bible reading plans · daily portions', () => render(plansScreen)],
    ['Creeds, Catechisms & Confessions', `All ${CR.docs().length} documents · read or memorize`, () => render(creedsHome)],
    ['Reading', 'Library · Up Next (5) · notes', () => render(readingHome)],
    ['Fitness', 'Workouts · logbook · timers · weight', () => { ftMode = 'level'; render(fitnessHome); }],
  ];
  const wrap = document.createElement('div');
  items.forEach(([t, sub, fn]) => {
    const el = h(`<div class="list-item" style="${fn ? '' : 'opacity:.5'}">
      <div class="grow"><div class="title">${t}</div><div class="sub">${sub}</div></div>
      <span class="chev">›</span></div>`);
    if (fn) el.querySelector('.list-item').onclick = fn;
    wrap.append(el);
  });
  main().append(wrap);
}

// ---------- Settings ----------
function settings() {
  setHeader('Settings');
  const wrap = document.createElement('div');

  const exp = h(`<div class="card"><h3>Backup</h3>
    <button class="btn secondary" id="s-export">Export all data</button>
    <button class="btn secondary" id="s-import">Import backup / old app export</button>
    <input type="file" id="s-file" accept=".json" style="display:none">
  </div>`);
  exp.querySelector('#s-export').onclick = exportAll;
  exp.querySelector('#s-import').onclick = () => document.getElementById('s-file').click();
  exp.querySelector('#s-file').onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const obj = JSON.parse(ev.target.result);
        if (obj && obj.app === 'strive' && obj.state &&
            !confirm('Restore this backup? It REPLACES all current data with the backup' +
                     (obj.exported ? ' from ' + new Date(obj.exported).toLocaleDateString() : '') +
                     '. A safety copy of the current data is kept on this device.')) return;
        const kind = importData(obj);
        SC.ensureKeys();
        toast(kind === 'old-app' ? 'Old app data migrated in' : 'Backup restored');
        rerender();
      } catch (err) { toast('Could not read that file'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };
  wrap.append(exp);

  const esvC = h(`<div class="card"><h3>ESV verse text</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Powers practice modes with real ESV text. Get a free personal-use key at api.esv.org (create an account → API Applications), then paste it here. Each chapter is fetched once and stored for offline use.</div>
    <input id="s-esv" placeholder="ESV API key" value="${esc(esvKey())}" autocapitalize="off" autocorrect="off" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px">
    <button class="btn secondary" id="s-esv-save">Save & test key</button>
    <div class="muted" id="s-esv-status" style="font-size:12px;margin-top:6px">${Object.keys(esvLoadCache()).length} chapter${Object.keys(esvLoadCache()).length === 1 ? '' : 's'} cached offline</div>
  </div>`).firstElementChild;   // live element, not a fragment — fragments empty on append, which killed the save handler
  const esvStatus = esvC.querySelector('#s-esv-status');
  esvC.querySelector('#s-esv-save').onclick = async () => {
    setEsvKey(esvC.querySelector('#s-esv').value);
    if (!esvKey()) { esvStatus.textContent = 'Key cleared.'; return; }
    esvStatus.textContent = 'Testing key…';
    delete esvLoadCache()['John 11'];
    try { await esvFetchChapter('John', 11); esvStatus.textContent = '✓ Key works — ESV text is live'; }
    catch (e) { esvStatus.textContent = e.message === 'bad-key' ? '✗ Key rejected — double-check it at api.esv.org' : '✗ Could not verify (offline?) — key saved anyway'; }
  };
  wrap.append(esvC);

  // Phase 6.1 — vision key for TOC scanning
  const visC = h(`<div class="card"><h3>Table-of-contents scanning</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Reads chapter titles and page numbers from a photo of a book's contents page. With a key it uses a vision model, which handles titles that wrap onto two lines and skips subheadings. Without one it falls back to on-device OCR, which is noticeably rougher. Get a key at console.anthropic.com. Costs well under a cent per scan.</div>
    <input id="s-vis" placeholder="Anthropic API key" value="${esc(VIS.visionKey())}" autocapitalize="off" autocorrect="off" style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px">
    <button class="btn secondary" id="s-vis-save">Save key</button>
    <div class="muted" id="s-vis-status" style="font-size:12px;margin-top:6px">${VIS.visionKey() ? 'Key saved — scans use the vision model.' : 'No key — scans use on-device OCR.'}</div>
    <div class="muted" style="font-size:11px;margin-top:8px;line-height:1.5">This key is stored with the rest of your app data, so it syncs to your other devices and is readable on any unlocked one. Fine for personal use — but if you share a device, clear it here.</div>
  </div>`).firstElementChild;
  const visStatus = visC.querySelector('#s-vis-status');
  visC.querySelector('#s-vis-save').onclick = () => {
    VIS.setVisionKey(visC.querySelector('#s-vis').value);
    visStatus.textContent = VIS.visionKey()
      ? '✓ Key saved — scans use the vision model. It\'s checked on your next scan.'
      : 'Key cleared — scans use on-device OCR.';
  };
  wrap.append(visC);

  // Phase 5 — daily verse rotation editor
  const dvC = h(`<div class="card"><h3>Daily verse rotation</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">One reference per line — "Hebrews 4:11" or "Romans 12:1-2" (one chapter per entry). The dashboard shows one of these each day, in order, using ESV text.</div>
    <textarea id="s-dv" rows="7" autocapitalize="off" autocorrect="off" style="width:100%;padding:11px;border:1px solid var(--line);border-radius:3px;background:var(--bg);color:var(--text);font-size:14px;font-family:var(--serif-body)">${esc(dailyVerseList().join('\n'))}</textarea>
    <button class="btn secondary" id="s-dv-save">Save list</button>
    <div class="muted" id="s-dv-status" style="font-size:12px;margin-top:6px">${dailyVerseList().length} verses in rotation</div>
  </div>`).firstElementChild;
  dvC.querySelector('#s-dv-save').onclick = () => {
    const status = dvC.querySelector('#s-dv-status');
    const lines = dvC.querySelector('#s-dv').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) { status.textContent = '✗ List cannot be empty — keep at least one verse.'; return; }
    const bad = lines.filter(x => !parseVerseRef(x));
    if (bad.length) { status.textContent = '✗ Not recognized: ' + bad.join(' · '); return; }
    state.settings.dailyVerses = lines;
    save();
    status.textContent = '✓ Saved — ' + lines.length + ' verses in rotation';
  };
  wrap.append(dvC);

  wrap.append(syncCard());

  const danger = h(`<div class="card"><h3>Danger zone</h3>
    <input id="s-reset-confirm" placeholder='Type "RESET" to enable' style="width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:15px">
    <button class="btn danger" id="s-reset" disabled style="opacity:.4">Erase all Strive data</button>
  </div>`);
  const rc = danger.querySelector('#s-reset-confirm'), rb = danger.querySelector('#s-reset');
  rc.oninput = () => { const ok = rc.value.trim() === 'RESET'; rb.disabled = !ok; rb.style.opacity = ok ? '1' : '.4'; };
  rb.onclick = () => {
    ['strive-v1', 'strive-esv-v1', 'strive-sync-session', 'strive-sync-meta'].forEach(k => localStorage.removeItem(k));
    location.reload();   // sync config (URL/key) survives; sign back in to re-link — the first-link guard decides cloud vs device
  };
  wrap.append(danger);

  main().append(wrap);
}

// ---------- Settings: sync card (Supabase whole-state blob) ----------
function syncCard() {
  const inp = 'width:100%;padding:12px;border-radius:3px;border:1px solid var(--line);background:var(--bg);color:var(--text);font-size:14px;margin-bottom:8px';
  const st = SY.status();

  if (!st.configured) {
    const c = h(`<div class="card"><h3>Sync</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Cross-device sync via your own free Supabase project — see SUPABASE-SETUP.md in the deploy folder. Paste the project's URL and anon key once per device.</div>
      <input id="sy-url" placeholder="https://xxxx.supabase.co" autocapitalize="off" autocorrect="off" style="${inp}">
      <input id="sy-key" placeholder="anon public key" autocapitalize="off" autocorrect="off" style="${inp}">
      <button class="btn secondary" id="sy-connect">Connect</button>
    </div>`).firstElementChild;
    c.querySelector('#sy-connect').onclick = () => {
      const url = c.querySelector('#sy-url').value.trim(), key = c.querySelector('#sy-key').value.trim();
      if (!url || !key) { toast('Enter both the URL and the anon key'); return; }
      SY.setConfig(url, key);
      toast('Connected — now sign in');
      rerender();
    };
    return c;
  }

  if (!st.signedIn) {
    const c = h(`<div class="card"><h3>Sync</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Sign in once on each device — same email + password everywhere. First device: Create account.</div>
      <input id="sy-em" type="email" placeholder="email" autocapitalize="off" autocorrect="off" style="${inp}">
      <input id="sy-pw" type="password" placeholder="password" style="${inp}">
      <button class="btn secondary" id="sy-in">Sign in</button>
      <button class="btn secondary" id="sy-up">Create account</button>
      <button class="btn secondary" id="sy-cfg" style="margin-top:8px;font-size:12px">Change server</button>
      <div class="muted" id="sy-msg" style="font-size:12px;margin-top:6px"></div>
    </div>`).firstElementChild;
    const msg = c.querySelector('#sy-msg');
    const go = async (fn) => {
      const em = c.querySelector('#sy-em').value.trim(), pw = c.querySelector('#sy-pw').value;
      if (!em || !pw) { msg.textContent = 'Email and password required.'; return; }
      msg.textContent = 'Working…';
      try {
        await fn(em, pw);
        msg.textContent = 'Signed in — syncing…';
        const r = await SY.syncNow({ interactive: true });
        toast(r === 'pushed-first' ? 'This device is now the cloud copy ✓' : r === 'pulled-first' ? 'Cloud data loaded ✓' : 'Sync ready ✓');
        rerender();
      } catch (e) { msg.textContent = '✗ ' + e.message; }
    };
    c.querySelector('#sy-in').onclick = () => go(SY.signIn);
    c.querySelector('#sy-up').onclick = () => go(SY.signUp);
    c.querySelector('#sy-cfg').onclick = () => { if (confirm('Forget the saved Supabase URL/key on this device?')) { SY.setConfig('', ''); rerender(); } };
    return c;
  }

  const last = st.lastRemoteTs ? new Date(st.lastRemoteTs).toLocaleString() : 'never';
  const c = h(`<div class="card"><h3>Sync</h3>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Signed in as <b>${esc(st.email || '')}</b><br>Last sync: <span id="sy-last">${esc(last)}</span>${st.dirty ? ' · unsynced changes' : ''}${st.lastError ? '<br>⚠️ ' + esc(st.lastError) : ''}</div>
    <button class="btn secondary" id="sy-now">Sync now</button>
    <button class="btn secondary" id="sy-out">Sign out</button>
  </div>`).firstElementChild;
  c.querySelector('#sy-now').onclick = async () => {
    const b = c.querySelector('#sy-now');
    b.textContent = 'Syncing…';
    try {
      const r = await SY.syncNow({ interactive: true });
      if (r === 'in-sync') toast('Up to date ✓');
      else if (r && r.startsWith('pushed')) toast('Pushed to cloud ✓');
      // pulled* toasts arrive via onPulled
    } catch (e) { toast('Sync failed: ' + e.message); }
    rerender();
  };
  c.querySelector('#sy-out').onclick = () => { SY.signOut(); toast('Signed out — data stays on this device'); rerender(); };
  return c;
}

// ---------- boot ----------
const TABS = { home: dashboard, today, plan, areas, settings };
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('h-back').onclick = goBack;
  document.querySelectorAll('nav.tabbar button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  switchTab('home');
  SY.onPulled(() => { SC.ensureKeys(); toast('Synced from cloud ☁️'); rerender(); });
  SY.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
});
