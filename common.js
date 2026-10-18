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

  toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
  },

  msg(el, text, kind = 'err') {
    el.textContent = text || '';
    el.className = 'msg ' + kind + (text ? ' show' : '');
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
    const mk = (href, text, cls) => { const a = document.createElement('a'); a.href = href; a.className = 'btn sm ' + (cls || ''); a.textContent = text; return a; };
    if (App.user) {
      cta.appendChild(mk('/dashboard', 'แดชบอร์ด', 'primary'));
      if (App.user.role === 'admin') cta.appendChild(mk('/admin', 'แอดมิน', 'ghost'));
      const out = document.createElement('button'); out.className = 'btn sm ghost'; out.textContent = 'ออกจากระบบ';
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
