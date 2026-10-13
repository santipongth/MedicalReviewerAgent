"""Synthetic ThaiJO responses for tests (Plan 24). The shapes follow what the API returned on 2026-10-13 (field lists in
the Plan 24 spec, section 3); every title, name and abstract here is invented. Never paste a real response here."""
from __future__ import annotations

API = "https://www.tci-thaijo.org/api/v1"
URL1 = "https://he01.tci-thaijo.org/index.php/demo/article/view/900001"
URL2 = "https://he02.tci-thaijo.org/index.php/demo2/article/view/900002"


def hit(id: str, url: str, *, en: str | None = None, th: str | None = None, year: int = 2024,
        doi: str | None = None, category: str | None = None) -> dict:
    """One search hit as the search endpoint returns it (no abstract)."""
    submission = int(id.split("-")[1])
    return {
        "article_url": url,
        "authors": {"en_US": ["Somchai  Demo", "Malee Example"], "th_TH": ["สมชาย ตัวอย่าง", "มาลี ตัวอย่าง"]},
        "category": category or id.split("-")[0],
        "date_published": "2024-03-01T00:00:00+07:00",
        "doi": doi,
        "id": id,
        "issue_id": 1001,
        "issue_url": "https://he01.tci-thaijo.org/index.php/demo/issue/view/1001",
        "journal_id": 7,
        "journal_name": {"en_US": "Journal of Demo Health Sciences", "th_TH": "วารสารวิทยาศาสตร์สุขภาพตัวอย่าง"},
        "journal_path": "demo",
        "journal_url": "https://he01.tci-thaijo.org/index.php/demo",
        "keywords": {"en_US": ["adherence"], "th_TH": ["การใช้ยา"]},
        "languages": ["en_US", "th_TH"],
        "publication_id": 5000,
        "submission_id": submission,
        "thumbnail_url": None,
        "titles": {k: v for k, v in (("en_US", en), ("th_TH", th)) if v},
        "year": year,
    }


HITS = [
    hit("health01-900001", URL1, en="Medication Adherence among Older Adults with Hypertension in a District Hospital",
        th="การใช้ยาตามสั่งของผู้สูงอายุ"),
    hit("health02-900002", URL2, en="A Nurse-Led Telephone Follow-up Programme after Stroke: a Quasi-experimental Study",
        year=2567, doi="https://doi.org/10.9999/DEMO.2"),
    hit("social01-900003", "https://so01.tci-thaijo.org/index.php/soc/article/view/900003",
        en="Household Spending on Medicines in Rural Provinces"),
    hit("health01-900004", "https://evil.example/index.php/demo/article/view/900004",
        en="An Article Whose Page Is on Another Host"),
    hit("health03-900005", "https://he03.tci-thaijo.org/index.php/demo3/article/view/900005",
        th="ผลของโปรแกรมส่งเสริมสุขภาพต่อพฤติกรรมการออกกำลังกาย"),
    hit("health01-900006", "https://he01.tci-thaijo.org/index.php/demo/article/view/123",
        en="A Hit Whose Page Names Another Submission"),
]
SEARCH = {"hits": HITS, "total": 6, "page": 1, "per_page": 20, "processing_time_ms": 12, "facets": None}

ABSTRACT1 = ("Background: Older adults with hypertension often stop their medicines. Objective: To describe adherence "
             "and its factors in a district hospital. Methods: A cross-sectional survey of 240 patients aged 60 years "
             "or more used a structured questionnaire. Results: Adherence was good in 172 patients (71.7%); living "
             "alone was associated with poor adherence (OR 2.10, 95% CI 1.15 to 3.84). Conclusion: Follow-up should "
             "target people who live alone.")
ABSTRACT2_RAW = ("<p>This quasi-experimental study compared 60 stroke survivors who received nurse telephone calls for 12 "
                 "weeks with 60 who received usual care. Mean self-care scores rose from 2.1 to 3.4 in the programme "
                 "group and from 2.2 to 2.5 in the comparison group (p &lt; 0.001). Readmission within 90 days was 5% "
                 "and 15%.</p>")
ABSTRACT2 = ("This quasi-experimental study compared 60 stroke survivors who received nurse telephone calls for 12 "
             "weeks with 60 who received usual care. Mean self-care scores rose from 2.1 to 3.4 in the programme "
             "group and from 2.2 to 2.5 in the comparison group (p < 0.001). Readmission within 90 days was 5% "
             "and 15%.")


def detail(h: dict, en: str, th: str = "บทคัดย่อภาษาไทยสำหรับการทดสอบ") -> dict:
    """The detail endpoint's record: the hit's fields plus abstracts, pages, pdf_url and seq."""
    return {**h, "abstracts": {"en_US": en, "th_TH": th}, "abstracts_raw": {"en_US": f"<p>{en}</p>", "th_TH": th},
            "pages": "45-58", "pdf_url": f"{h['article_url']}/555", "seq": 1.0}


