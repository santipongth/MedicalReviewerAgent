import { SampleBench } from "@/components/landing/sample-bench";
import { RequestSlip } from "@/components/landing/request-slip";

export default function Home() {
  return (
    <div className="grid gap-16">
      <section aria-labelledby="h-home" className="grid items-center gap-8 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <h1 id="h-home" className="text-[clamp(2.1rem,5vw,3.6rem)] font-bold leading-[1.15]">
            <span className="nw">อย่าเพิ่งเชื่อเรา</span> <span className="nw">แตะที่ตัวเลข</span><span className="nw">ดูก่อน</span>
          </h1>
          <p className="mt-5 max-w-[52ch] text-[1.05rem] text-muted">
            ด้านล่างคือรายงานจริงที่ระบบทำไว้ ตัวเลขที่มีเส้นเทปลายทแยงตรวจกับบทคัดย่อแล้ว แตะเพื่อดูประโยคต้นฉบับ
            ส่วนช่องลายเส้นคือค่าที่ตรวจไม่ผ่าน ระบบเว้นว่างไว้ ไม่เดา ส่งคำถามของคุณเองได้ที่ใบส่งคำถาม ฟรี ไม่ต้องสมัคร
          </p>
        </div>
        <RequestSlip />
      </section>
      <SampleBench />
      <section aria-labelledby="h-how" className="grid gap-6 border-t border-rule pt-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <h2 id="h-how" className="text-2xl font-bold">สิ่งที่เอเจนต์ทำในไม่กี่นาที</h2>
        <ol className="grid gap-3 text-[0.97rem]">
          <li><b className="font-display">ตีความคำถาม</b> แปลงหัวข้อเป็นคำถามวิจัยแบบ PICO พร้อมบอกสมมติฐานที่เลือกเอง</li>
          <li><b className="font-display">ค้นและคัดกรอง</b> ค้นหลายฐานข้อมูล ตัดซ้ำ ให้สองโมเดลลงคะแนนงานที่ก้ำกึ่ง แล้วเลือกฉบับที่ตรงที่สุด</li>
          <li><b className="font-display">อ่านและสกัดผล</b> อ่านจากบทคัดย่อเท่านั้น ไม่ดาวน์โหลดฉบับเต็ม ทุกตัวเลขต้องมีประโยคในบทคัดย่อรองรับ</li>
          <li><b className="font-display">เทียบและสรุป</b> ตารางผลแต่ละการศึกษา จุดที่เห็นตรงกัน จุดที่ขัดกันพร้อมเหตุผลที่เป็นไปได้ และระดับความแข็งแรงของหลักฐาน</li>
        </ol>
        <p className="text-sm text-muted md:col-start-2">
          ผลลัพธ์เป็นการทบทวนงานวิจัยแบบเร่งด่วนโดยอัตโนมัติ ไม่ใช่คำแนะนำทางการแพทย์ ตรวจสอบกับต้นฉบับและผู้เชี่ยวชาญก่อนนำไปใช้
        </p>
      </section>
    </div>
  );
}
