// debug2: event ที่เขียนก่อนเริ่มอ่าน (delayed read) จะยังได้อยู่ไหม
const BASE = 'http://localhost:3000';
const J = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
(async () => {
  const reg = await fetch(BASE + '/api/register', { method: 'POST', headers: J, body: JSON.stringify({ email: 's2@t.com', username: 'streamer2', displayName: 'ทดสอบ2', password: 'password123' }) });
  const sid = (reg.headers.get('set-cookie') || '').match(/sid=([^;]+)/)[1];
  const C = { ...J, Cookie: 'sid=' + sid };
  await fetch(BASE + '/api/settings', { method: 'PATCH', headers: C, body: JSON.stringify({ promptpayId: '0812345678', tts: true, minTts: 1 }) });
  const me = await (await fetch(BASE + '/api/me', { headers: C })).json();
  const token = me.user.overlayToken;

  const ov = await fetch(BASE + '/api/overlay/' + token + '/stream');
  const t = await fetch(BASE + '/api/dashboard/test-alert', { method: 'POST', headers: C });
  console.log('test-alert:', await t.text());
  console.log('waiting 3s without reading...');
  await new Promise(r => setTimeout(r, 3000));
  const reader = ov.body.getReader(); const dec = new TextDecoder();
  let buf = '';
  const read3s = (async () => {
    for (;;) {
      const p = reader.read();
      const v = await Promise.race([p, new Promise(r => setTimeout(() => r('timeout'), 3000))]);
      if (v === 'timeout') break;
      if (v.done) { console.log('stream done'); break; }
      buf += dec.decode(v.value, { stream: true });
      if (buf.includes('event: donation')) break;
    }
  })();
  await read3s;
  console.log('BUF>>>', JSON.stringify(buf).slice(0, 200));
  process.exit(0);
})();