DETAILS = {
    "health01-900001": detail(HITS[0], ABSTRACT1),
    "health02-900002": detail(HITS[1], ABSTRACT2_RAW),
    "health03-900005": detail(HITS[4], "-"),
}
NOT_FOUND = {"error": "Article 'health01-0' not found", "code": "NOT_FOUND"}


# ---- OAI-PMH GetRecord answers (oai_dc), shaped as the journal servers answered on 2026-10-13 ----------------------
OAI_URL1 = "https://he01.tci-thaijo.org/index.php/demo/oai"
OAI_ID1 = "oai:he01.tci-thaijo.org:article/900001"


def oai_record(identifier: str = OAI_ID1, *, sources: str = "", rights: str = "", types: str = "",
               status: str = "") -> bytes:
    header_status = f' status="{status}"' if status else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="https://he01.tci-thaijo.org/lib/pkp/xml/oai2.xsl" ?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <responseDate>2026-10-13T04:00:00Z</responseDate>
 <request verb="GetRecord" metadataPrefix="oai_dc" identifier="{identifier}">{OAI_URL1}</request>
 <GetRecord><record>
  <header{header_status}><identifier>{identifier}</identifier><datestamp>2024-03-01T00:00:00Z</datestamp>
   <setSpec>demo:ART</setSpec></header>
  <metadata>
   <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title xml:lang="en-US">Medication Adherence among Older Adults with Hypertension in a District Hospital</dc:title>
    <dc:creator>ตัวอย่าง, สมชาย</dc:creator>
    <dc:description xml:lang="en-US">An invented abstract; the OAI step never reads it.</dc:description>
    <dc:date>2024-03-01</dc:date>
    {types}
    <dc:format>application/pdf</dc:format>
    <dc:identifier>https://he01.tci-thaijo.org/index.php/demo/article/view/900001</dc:identifier>
    {sources}
    <dc:language>tha</dc:language>
    <dc:relation>https://he01.tci-thaijo.org/index.php/demo/article/view/900001/555</dc:relation>
    {rights}
   </oai_dc:dc>
  </metadata>
 </record></GetRecord>
</OAI-PMH>
""".encode()


FULL_SOURCES = """<dc:source xml:lang="en-US">Journal of Demo Health Sciences; Vol. 17 No. 4 (2024): Oct-Dec; 1048-1066</dc:source>
    <dc:source xml:lang="th-TH">วารสารวิทยาศาสตร์สุขภาพตัวอย่าง; ปีที่ 17 ฉบับที่ 4 (2024): ต.ค.-ธ.ค.; 1048-1066</dc:source>
    <dc:source>3027-613x</dc:source>
    <dc:source>2985-1750</dc:source>"""
FULL_RIGHTS = """<dc:rights xml:lang="th-TH">ลิขสิทธิ์ (c) 2024 วารสารวิทยาศาสตร์สุขภาพตัวอย่าง</dc:rights>
    <dc:rights xml:lang="th-TH">https://creativecommons.org/licenses/by-nc-nd/4.0</dc:rights>"""
FULL_TYPES = """<dc:type>info:eu-repo/semantics/article</dc:type>
    <dc:type>info:eu-repo/semantics/publishedVersion</dc:type>
    <dc:type xml:lang="en-US">Peer-reviewed article</dc:type>
    <dc:type xml:lang="th-TH">บทความที่ผ่านการประเมิน</dc:type>"""
OAI_FULL = oai_record(sources=FULL_SOURCES, rights=FULL_RIGHTS, types=FULL_TYPES)
# no pages and no article type (seen on another journal): "Vol. 11 No. 2 (2024): Vol.11 No.2"
OAI_NO_PAGES = oai_record(sources='<dc:source xml:lang="en-US">Journal of Demo Health Sciences; Vol. 11 No. 2 (2024): '
                                  'Vol.11 No.2</dc:source>\n    <dc:source>2985-1750</dc:source>',
                          rights='<dc:rights xml:lang="th-TH">http://creativecommons.org/licenses/by-nc-nd/4.0</dc:rights>',
                          types="<dc:type>info:eu-repo/semantics/article</dc:type>")
OAI_MISSING = f"""<?xml version="1.0" encoding="UTF-8"?>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/">
 <responseDate>2026-10-13T04:00:00Z</responseDate>
 <request verb="GetRecord" metadataPrefix="oai_dc" identifier="{OAI_ID1}">{OAI_URL1}</request>
 <error code="idDoesNotExist">No matching identifier in this repository</error></OAI-PMH>
""".encode()
OAI_BOMB = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>
<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/"><responseDate>&lol2;</responseDate></OAI-PMH>
"""
