import { ReceiptPanel } from "@/components/landing/receipt-panel";
import { RequestSlip } from "@/components/landing/request-slip";

export default function Home() {
  return (
    <div className="grid gap-16">
      <section aria-labelledby="h-home" className="grid items-start gap-8 pt-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="min-w-0">
          <h1 id="h-home" className="max-w-[16ch] text-[clamp(2rem,4.2vw,3.25rem)] font-bold">
            ถามเรื่องยาหรือโรค ได้ทุกตัวเลขพร้อมประโยคต้นฉบับ
          </h1>
          <p className="mt-4 max-w-[52ch] text-[1.05rem] text-muted">
            เอเจนต์ตีความคำถามของคุณให้เป็นคำถามวิจัย ค้น PubMed, arXiv และฐานข้อมูลวิชาการ คัดกรอง 60 ฉบับที่มีบทคัดย่อ
            แล้ววิเคราะห์บทคัดย่อสูงสุด 30 ฉบับที่ตรงที่สุด เทียบว่างานวิจัยเห็นตรงกันหรือขัดกันตรงไหน ทุกตัวเลขถูกตรวจกับบทคัดย่อก่อนแสดง
          </p>
          <div className="mt-8">
            <RequestSlip />
          </div>
        </div>
        <ReceiptPanel />
      </section>
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
