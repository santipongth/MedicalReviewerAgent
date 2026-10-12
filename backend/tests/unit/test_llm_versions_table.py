from sqlalchemy import select

from app.db.models import LlmConfigVersion
from tests.llm_helpers import MINIMAL


async def test_versions_store_the_document_and_number_upwards(session_factory):
    async with session_factory() as s, s.begin():
        s.add(LlmConfigVersion(created_by="owner", source="edit", config=MINIMAL, changes={}))
        s.add(LlmConfigVersion(created_by="owner", source="restore", restored_from=1, config=MINIMAL,
                               changes={"active_preset": "a → b"}, note="back"))
    async with session_factory() as s:
        rows = list((await s.execute(select(LlmConfigVersion).order_by(LlmConfigVersion.id))).scalars())
    assert [r.id for r in rows] == [1, 2]
    assert rows[0].config == MINIMAL and rows[1].restored_from == 1 and rows[1].note == "back"
    assert rows[1].changes == {"active_preset": "a → b"} and rows[0].created_at is not None
