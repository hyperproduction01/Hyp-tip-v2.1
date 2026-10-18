// ตรวจฟังก์ชัน thaiNumber โดยดึงจาก server.js ตรงๆ (ไม่ copy โค้ด)
import fs from 'node:fs';
const src = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
const m = src.match(/function thaiNumber\(input\) \{[\s\S]*?\n\}/);
if (!m) { console.log('ไม่พบฟังก์ชัน thaiNumber'); process.exit(1); }
const thaiNumber = eval('(' + m[0].replace('function thaiNumber(input)', 'function(input)') + ')');

const cases = [
  [0, 'ศูนย์'], [1, 'หนึ่ง'], [2, 'สอง'], [10, 'สิบ'], [11, 'สิบเอ็ด'], [12, 'สิบสอง'],
  [20, 'ยี่สิบ'], [21, 'ยี่สิบเอ็ด'], [100, 'หนึ่งร้อย'], [101, 'หนึ่งร้อยเอ็ด'],
  [150, 'หนึ่งร้อยห้าสิบ'], [1000, 'หนึ่งพัน'], [1001, 'หนึ่งพันเอ็ด'], [1500, 'หนึ่งพันห้าร้อย'],
  [20000, 'สองหมื่น'], [100000, 'หนึ่งแสน'], [1000000, 'หนึ่งล้าน'], [1000001, 'หนึ่งล้านหนึ่ง'],
  [1234567, 'หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ด'], [50000, 'ห้าหมื่น']
];
let bad = 0;
for (const [n, want] of cases) {
  const got = thaiNumber(n);
  const ok = got === want;
  if (!ok) bad++;
  console.log((ok ? '✓' : '✗') + ' ' + n + ' → ' + got + (ok ? '' : ' (คาด: ' + want + ')'));
}
process.exit(bad ? 1 : 0);
