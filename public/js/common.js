const App = {
  siteName: 'HYP TIP',
  user: null,
  logo: '<img class="logo-img" src="/img/logo.png" alt="">',

  async api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (opts.body instanceof FormData) o.body = opts.body;
    else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(path, o);
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) { const e = new Error(data.error || 'เกิดข้อผิดพลาด'); e.status = r.status; throw e; }
    return data;
  },

  money: n => Number(n || 0).toLocaleString('th-TH'),
  dt: ms => new Date(ms).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),

  timeAgo(ms) {
    const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (s < 60) return 'เมื่อครู่';
    if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
    if (s < 86400) return Math.floor(s / 3600) + ' ชม. ที่แล้ว';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' วันที่แล้ว';
    return App.dt(ms);
  },

  toast(msg, kind = '') {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.replaceChildren();
    const ic = document.createElement('span'); ic.className = 'toast-ic'; ic.innerHTML = kind === 'ok' ? App.icon('check') : kind === 'err' ? App.icon('x') : App.icon('bell');
    const tx = document.createElement('span'); tx.textContent = msg;
    t.append(ic, tx);
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000);
  },

  msg(el, text, kind = 'err') {
    el.textContent = text || '';
    el.className = 'msg ' + kind + (text ? ' show' : '');
  },

  /* ------------------------------ icon set ------------------------------- */
  icon(name, size = 18) {
    const p = {
      chart: '<path d="M3 3v18h18"/><path d="m7 14 4-5 3 3 5-7"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
      bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
      search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
      shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/>',
      activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
      trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
      ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
      settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
      trend: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
      heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
      qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
      alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
      edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
      play: '<path d="m6 3 14 9-14 9Z"/>',
      gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
      sparkle: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><path d="m8.4 15.6-2.8 2.8"/>'
    }[name] || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },

  /* --------------------------- bar chart (HTML) --------------------------- */
  // data: [{ label, value, value2?, tip?, tip2? }]
  barChart(el, data, opts = {}) {
    const o = Object.assign({ color: 'var(--accent)', color2: '', labelEvery: 0, fmt: v => App.money(v) }, opts);
    el.replaceChildren(); el.classList.add('chart');
    const max = Math.max(1, ...data.map(d => Math.max(d.value, d.value2 || 0)));
    const wrap = document.createElement('div'); wrap.className = 'chart-bars';
    const every = o.labelEvery || Math.max(1, Math.round(data.length / 8));
    data.forEach((d, i) => {
      const col = document.createElement('div'); col.className = 'bar-col';
      const track = document.createElement('div'); track.className = 'bar-track';
      const mk = (v, cls, tip, color) => {
        if (v === undefined || v === null) return;
        const b = document.createElement('div'); b.className = 'bar ' + cls;
        b.style.height = Math.max(v > 0 ? 3 : 0, (v / max) * 100) + '%';
        if (color) b.style.background = color;
        b.style.animationDelay = Math.min(i * 22, 700) + 'ms';
        b.title = tip || '';
        return b;
      };
      if (d.value2 !== undefined) track.appendChild(mk(d.value2, 'b2', d.tip2, o.color2));
      track.appendChild(mk(d.value, 'b1', d.tip || (d.label + ': ' + o.fmt(d.value)), o.color));
      const lab = document.createElement('span'); lab.className = 'bar-label';
      lab.textContent = (i % every === 0 || i === data.length - 1) ? d.label : '';
      col.append(track, lab); wrap.appendChild(col);
    });
    el.appendChild(wrap);
  },

  /* ----------------------------- SSE helper ------------------------------ */
  sse(path, handlers) {
    const es = new EventSource(path);
    Object.entries(handlers).forEach(([ev, fn]) => es.addEventListener(ev, e => { try { fn(JSON.parse(e.data)); } catch (_) {} }));
    return es;
  },

  // เสียงแจ้งเตือนสั้นๆ บนแดชบอร์ด (WebAudio ไม่ต้องใช้ไฟล์)
  ping(freq = 880) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      App._ac = App._ac || new Ctx();
      const a = App._ac; if (a.state === 'suspended') a.resume();
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      const t = a.currentTime;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.45);
    } catch (_) {}
  },

  async init(opts = {}) {
    try {
      const d = await App.api('/api/me');
      App.user = d.user; App.siteName = d.siteName || App.siteName;
    } catch (_) {}
    document.title = (opts.title ? opts.title + ' · ' : '') + App.siteName;
    const nav = document.getElementById('nav');
    if (nav) App.renderNav(nav, opts);
    if (nav) {
      const f = () => nav.classList.toggle('solid', scrollY > 8);
      f(); addEventListener('scroll', f, { passive: true });
    }
    const els = document.querySelectorAll('.reveal');
    if (els.length && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 });
      els.forEach(el => io.observe(el));
    } else els.forEach(el => el.classList.add('in'));
    return App.user;
  },

  renderNav(nav, opts) {
    const wrap = document.createElement('div'); wrap.className = 'container';
    const brand = document.createElement('a'); brand.className = 'brand'; brand.href = '/';
    brand.innerHTML = App.logo; const bn = document.createElement('span'); bn.textContent = App.siteName; brand.appendChild(bn);
    wrap.appendChild(brand);
    if (opts.landing) {
      const links = document.createElement('nav'); links.className = 'nav-links';
      [['#process', 'ขั้นตอน'], ['#features', 'ระบบ'], ['#start', 'สมัคร']].forEach(([h, t]) => {
        const a = document.createElement('a'); a.href = h; a.textContent = t; links.appendChild(a);
      });
      wrap.appendChild(links);
    }
    const cta = document.createElement('div'); cta.className = 'nav-cta';
    const mk = (href, text, cls, icon) => {
      const a = document.createElement('a'); a.href = href; a.className = 'btn sm ' + (cls || '');
      if (icon) a.innerHTML = App.icon(icon, 15);
      const s = document.createElement('span'); s.textContent = text; a.appendChild(s);
      return a;
    };
    if (App.user) {
      cta.appendChild(mk('/dashboard', 'แดชบอร์ด', 'primary', 'chart'));
      if (App.user.role === 'admin') cta.appendChild(mk('/admin', 'แอดมิน', 'ghost', 'shield'));
      const out = document.createElement('button'); out.className = 'btn sm ghost'; out.innerHTML = App.icon('external', 15);
      const sp = document.createElement('span'); sp.textContent = 'ออกจากระบบ'; out.appendChild(sp);
      out.onclick = async () => { await App.api('/api/logout', { method: 'POST' }); location.href = '/'; };
      cta.appendChild(out);
    } else {
      cta.appendChild(mk('/auth#login', 'เข้าสู่ระบบ', 'ghost'));
      cta.appendChild(mk('/auth#register', 'สมัครรับโดเนท', 'primary'));
    }
    wrap.appendChild(cta); nav.appendChild(wrap);
  },

  countUp(el, to) {
    const start = performance.now(), dur = 900;
    const step = t => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = App.money(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
};
