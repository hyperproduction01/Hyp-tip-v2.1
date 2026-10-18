// debug: overlay SSE event timing
const BASE = 'http://localhost:3000';
const J = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
(async () => {
  const reg = await fetch(BASE + '/api/register', { method: 'POST', headers: J, body: JSON.stringify({ email: 's@t.com', username: 'streamer1', displayName: 'ทดสอบ', password: 'password123' }) });
  const sid = (reg.headers.get('set-cookie') || '').match(/sid=([^;]+)/)[1];
  const C = { ...J, Cookie: 'sid=' + sid };
  await fetch(BASE + '/api/settings', { method: 'PATCH', headers: C, body: JSON.stringify({ promptpayId: '0812345678', tts: true, minTts: 1 }) });
  const me = await (await fetch(BASE + '/api/me', { headers: C })).json();
  const token = me.user.overlayToken;

  const ov = await fetch(BASE + '/api/overlay/' + token + '/stream');
  console.log('overlay stream status', ov.status);

  // replay-like push: use test-alert
  const t = await fetch(BASE + '/api/dashboard/test-alert', { method: 'POST', headers: C });
  console.log('test-alert:', await t.text());

  const reader = ov.body.getReader(); const dec = new TextDecoder();
  const buf = await Promise.race([
    (async () => { let s = ''; for (let i = 0; i < 6; i++) { const { value, done } = await reader.read(); if (done) break; s += dec.decode(value, { stream: true }); if (s.includes('event: donation')) break; } return s; })(),
    new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))
  ]);
  console.log('BUF>>>', JSON.stringify(buf));
})();
