// ==UserScript==
// @name         מתמחים טופ – למי נתתי לייק ודיסלייק
// @namespace    mitmachim-my-votes
// @version      2.0
// @description  לייקים ודיסלייקים שנתת ושקיבלת: סיכום לפי משתמש, לפי נושא ולפי פוסט, עם חיפוש
// @match        https://mitmachim.top/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MAX_PAGES = 50;           // עד כמה עמודים לטעון מכל רשימה
  const cache = { upvoted: null, downvoted: null, received: null };
  const stamp = {};               // מתי כל רשימה נטענה
  let sort = 'count';             // count | date
  let limit = 100;                // כמה פריטים להציג ("הצג עוד")
  let tab = 'upvoted';            // upvoted | downvoted | received
  let view = 'posts';             // posts | users | topics | mutual

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toText = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; d.querySelectorAll('blockquote, img').forEach(e => e.remove()); return d.textContent.replace(/\s+/g, ' ').trim(); };
  const decode = (s) => { const t = document.createElement('textarea'); t.innerHTML = s || ''; return t.value; };
  const me = () => window.app && app.user && app.user.userslug;
  const date = (iso) => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };

  /* ---------- טעינת הנתונים מהפורום ---------- */
  async function fetchAll(kind, onProgress) {
    const slug = me();
    if (!slug) throw new Error('צריך להיות מחובר לפורום');
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`/api/user/${encodeURIComponent(slug)}/${kind}?page=${page}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('הפורום החזיר שגיאה ' + res.status);
      const data = await res.json();
      const posts = data.posts || [];
      out.push(...posts.map(p => ({
        pid: p.pid,
        user: p.user ? (p.user.displayname || p.user.username) : 'משתמש',
        userslug: p.user && p.user.userslug,
        picture: p.user && p.user.picture,
        iconText: p.user && p.user['icon:text'],
        iconBg: p.user && p.user['icon:bgColor'],
        topic: p.topic ? decode(p.topic.title) : '',
        text: toText(p.content),
        time: p.timestampISO,
      })));
      onProgress && onProgress(out.length);
      const pageCount = data.pagination && data.pagination.pageCount;
      if (!posts.length || !pageCount || page >= pageCount) break;
    }
    return out;
  }


  /* ---------- הצבעות שקיבלתי ---------- */
  const namesOf = (j) => {
    const r = (j && (j.response || j.payload)) || j || {};
    const arr = r.upvoters || r.downvoters || r.users || (Array.isArray(r) ? r : []);
    return arr.map(x => typeof x === 'string' ? x : (x.displayname || x.username)).filter(Boolean);
  };
  async function voters(pid, dir) {
    try {
      let res = await fetch(`/api/v3/posts/${pid}/${dir}`, { credentials: 'same-origin' });
      if (!res.ok) res = await fetch(`/api/post/${dir}?pid=${pid}`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return namesOf(await res.json());
    } catch (e) { return null; }
  }
  async function fetchReceived(onProgress) {
    const slug = me();
    if (!slug) throw new Error('צריך להיות מחובר לפורום');
    const posts = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`/api/user/${encodeURIComponent(slug)}/posts?page=${page}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('הפורום החזיר שגיאה ' + res.status);
      const data = await res.json();
      const ps = data.posts || [];
      posts.push(...ps.map(p => ({
        pid: p.pid,
        up: +p.upvotes || 0,
        down: +p.downvotes || 0,
        topic: p.topic ? decode(p.topic.title) : '',
        text: toText(p.content),
        time: p.timestampISO,
        ups: null, downs: null,
      })));
      onProgress && onProgress(`טוען פוסטים… ${posts.length}`);
      const pc = data.pagination && data.pagination.pageCount;
      if (!ps.length || !pc || page >= pc) break;
    }
    const todo = [];
    posts.forEach(p => { if (p.up) todo.push([p, 'upvoters', 'ups']); if (p.down) todo.push([p, 'downvoters', 'downs']); });
    let done = 0, i = 0, failed = 0;
    async function worker() {
      while (i < todo.length) {
        const [p, dir, key] = todo[i++];
        const r = await voters(p.pid, dir);
        if (r) p[key] = r; else failed++;
        onProgress && onProgress(`בודק מי הצביע… ${++done}/${todo.length}`);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { posts, failed };
  }

  /* ---------- שמירה מקומית (טעינה מהירה) ---------- */
  const SK = () => 'mvt2:' + me() + ':';
  function saveLocal(kind) { try { localStorage.setItem(SK() + kind, JSON.stringify({ t: stamp[kind], d: cache[kind] })); } catch (e) {} }
  function loadLocal(kind) {
    try { const o = JSON.parse(localStorage.getItem(SK() + kind)); if (o && o.d) { cache[kind] = o.d; stamp[kind] = o.t; return true; } } catch (e) {}
    return false;
  }
  function ago(t) {
    if (!t) return '';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'עכשיו' : m < 60 ? `לפני ${m} דק׳` : m < 1440 ? `לפני ${Math.round(m / 60)} שע׳` : `לפני ${Math.round(m / 1440)} ימים`;
  }

  /* ---------- עיצוב ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #mvt-back{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1070;display:none}
  #mvt-back.open{display:block}
  #mvt{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:720px;max-width:calc(100vw - 20px);height:86vh;display:flex;flex-direction:column;
    background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);direction:rtl;font-size:14px}
  #mvt .h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bs-border-color,#dee2e6);font-weight:600;font-size:16px}
  #mvt .h .x{margin-inline-start:auto;border:0;background:none;font-size:22px;cursor:pointer;color:inherit;opacity:.6}
  #mvt .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:8px 14px 0}
  #mvt .bar2{padding-bottom:8px}
  #mvt .tb,#mvt select{border:1px solid var(--bs-border-color,#dee2e6);background:none;color:inherit;border-radius:6px;padding:5px 11px;cursor:pointer;font:inherit}
  #mvt .tb.on{background:var(--bs-primary,#0d6efd);border-color:var(--bs-primary,#0d6efd);color:#fff}
  #mvt .sep{width:1px;height:22px;background:var(--bs-border-color,#dee2e6);margin:0 4px}
  #mvt .q{flex:1;min-width:160px;padding:6px 10px;border:1px solid var(--bs-border-color,#dee2e6);border-radius:6px;background:transparent;color:inherit;font:inherit}
  #mvt .stats{display:flex;gap:8px;padding:0 14px 8px;flex-wrap:wrap}
  #mvt .st{flex:1;min-width:110px;border:1px solid var(--bs-border-color,#dee2e6);border-radius:8px;padding:6px 10px;text-align:center}
  #mvt .st b{display:block;font-size:20px}
  #mvt .list{flex:1;overflow-y:auto;padding:0 8px 8px}
  #mvt .it{display:flex;gap:10px;padding:10px 8px;border-bottom:1px solid var(--bs-border-color,#eee);background:linear-gradient(to left,rgba(13,110,253,.10) var(--p,0%),transparent var(--p,0%))}
  #mvt .it:hover{background-color:rgba(127,127,127,.07)}
  #mvt .av{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;object-fit:cover}
  #mvt .who{font-weight:700}
  #mvt .meta{font-size:12px;opacity:.7}
  #mvt .tt{color:var(--bs-primary,#0d6efd);text-decoration:none;font-weight:600}
  #mvt .tt:hover{text-decoration:underline}
  #mvt .clk{cursor:pointer}
  #mvt .snip{margin-top:3px;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #mvt .cnt{margin-inline-start:auto;font-weight:700;font-size:15px;align-self:center;white-space:nowrap}
  #mvt .msg{padding:26px;text-align:center;opacity:.7}
  #mvt .more{display:block;margin:10px auto;padding:6px 18px}
  #mvt .foot{padding:8px 14px;border-top:1px solid var(--bs-border-color,#dee2e6);font-size:12px;opacity:.85;display:flex;justify-content:space-between;gap:10px;align-items:center}
  #mvt .foot button{border:0;background:none;color:var(--bs-primary,#0d6efd);cursor:pointer;font:inherit}
  #mvt mark{background:#fff3a3;color:inherit;padding:0}
  @media(max-width:600px){#mvt{height:94vh}}
  `;
  document.head.appendChild(css);

  /* ---------- החלון ---------- */
  const back = document.createElement('div');
  back.id = 'mvt-back';
  back.innerHTML = `
  <div id="mvt">
    <div class="h"><i class="fa fa-thumbs-up text-primary"></i> ההצבעות שלי<button class="x" title="סגירה (Esc)">×</button></div>
    <div class="bar">
      <button class="tb" data-tab="upvoted">👍 לייקים שנתתי</button>
      <button class="tb" data-tab="downvoted">👎 דיסלייקים שנתתי</button>
      <button class="tb" data-tab="received">📥 מה שקיבלתי</button>
    </div>
    <div class="bar bar2">
      <button class="tb" data-view="posts">פוסטים</button>
      <button class="tb" data-view="users">משתמשים</button>
      <button class="tb" data-view="topics">נושאים</button>
      <button class="tb" data-view="mutual">הדדיות</button>
      <span class="sep"></span>
      <select class="sort"><option value="count">מיון: לפי כמות</option><option value="date">מיון: לפי תאריך</option></select>
      <input class="q" placeholder="חיפוש לפי משתמש, נושא או תוכן…">
    </div>
    <div class="stats"></div>
    <div class="list"></div>
    <div class="foot"><span class="sum"></span><span><button class="csv">ייצוא CSV</button> · <button class="reload">רענון</button></span></div>
  </div>`;
  document.body.appendChild(back);

  const $ = (s) => back.querySelector(s);
  const listEl = $('.list');
  const qEl = $('.q');

  function hl(text, q) {
    text = String(text ?? '');
    const safe = esc(text);
    if (!q) return safe;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return safe;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function avatar(p) {
    if (p.picture) return `<img class="av" src="${esc(p.picture)}" alt="">`;
    return `<span class="av" style="background:${esc(p.iconBg || '#6c757d')}">${esc(p.iconText || (p.user || '?')[0])}</span>`;
  }
  function snippet(text, q) {
    if (!q) return esc(text.slice(0, 220));
    const i = text.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 60);
    return hl((start ? '…' : '') + text.slice(start, start + 220), q);
  }
  const stats = (arr) => { $('.stats').innerHTML = arr.map(([n, l]) => `<div class="st"><b>${n}</b>${l}</div>`).join(''); };
  const pct = (n, max) => max ? Math.max(3, Math.round(n / max * 100)) : 0;
  const more = (total) => total > limit ? `<button class="tb more" data-more>הצג עוד (${total - limit})</button>` : '';
  const msg = (t) => `<div class="msg">${t}</div>`;

  /* ---------- תצוגות ---------- */
  function groupBy(data, keyFn) {
    const m = new Map();
    data.forEach(p => { const k = keyFn(p); const e = m.get(k) || { ...p, key: k, n: 0, last: 0 }; e.n++; e.last = Math.max(e.last, +new Date(p.time) || 0); m.set(k, e); });
    return [...m.values()];
  }
  function sorter(a, b) { return sort === 'date' ? b.last - a.last : b.n - a.n; }

  function renderGiven(data, q, word) {
    if (view === 'users' || view === 'topics') {
      const isU = view === 'users';
      const rows = groupBy(data, p => isU ? p.user : p.topic).filter(r => !q || String(r.key).toLowerCase().includes(q)).sort(sorter);
      const max = rows.length ? Math.max(...rows.map(r => r.n)) : 0;
      stats([[data.length, word], [groupBy(data, p => p.user).length, 'משתמשים'], [groupBy(data, p => p.topic).length, 'נושאים']]);
      $('.sum').textContent = `${rows.length} ${isU ? 'משתמשים' : 'נושאים'}`;
      listEl.innerHTML = rows.length ? rows.slice(0, limit).map(r => `
        <div class="it" style="--p:${pct(r.n, max)}%">${isU ? avatar(r) : ''}
          <div style="min-width:0"><span class="tt clk" data-q="${esc(r.key)}">${hl(r.key || 'פוסט', q)}</span>${isU && r.userslug ? ` <a class="meta" href="/user/${esc(r.userslug)}">פרופיל</a>` : ''}</div>
          <span class="cnt">${r.n}</span></div>`).join('') + more(rows.length) : msg('לא נמצאו תוצאות');
      return;
    }
    let items = data.filter(p => !q || p.user.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q) || p.text.toLowerCase().includes(q));
    if (sort === 'date') items = items.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
    stats([[items.length, q ? 'תוצאות' : word], [groupBy(data, p => p.user).length, 'משתמשים'], [groupBy(data, p => p.topic).length, 'נושאים']]);
    $('.sum').textContent = q ? `${items.length} מתוך ${data.length} ${word}` : `${data.length} ${word}`;
    listEl.innerHTML = items.length ? items.slice(0, limit).map(p => `
      <div class="it">${avatar(p)}
        <div style="min-width:0;flex:1">
          <div><span class="who">${hl(p.user, q)}</span> <span class="meta">· ${date(p.time)}</span></div>
          <a class="tt" href="/post/${p.pid}">${hl(p.topic || 'פוסט', q)}</a>
          <div class="snip">${snippet(p.text, q)}</div>
        </div></div>`).join('') + more(items.length) : msg(data.length ? 'לא נמצאו תוצאות' : `עוד לא נתת ${word}`);
  }

  function renderReceived(d, q) {
    const posts = d.posts;
    const totUp = posts.reduce((a, p) => a + p.up, 0), totDown = posts.reduce((a, p) => a + p.down, 0);
    const withVotes = posts.filter(p => p.up || p.down);
    const best = withVotes.length ? withVotes.reduce((x, y) => (y.up - y.down > x.up - x.down ? y : x)) : null;
    stats([[totUp, '👍 לייקים שקיבלתי'], [totDown, '👎 דיסלייקים שקיבלתי'], [posts.length, 'פוסטים שכתבתי'], [best ? '+' + (best.up - best.down) : '—', 'הפוסט הטוב ביותר']]);
    $('.sum').textContent = d.failed ? `לא ניתן לראות מי הצביע ב-${d.failed} בדיקות` : `קיבלת ${totUp} לייקים ו-${totDown} דיסלייקים`;
    const fmt = (u, dn) => `👍 ${u}${dn ? ' · 👎 ' + dn : ''}`;
    if (view === 'users') {
      const m = new Map();
      posts.forEach(p => {
        (p.ups || []).forEach(n => { const e = m.get(n) || { n, up: 0, down: 0, last: 0 }; e.up++; e.last = Math.max(e.last, +new Date(p.time)); m.set(n, e); });
        (p.downs || []).forEach(n => { const e = m.get(n) || { n, up: 0, down: 0, last: 0 }; e.down++; e.last = Math.max(e.last, +new Date(p.time)); m.set(n, e); });
      });
      const us = [...m.values()].filter(u => !q || u.n.toLowerCase().includes(q)).sort((a, b) => sort === 'date' ? b.last - a.last : (b.up + b.down) - (a.up + a.down));
      const max = us.length ? Math.max(...us.map(u => u.up + u.down)) : 0;
      listEl.innerHTML = us.length ? us.slice(0, limit).map(u => `<div class="it" style="--p:${pct(u.up + u.down, max)}%"><div style="flex:1" class="who clk" data-q="${esc(u.n)}">${hl(u.n, q)}</div><span class="cnt">${fmt(u.up, u.down)}</span></div>`).join('') + more(us.length) : msg('אין נתוני משתמשים (ייתכן שהפורום לא חושף מי הצביע)');
      return;
    }
    if (view === 'topics') {
      const m = new Map();
      posts.forEach(p => { const e = m.get(p.topic) || { t: p.topic, up: 0, down: 0, last: 0 }; e.up += p.up; e.down += p.down; e.last = Math.max(e.last, +new Date(p.time)); m.set(p.topic, e); });
      const ts = [...m.values()].filter(t => (t.up || t.down) && (!q || t.t.toLowerCase().includes(q))).sort((a, b) => sort === 'date' ? b.last - a.last : (b.up + b.down) - (a.up + a.down));
      const max = ts.length ? Math.max(...ts.map(t => t.up + t.down)) : 0;
      listEl.innerHTML = ts.length ? ts.slice(0, limit).map(t => `<div class="it" style="--p:${pct(t.up + t.down, max)}%"><div style="min-width:0;flex:1" class="tt">${hl(t.t || 'פוסט', q)}</div><span class="cnt">${fmt(t.up, t.down)}</span></div>`).join('') + more(ts.length) : msg('לא נמצאו נושאים');
      return;
    }
    let items = withVotes.filter(p => !q || p.topic.toLowerCase().includes(q) || p.text.toLowerCase().includes(q) || (p.ups || []).concat(p.downs || []).some(n => n.toLowerCase().includes(q)));
    items = items.sort((a, b) => sort === 'date' ? new Date(b.time) - new Date(a.time) : (b.up - b.down) - (a.up - a.down));
    listEl.innerHTML = items.length ? items.slice(0, limit).map(p => `
      <div class="it"><div style="min-width:0;flex:1">
        <a class="tt" href="/post/${p.pid}">${hl(p.topic || 'פוסט', q)}</a> <span class="meta">· ${date(p.time)}</span>
        <div class="snip">${esc(p.text.slice(0, 160))}</div>
        <div class="meta">${p.up ? '👍 ' + p.up + (p.ups ? ': ' + p.ups.map(n => hl(n, q)).join(', ') : '') : ''}${p.down ? ' &nbsp; 👎 ' + p.down + (p.downs ? ': ' + p.downs.map(n => hl(n, q)).join(', ') : '') : ''}</div>
      </div><span class="cnt">${p.up - p.down > 0 ? '+' : ''}${p.up - p.down}</span></div>`).join('') + more(items.length) : msg('אין פוסטים עם הצבעות');
  }

  // הדדיות: מי שנתתי לו לייק מול מי שנתן לי לייק
  function renderMutual(q) {
    const given = cache.upvoted, rec = cache.received;
    if (!given || !rec) return msg('טוען נתונים להשוואה…');
    const m = new Map();
    given.forEach(p => { const e = m.get(p.user) || { n: p.user, i: 0, he: 0 }; e.i++; m.set(p.user, e); });
    rec.posts.forEach(p => (p.ups || []).forEach(n => { const e = m.get(n) || { n, i: 0, he: 0 }; e.he++; m.set(n, e); }));
    const rows = [...m.values()].filter(r => !q || r.n.toLowerCase().includes(q)).sort((a, b) => (b.i + b.he) - (a.i + a.he));
    const max = rows.length ? Math.max(...rows.map(r => r.i + r.he)) : 0;
    const both = rows.filter(r => r.i && r.he).length, onlyMe = rows.filter(r => r.i && !r.he).length, onlyHe = rows.filter(r => !r.i && r.he).length;
    stats([[both, 'הדדי'], [onlyMe, 'רק אני נתתי'], [onlyHe, 'רק הם נתנו']]);
    $('.sum').textContent = `${rows.length} משתמשים`;
    listEl.innerHTML = rows.length ? rows.slice(0, limit).map(r => `
      <div class="it" style="--p:${pct(r.i + r.he, max)}%"><div style="flex:1" class="who clk" data-q="${esc(r.n)}">${hl(r.n, q)}</div>
      <span class="cnt">נתתי ${r.i} · קיבלתי ${r.he}</span></div>`).join('') + more(rows.length) : msg('אין נתונים');
  }

  function render() {
    back.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    back.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    $('.sort').value = sort;
    const q = qEl.value.trim().toLowerCase();
    if (view === 'mutual') { listEl.innerHTML = renderMutual(q) || listEl.innerHTML; return; }
    const data = cache[tab];
    if (!data) return;
    const word = tab === 'upvoted' ? 'לייקים' : 'דיסלייקים';
    if (tab === 'received') return renderReceived(data, q);
    renderGiven(data, q, word);
  }

  /* ---------- טעינה ---------- */
  async function ensure(kind, force, tick) {
    if (!force && cache[kind]) return;
    if (!force && loadLocal(kind)) return;
    cache[kind] = kind === 'received' ? await fetchReceived(tick) : await fetchAll(kind, n => tick && tick(`טוען… ${n}`));
    stamp[kind] = Date.now();
    saveLocal(kind);
  }
  async function load(force) {
    const kind = tab, v = view;
    const tick = t => { listEl.innerHTML = msg(esc(t)); };
    const need = v === 'mutual' ? ['upvoted', 'received'] : [kind];
    if (need.every(k => cache[k]) && !force) return render();
    tick('טוען…');
    $('.stats').innerHTML = '';
    try {
      for (const k of need) await ensure(k, force && (v !== 'mutual' || k === 'upvoted' || k === 'received'), tick);
      render();
    } catch (e) {
      listEl.innerHTML = msg(`לא הצלחתי לטעון: ${esc(e.message)}`);
    }
  }

  function exportCsv() {
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    let rows;
    if (tab === 'received') {
      rows = [['פוסט', 'נושא', 'תאריך', 'לייקים', 'דיסלייקים', 'מי נתן לייק', 'מי נתן דיסלייק']]
        .concat(cache.received ? cache.received.posts.filter(p => p.up || p.down).map(p => [p.pid, p.topic, p.time, p.up, p.down, (p.ups || []).join('; '), (p.downs || []).join('; ')]) : []);
    } else {
      rows = [['פוסט', 'משתמש', 'נושא', 'תאריך', 'תוכן']].concat((cache[tab] || []).map(p => [p.pid, p.user, p.topic, p.time, p.text]));
    }
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mitmachim-${tab}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function open() { back.classList.add('open'); qEl.value = ''; limit = 100; load(); setTimeout(() => qEl.focus(), 50); }
  function close() { back.classList.remove('open'); }

  back.addEventListener('click', e => {
    if (e.target === back || e.target.closest('.x')) return close();
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; if (view === 'mutual') view = 'posts'; limit = 100; return load(); }
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; limit = 100; return load(); }
    if (e.target.closest('[data-more]')) { limit += 100; return render(); }
    const c = e.target.closest('[data-q]'); if (c) { qEl.value = c.dataset.q; view = 'posts'; limit = 100; return tab === 'received' && !cache.received ? load() : render(); }
    if (e.target.closest('.reload')) { if (view === 'mutual') { cache.upvoted = cache.received = null; } return load(true); }
    if (e.target.closest('.csv')) return exportCsv();
    const a = e.target.closest('a[href^="/"]');
    if (a && window.ajaxify && typeof ajaxify.go === 'function' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); close(); ajaxify.go(a.getAttribute('href').slice(1));
    }
  });
  $('.sort').addEventListener('change', e => { sort = e.target.value; render(); });
  qEl.addEventListener('input', () => { limit = 100; render(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.altKey && (e.key === 'l' || e.key === 'ך')) { e.preventDefault(); back.classList.contains('open') ? close() : open(); }
  });

  /* ---------- כפתור בצד שמאל (פיזית) ---------- */
  // בוחר את סרגל הצד שנמצא בפועל בצד שמאל של המסך, בלי להסתמך על השם left/right
  function leftNav() {
    const cands = [...document.querySelectorAll('[component="sidebar/left"], [component="sidebar/right"], #main-nav')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(c => c.r.width > 0 && c.r.height > 0 && c.r.left < innerWidth / 2);
    if (!cands.length) return null;
    cands.sort((x, y) => x.r.left - y.r.left);
    const el = cands[0].el;
    return el.matches('ul') ? el : (el.querySelector('ul') || el);
  }

  function makeLi() {
    const li = document.createElement('li');
    li.id = 'mvt-nav';
    li.className = 'nav-item mx-2';
    li.title = 'ההצבעות שלי (Alt+L)';
    li.innerHTML = `
      <a class="nav-link navigation-link d-flex gap-2 justify-content-between align-items-center" href="#" role="button" aria-label="ההצבעות שלי">
        <span class="d-flex gap-2 align-items-center text-nowrap truncate-open">
          <span class="position-relative"><i class="fa fa-fw fa-thumbs-up"></i></span>
          <span class="nav-text small visible-open fw-semibold text-truncate">ההצבעות שלי</span>
        </span>
      </a>`;
    li.querySelector('a').addEventListener('click', e => { e.preventDefault(); open(); });
    return li;
  }

  // גיבוי: כפתור צף בצד שמאל, אם אין סרגל בצד שמאל (למשל בטלפון)
  const fab = document.createElement('button');
  fab.id = 'mvt-fab';
  fab.title = 'ההצבעות שלי (Alt+L)';
  fab.innerHTML = '<i class="fa fa-thumbs-up"></i>';
  fab.style.cssText = 'position:fixed;left:14px;bottom:140px;width:44px;height:44px;border-radius:50%;border:0;z-index:1059;background:var(--bs-primary,#0d6efd);color:#fff;font-size:18px;box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer;display:none';
  fab.onclick = open;
  document.body.appendChild(fab);

  let busy = false;
  function place() {
    if (busy) return;
    busy = true;
    try {
      const nav = leftNav();
      let li = document.getElementById('mvt-nav');
      if (nav) {
        if (!li) li = makeLi();
        if (li.parentNode !== nav) nav.appendChild(li);
        fab.style.display = 'none';
      } else {
        if (li) li.remove();
        fab.style.display = 'block';
      }
    } finally { busy = false; }
  }
  place();
  new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', place);
})();
