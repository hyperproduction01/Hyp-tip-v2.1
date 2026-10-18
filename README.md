# HYP TIP – ระบบรับโดเนทสำหรับสตรีมเมอร์

หน้าแรก + สมัคร/ล็อกอิน + หน้าโดเนท (PromptPay QR) + Overlay สำหรับ OBS (SSE, เสียง, TTS) + แดชบอร์ด + หลังบ้านแอดมิน + ระบบแพ็กเกจ + Super Admin
สแตก: Node.js 22+ (Express, `node:sqlite`) และ HTML/CSS/JS ล้วน

## รันบนเครื่อง
```bash
npm install
cp .env.example .env     # แก้ ADMIN_EMAIL, SITE_NAME
npm start                # http://localhost:3000
```
สมัครสมาชิกด้วยอีเมลเดียวกับ `ADMIN_EMAIL` เพื่อเข้า `/admin`

## วิธีใช้
1. สมัครสมาชิก → แดชบอร์ด → ตั้งค่า → ใส่ PromptPay (เบอร์โทร/เลขบัตร) → บันทึก
2. แท็บ "ลิงก์ OBS" → คัดลอกลิงก์ไปวางเป็น Browser Source ใน OBS → กด "ส่งแจ้งเตือนทดสอบ"
3. แชร์ลิงก์ `https://โดเมนของคุณ/ชื่อผู้ใช้` ให้แฟนๆ

## การยืนยันรายการ
- **ยืนยันเอง:** แฟนๆ โอนผ่าน QR (แนบสลิปได้) → ผู้รับกด "ยืนยัน" ในแดชบอร์ด → แจ้งเตือนขึ้นจอทันที
- **ตรวจสลิปอัตโนมัติ (RDCW):** ตั้ง `RDCW_CLIENT_ID`/`RDCW_CLIENT_SECRET` แล้วระบบจะยิงสลิปไปตรวจสอบที่ `suba.rdcw.co.th/v2/inquiry` ทันทีที่อัปโหลด ถ้าผ่าน (ยอดตรง) จะยืนยันอัตโนมัติ ถ้าไม่ผ่าน/API ขัดข้องจะค้างรอตรวจด้วยตนเอง ป้องกันสลิปซ้ำด้วย hash
- **อัตโนมัติ (Webhook):** ตั้ง `WEBHOOK_SECRET` แล้วให้ระบบ/Gateway ของคุณ `POST /api/webhook/payment`
  - body: `{"ref":"<ref ของรายการ>","amount":100,"status":"paid"}`
  - header: `x-signature` = HMAC-SHA256 (hex) ของ raw body ด้วย `WEBHOOK_SECRET`

## ระบบสิทธิ์
- **Super Admin** (`SUPER_ADMIN_EMAILS` หรือ `role='super_admin'`): ควบคุมแพ็กเกจ สมาชิก ตั้งค่าไซต์ ดู logs ที่ `/api/super/*`
- **Admin** (`ADMIN_EMAIL`): ดู/อนุมัติรายการ จัดการผู้ใช้ ที่ `/admin`
- **Streamer:** จัดการหน้ารับทิปและ Overlay ของตนเอง
- ทุกเส้นทางตรวจสิทธิ์จาก Backend เสมอ ผู้สมัครทั่วไปตั้งตัวเองเป็น Super Admin ไม่ได้

## ระบบแพ็กเกจ
Free / Streamer / Pro (กำหนดจากหลังบ้าน Super Admin ได้) — ดูแพ็กเกจของตัวเองที่ `GET /api/subscriptions/me`

## Deploy บน Render
ใช้ `render.yaml` (Web Service + Persistent Disk 1GB ที่ `/var/data` สำหรับฐานข้อมูลและสลิป) แล้วตั้ง `ADMIN_EMAIL`
ถ้าไม่ใช้ Disk ข้อมูลจะหายทุกครั้งที่ redeploy

## ความปลอดภัยที่ทำไว้
รหัสผ่าน bcrypt · session cookie HttpOnly/SameSite · ป้องกัน CSRF ด้วย header · rate limit · แสดงข้อความด้วย textContent (กัน XSS) ·
กรองคำหยาบ · Webhook ตรวจ HMAC · ลิงก์ Overlay เป็น token สุ่ม (สร้างใหม่ได้) · สลิปดูได้เฉพาะเจ้าของ ·
ตรวจ RDCW จาก Backend เท่านั้น (Secret อยู่ใน env ไม่ส่งไปฝั่ง client) · กันสลิปซ้ำด้วย hash · บันทึก login/admin logs

## ข้อควรรู้
- เงินโอนเข้าบัญชี PromptPay ของผู้รับโดยตรง ระบบนี้ไม่ได้ถือเงินแทนใคร จึงไม่มีระบบถอนเงิน
- ใช้ `node:sqlite` (ไฟล์เดียว ไม่ต้องตั้ง DB server) — ถ้าต้องการ PostgreSQL ตามสเปก production ให้ย้าย data layer ในภายหลัง
- เสียงอ่านออกเสียงใช้ Web Speech API ของเบราว์เซอร์ OBS อาจไม่มีเสียงภาษาไทยในบางเครื่อง ให้ทดสอบก่อนสตรีม

## ตั้งค่าบน Render (สรุป)
- ต้องใช้ Node 22.13 ขึ้นไป (ตั้ง `NODE_VERSION=22` ใน Environment)
- แพ็กเกจฟรีไม่มี Persistent Disk ข้อมูลจะหายเมื่อ redeploy/restart ใช้ทดลองได้เท่านั้น
- ใช้งานจริง: เลือกแพ็กเกจเสียเงิน + เพิ่ม Disk (Mount Path `/var/data`) + ตั้ง `DATA_DIR=/var/data`
