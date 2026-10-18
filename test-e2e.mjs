// ทดสอบระบบ HYP TIP แบบ end-to-end (รันกับเซิร์ฟเวอร์ที่ localhost:3000)
const BASE = 'http://localhost:3000';
const J = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
const ok = [], fail = [];
const chk = (name, cond, extra = '') => (cond ? ok : fail).push(name + (extra ? ' — ' + extra : ''));

async function req(path, { method = 'GET', body, cookie = '', raw = false } = {}) {
  const h = { ...J };
  if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = raw ? await r.text() : await r.json(); } catch (_) {}
  const sc = (r.headers.get('set-cookie') || '').match(/sid=([^;]+)/);
  return { status: r.status, data, cookie: sc ? sc[1] : null, headers: r.headers };
}

(async () => {
  // 1. stats
  let r = await req('/api/public/stats');
  chk('public stats', r.status === 200 && 'streamers' in r.data);

  // 2. register admin (ADMIN_EMAIL=admin@hyp.test)
  const adminEmail = 'admin@hyp.test';
  r = await req('/api/register', { method: 'POST', body: { email: adminEmail, username: 'admin_t', displayName: 'แอดมินใหญ่', password: 'password123' } });
  chk('register admin', r.status === 200 && r.cookie, 'status=' + r.status);
  const adminCookie = 'sid=' + r.cookie;

  r = await req('/api/me', { cookie: adminCookie });
  chk('admin role', r.data.user?.role === 'super_admin', 'role=' + r.data.user?.role);

  // 3. register streamer
  r = await req('/api/register', { method: 'POST', body: { email: 'mint@test.com', username: 'mint', displayName: 'น้องมิ้นท์', password: 'password123' } });
  chk('register streamer', r.status === 200 && r.cookie);
  const streamerCookie = 'sid=' + r.cookie;

  // 4. settings + tts settings
  r = await req('/api/settings', { method: 'PATCH', cookie: streamerCookie, body: { displayName: 'น้องมิ้นท์', promptpayId: '0812345678', minAmount: 20, alertSeconds: 8, accent: '#ef2b2d', tts: true, minTts: 50, ttsRate: '1.2', ttsVolume: '0.8', ttsPitch: '1.1', blockedWords: '', bio: 'สตรีมเมอร์สายเกม' } });
  chk('settings save + tts', r.status === 200 && r.data.user?.ttsRate === 1.2 && r.data.user?.ttsVolume === 0.8 && r.data.user?.ttsPitch === 1.1, JSON.stringify(r.data.user && { rate: r.data.user.ttsRate, vol: r.data.user.ttsVolume }));

  // 5. donate
  r = await req('/api/streamer/mint/donate', { method: 'POST', body: { name: 'พี่ต้น', amount: 150, message: 'สู้ๆ นะครับบบ' } });
  chk('create donation + QR', r.status === 200 && r.data.ref && r.data.qr?.startsWith('data:image'), 'status=' + r.status);
  const ref = r.data.ref;

  // 6. SSE หน้าจ่ายเงิน (อ่าน event 1 ครั้ง)
  const sseRes = await fetch(BASE + '/api/donation/' + ref + '/stream');
  chk('donation SSE open', sseRes.status === 200 && sseRes.headers.get('content-type')?.includes('text/event-stream'));

  // 7. dashboard stream
  const dashSSE = await fetch(BASE + '/api/dashboard/stream', { headers: { Cookie: streamerCookie } });
  chk('dashboard SSE open', dashSSE.status === 200 && dashSSE.headers.get('content-type')?.includes('text/event-stream'));

  // อ่าน stream สักครู่เพื่อจับ event
  const readUntil = (res, want, ms = 4000) => new Promise(resolve => {
    const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const t0 = Date.now();
    const tick = async () => {
      const { value, done } = await rd.read().catch(() => ({ done: true }));
      if (!done) buf += dec.decode(value, { stream: true });
      if (buf.includes(want) || Date.now() - t0 > ms) { rd.cancel().catch(() => {}); resolve(buf); }
      else tick();
    };
    tick();
  });

  // 8. slip upload
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da636460f80f00010501012f10e0c80000000049454e44ae426082', 'hex');
  const fd = new FormData(); fd.append('slip', new Blob([png], { type: 'image/png' }), 'slip.png');
  const slipR = await fetch(BASE + '/api/donation/' + ref + '/slip', { method: 'POST', headers: { 'X-Requested-With': 'fetch', Cookie: 'sid=' + (await getDonorCookie()) }, body: fd });
  chk('slip upload', slipR.status === 200, 'status=' + slipR.status);

  // 9. admin sees new donation (realtime feed endpoint)
  r = await req('/api/admin/donations?status=pending', { cookie: adminCookie });
  chk('admin donation list', r.status === 200 && r.data.donations.some(d => d.ref === ref));

  r = await req('/api/admin/stats', { cookie: adminCookie });
  chk('admin stats', r.status === 200 && Array.isArray(r.data.daily) && r.data.daily.length === 30 && r.data.totals.pending >= 1, JSON.stringify(r.data.totals));

  // 10. admin approve → SSE events fire
  const pendingList = (await req('/api/admin/donations?status=pending', { cookie: adminCookie }));
  const donId = pendingList.data?.donations?.find(d => d.ref === ref)?.id;
  const rA = await req('/api/admin/donations/' + donId + '/approve', { method: 'POST', cookie: adminCookie });
  chk('admin approve', rA.status === 200);

  const donationSSE = await readUntil(sseRes, '"status":"paid"');
  chk('donor SSE got paid event', donationSSE.includes('"status":"paid"'), donationSSE.slice(0, 120).replace(/\n/g, '|'));
  const dashBuf = await readUntil(dashSSE, 'donation-paid');
  chk('streamer SSE got donation-paid', dashBuf.includes('donation-paid'), dashBuf.slice(0, 160).replace(/\n/g, '|'));
  dashSSE.body?.cancel().catch(() => {});

  // 11. overlay config + stream
  const meR = await req('/api/me', { cookie: streamerCookie });
  const user = meR.data?.user;
  const ovConf = user ? await req('/api/overlay/' + user.overlayToken + '/config') : { status: 500, data: {} };
  chk('overlay config', ovConf.status === 200 && ovConf.data.accent);
  const ovSSE = user ? await fetch(BASE + '/api/overlay/' + user.overlayToken + '/stream') : { status: 500 };
  chk('overlay SSE open', ovSSE.status === 200);

  // 12. replay (payload มี speech ภาษาไทย)
  const replay = await req('/api/dashboard/donations/' + donId + '/replay', { method: 'POST', cookie: streamerCookie });
  chk('replay ok', replay.status === 200 && replay.data.clients === 1, 'clients=' + replay.data?.clients);

  // 13. admin users search
  r = await req('/api/admin/users?q=mint', { cookie: adminCookie });
  chk('admin user search', r.status === 200 && r.data.users.some(u => u.username === 'mint'));
  r = await req('/api/admin/users?q=zzzzz', { cookie: adminCookie });
  chk('admin user search empty', r.status === 200 && r.data.users.length === 0);

  // 14. admin edit user
  r = user ? await req('/api/admin/users/' + user.id, { method: 'PATCH', cookie: adminCookie, body: { displayName: 'มิ้นท์อัปเดต', role: 'user' } }) : { status: 500 };
  chk('admin edit user', r.status === 200);
  r = await req('/api/streamer/mint');
  chk('public name updated', r.data?.displayName === 'มิ้นท์อัปเดต');

  // 15. ban + unban
  const rB = user ? await req('/api/admin/users/' + user.id + '/ban', { method: 'POST', cookie: adminCookie, body: { banned: true } }) : { status: 500 };
  chk('ban user', rB.status === 200);
  r = await req('/api/streamer/mint');
  chk('banned streamer hidden', r.status === 404, 'status=' + r.status);
  if (user) await req('/api/admin/users/' + user.id + '/ban', { method: 'POST', cookie: adminCookie, body: { banned: false } });

  // 16. overlay ได้ event donation พร้อม payload ภาษาไทย (login ใหม่เพราะ session ถูกลบตอน ban)
  const fresh = await req('/api/login', { method: 'POST', body: { email: 'mint@test.com', password: 'password123' } });
  const freshCookie = 'sid=' + fresh.cookie;
  const ovRead = readUntil(ovSSE, 'event: donation', 4000);
  const testAlert = await req('/api/dashboard/test-alert', { method: 'POST', cookie: freshCookie });
  const ovBuf = await ovRead;
  chk('overlay donation event', ovBuf.includes('event: donation') && ovBuf.includes('"speech"'), 'clients=' + testAlert.data?.clients);
  chk('thai speech text', ovBuf.includes('หนึ่ง') || ovBuf.includes('ทดสอบระบบแจ้งเตือน'), JSON.stringify(ovBuf).match(/"speech":"[^"]*"/)?.[0]);
  ovSSE.body?.cancel().catch(() => {});

  // 17. CSRF block
  const noCsrf = await fetch(BASE + '/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: streamerCookie }, body: '{}' });
  chk('CSRF protected', noCsrf.status === 403);

  // 18. pages render
  const pages = ['/', '/auth', '/dashboard', '/admin', user ? '/overlay/' + user.overlayToken : '/overlay/invalid', '/mint', '/nosuchuser123'];
  for (const p of pages) {
    const pg = await fetch(BASE + p);
    const html = await pg.text();
    chk('page ' + p, pg.status === 200 && html.length > 500, 'status=' + pg.status);
  }

  console.log('\n✅ PASS (' + ok.length + ')');
  ok.forEach(x => console.log('  ✓ ' + x));
  if (fail.length) { console.log('\n❌ FAIL (' + fail.length + ')'); fail.forEach(x => console.log('  ✗ ' + x)); process.exitCode = 1; }

  async function getDonorCookie() {
    const x = await req('/api/login', { method: 'POST', body: { email: 'mint@test.com', password: 'password123' } });
    return x.cookie;
  }
})();
