// ==UserScript==
// @name         מתמחים טופ – למי נתתי לייק ודיסלייק
// @namespace    mitmachim-my-votes
// @version      1.3
// @description  לייקים ודיסלייקים שנתת ושקיבלת: סיכום לפי משתמש, לפי נושא ולפי פוסט, עם חיפוש
// @match        https://mitmachim.top/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const MAX_PAGES = 50;           // עד כמה עמודים לטעון מכל רשימה
  const cache = { upvoted: null, downvoted: null, received: null };
  let tab = 'upvoted';            // upvoted | downvoted | received
  let view = 'posts';             // posts | users

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

  /* ---------- עיצוב ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #mvt-back{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1070;display:none}
  #mvt-back.open{display:block}
  #mvt{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:640px;max-width:calc(100vw - 20px);height:80vh;display:flex;flex-direction:column;
    background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.25);direction:rtl;font-size:14px}
  #mvt .h{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bs-border-color,#dee2e6);font-weight:600;font-size:16px}
  #mvt .h .x{margin-inline-start:auto;border:0;background:none;font-size:20px;cursor:pointer;color:inherit;opacity:.6}
  #mvt .bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 14px}
  #mvt .tb{border:1px solid var(--bs-border-color,#dee2e6);background:none;color:inherit;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit}
  #mvt .tb.on{background:var(--bs-primary,#0d6efd);border-color:var(--bs-primary,#0d6efd);color:#fff}
  #mvt .sep{width:1px;height:22px;background:var(--bs-border-color,#dee2e6);margin:0 4px}
  #mvt .q{flex:1;min-width:160px;padding:6px 10px;border:1px solid var(--bs-border-color,#dee2e6);border-radius:6px;background:transparent;color:inherit;font:inherit}
  #mvt .list{flex:1;overflow-y:auto;padding:0 8px 8px}
  #mvt .it{display:flex;gap:10px;padding:10px 6px;border-bottom:1px solid var(--bs-border-color,#eee)}
  #mvt .av{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;object-fit:cover}
  #mvt .who{font-weight:700}
  #mvt .meta{font-size:12px;opacity:.7}
  #mvt .tt{color:var(--bs-primary,#0d6efd);text-decoration:none;font-weight:600}
  #mvt .tt:hover{text-decoration:underline}
  #mvt .snip{margin-top:3px;opacity:.85;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #mvt .cnt{margin-inline-start:auto;font-weight:700;font-size:16px;align-self:center}
  #mvt .msg{padding:30px;text-align:center;opacity:.7}
  #mvt .foot{padding:8px 14px;border-top:1px solid var(--bs-border-color,#dee2e6);font-size:12px;opacity:.75;display:flex;justify-content:space-between}
  #mvt .foot button{border:0;background:none;color:var(--bs-primary,#0d6efd);cursor:pointer;font:inherit}
  #mvt mark{background:#fff3a3;color:inherit;padding:0}
  `;
  document.head.appendChild(css);

  /* ---------- החלון ---------- */
  const back = document.createElement('div');
  back.id = 'mvt-back';
  back.innerHTML = `
  <div id="mvt">
    <div class="h"><i class="fa fa-thumbs-up text-primary"></i> ההצבעות שלי<button class="x" title="סגירה">×</button></div>
    <div class="bar">
      <button class="tb" data-tab="upvoted">👍 לייקים</button>
      <button class="tb" data-tab="downvoted">👎 דיסלייקים</button>
      <button class="tb" data-tab="received">📥 מה שקיבלתי</button>
      <span class="sep"></span>
      <button class="tb" data-view="posts">לפי פוסטים</button>
      <button class="tb" data-view="users">לפי משתמשים</button>
      <button class="tb" data-view="topics">לפי נושאים</button>
      <input class="q" placeholder="חיפוש לפי שם משתמש, נושא או תוכן…">
    </div>
    <div class="list"></div>
    <div class="foot"><span class="sum"></span><button class="reload">רענון</button></div>
  </div>`;
  document.body.appendChild(back);

  const $ = (s) => back.querySelector(s);
  const listEl = $('.list');
  const qEl = $('.q');

  function hl(text, q) {
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
    const part = (start ? '…' : '') + text.slice(start, start + 220);
    return hl(part, q);
  }

  function render() {
    back.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    back.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    const data = cache[tab];
    if (!data) return;
    const q = qEl.value.trim().toLowerCase();
    const word = tab === 'upvoted' ? 'לייקים' : 'דיסלייקים';

    if (tab === 'received') return renderReceived(data, q);
    if (view === 'topics') {
      const tm = new Map();
      data.forEach(p => { const e = tm.get(p.topic) || { topic: p.topic, n: 0 }; e.n++; tm.set(p.topic, e); });
      const ts = [...tm.values()].filter(t => !q || t.topic.toLowerCase().includes(q)).sort((a, b) => b.n - a.n);
      $('.sum').textContent = `${tm.size} נושאים · ${data.length} ${word}`;
      listEl.innerHTML = ts.length ? ts.map(t => `<div class="it"><div style="min-width:0;flex:1" class="tt">${hl(t.topic || 'פוסט', q)}</div><span class="cnt">${t.n}</span></div>`).join('') : `<div class="msg">לא נמצאו נושאים</div>`;
      return;
    }

    if (view === 'users') {
      const map = new Map();
      data.forEach(p => { const k = p.user; const e = map.get(k) || { ...p, n: 0 }; e.n++; map.set(k, e); });
      const users = [...map.values()].filter(u => !q || u.user.toLowerCase().includes(q)).sort((a, b) => b.n - a.n);
      $('.sum').textContent = `${map.size} משתמשים · ${data.length} ${word}`;
      listEl.innerHTML = users.length ? users.map(u => `
        <div class="it">${avatar(u)}
          <div style="min-width:0"><a class="tt" href="/user/${esc(u.userslug || '')}">${hl(u.user, q)}</a></div>
          <span class="cnt">${u.n}</span>
        </div>`).join('') : `<div class="msg">${data.length ? 'לא נמצאו משתמשים' : `עוד לא נתת ${word}`}</div>`;
      return;
    }

    const items = data.filter(p => !q || p.user.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q) || p.text.toLowerCase().includes(q));
    $('.sum').textContent = q ? `${items.length} מתוך ${data.length} ${word}` : `${data.length} ${word}`;
    listEl.innerHTML = items.length ? items.map(p => `
      <div class="it">${avatar(p)}
        <div style="min-width:0;flex:1">
          <div><span class="who">${hl(p.user, q)}</span> <span class="meta">· ${date(p.time)}</span></div>
          <a class="tt" href="/post/${p.pid}">${hl(p.topic || 'פוסט', q)}</a>
          <div class="snip">${snippet(p.text, q)}</div>
        </div>
      </div>`).join('') : `<div class="msg">${data.length ? 'לא נמצאו תוצאות' : `עוד לא נתת ${word}`}</div>`;
  }


  function renderReceived(d, q) {
    const posts = d.posts;
    const totUp = posts.reduce((a, p) => a + p.up, 0), totDown = posts.reduce((a, p) => a + p.down, 0);
    const warn = d.failed ? ` · (לא ניתן היה לראות מי הצביע ב-${d.failed} בדיקות)` : '';
    const head = `<div class="msg" style="padding:10px"><b>👍 ${totUp}</b> &nbsp; <b>👎 ${totDown}</b> &nbsp; ב-${posts.length} פוסטים${warn}</div>`;
    $('.sum').textContent = `קיבלת ${totUp} לייקים ו-${totDown} דיסלייקים`;
    if (view === 'users') {
      const m = new Map();
      posts.forEach(p => {
        (p.ups || []).forEach(n => { const e = m.get(n) || { n, up: 0, down: 0 }; e.up++; m.set(n, e); });
        (p.downs || []).forEach(n => { const e = m.get(n) || { n, up: 0, down: 0 }; e.down++; m.set(n, e); });
      });
      const us = [...m.values()].filter(u => !q || u.n.toLowerCase().includes(q)).sort((a, b) => (b.up + b.down) - (a.up + a.down));
      listEl.innerHTML = head + (us.length ? us.map(u => `<div class="it"><div style="min-width:0;flex:1" class="who">${hl(u.n, q)}</div><span class="cnt">👍 ${u.up}${u.down ? ' · 👎 ' + u.down : ''}</span></div>`).join('') : '<div class="msg">אין נתוני משתמשים (ייתכן שהפורום לא חושף מי הצביע)</div>');
      return;
    }
    if (view === 'topics') {
      const m = new Map();
      posts.forEach(p => { const e = m.get(p.topic) || { t: p.topic, up: 0, down: 0 }; e.up += p.up; e.down += p.down; m.set(p.topic, e); });
      const ts = [...m.values()].filter(t => (t.up || t.down) && (!q || t.t.toLowerCase().includes(q))).sort((a, b) => (b.up + b.down) - (a.up + a.down));
      listEl.innerHTML = head + (ts.length ? ts.map(t => `<div class="it"><div style="min-width:0;flex:1" class="tt">${hl(t.t || 'פוסט', q)}</div><span class="cnt">👍 ${t.up}${t.down ? ' · 👎 ' + t.down : ''}</span></div>`).join('') : '<div class="msg">לא נמצאו נושאים</div>');
      return;
    }
    const items = posts.filter(p => (p.up || p.down) && (!q || p.topic.toLowerCase().includes(q) || p.text.toLowerCase().includes(q) || (p.ups || []).concat(p.downs || []).some(n => n.toLowerCase().includes(q))))
      .sort((a, b) => (b.up + b.down) - (a.up + a.down));
    listEl.innerHTML = head + (items.length ? items.map(p => `
      <div class="it"><div style="min-width:0;flex:1">
        <a class="tt" href="/post/${p.pid}">${hl(p.topic || 'פוסט', q)}</a> <span class="meta">· ${date(p.time)}</span>
        <div class="snip">${esc(p.text.slice(0, 160))}</div>
        <div class="meta">${p.up ? '👍 ' + p.up + (p.ups ? ': ' + p.ups.map(n => hl(n, q)).join(', ') : '') : ''} ${p.down ? ' 👎 ' + p.down + (p.downs ? ': ' + p.downs.map(n => hl(n, q)).join(', ') : '') : ''}</div>
      </div><span class="cnt">${p.up - p.down > 0 ? '+' : ''}${p.up - p.down}</span></div>`).join('') : '<div class="msg">אין פוסטים עם הצבעות</div>');
  }

  async function load(force) {
    if (cache[tab] && !force) return render();
    const kind = tab;
    listEl.innerHTML = `<div class="msg">טוען… <span class="n"></span></div>`;
    $('.sum').textContent = '';
    try {
      if (kind === 'received') cache.received = await fetchReceived(t => { listEl.innerHTML = `<div class="msg">${esc(t)}</div>`; });
      else cache[kind] = await fetchAll(kind, n => { const s = listEl.querySelector('.n'); if (s) s.textContent = `(${n})`; });
      if (tab === kind) render();
    } catch (e) {
      listEl.innerHTML = `<div class="msg">לא הצלחתי לטעון: ${esc(e.message)}</div>`;
    }
  }

  function open() { back.classList.add('open'); qEl.value = ''; load(); setTimeout(() => qEl.focus(), 50); }
  function close() { back.classList.remove('open'); }

  back.addEventListener('click', e => {
    if (e.target === back || e.target.closest('.x')) return close();
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return load(); }
    const v = e.target.closest('[data-view]'); if (v) { view = v.dataset.view; return render(); }
    if (e.target.closest('.reload')) return load(true);
    const a = e.target.closest('a[href^="/"]');
    if (a && window.ajaxify && typeof ajaxify.go === 'function' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); close(); ajaxify.go(a.getAttribute('href').slice(1));
    }
  });
  qEl.addEventListener('input', render);
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
