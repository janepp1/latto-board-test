# Latto Board · Supabase (ทดลอง)

บอร์ดงานทีมการตลาด Latto เวอร์ชันทดลองที่ย้ายออกจาก Claude Artifact มาใช้บริการภายนอก

| ส่วน | ใช้อะไร |
|---|---|
| หน้าเว็บ | GitHub Pages (`index.html`) |
| ฐานข้อมูล | Supabase Postgres — ตาราง `docs` + Row Level Security |
| ล็อกอิน | Google Sign-in ผ่าน Supabase Auth (เข้าได้เฉพาะอีเมลที่อยู่ในรายชื่อทีม) |
| รูปโปรไฟล์ | Supabase Storage (bucket `avatars`) |
| อีเมลสรุป / สำรองข้อมูล / เลื่อนรอบบัตร | งานตั้งเวลาของ Claude ที่อ่าน–เขียน Supabase |

- `index.html` สร้างจากหน้า Artifact เดิมด้วย `src/build.py` (ใส่ `src/adapter.js` ที่แปลงการเรียกฐานข้อมูลของ Artifact ให้ไปใช้ Supabase)
- `supabase/schema.sql` โครงสร้างฐานข้อมูลและสิทธิ์
- ข้อมูลจริงไม่ได้อยู่ใน repo นี้ — อยู่ใน Supabase ที่ล็อกด้วยสิทธิ์สมาชิกเท่านั้น
- คีย์ในหน้าเว็บเป็น *publishable key* ซึ่งเปิดเผยได้ตามปกติ ความปลอดภัยมาจาก RLS
