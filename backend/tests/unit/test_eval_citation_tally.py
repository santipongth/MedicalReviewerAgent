import asyncio

from app.harness.citation_tally import CitationTally, use_tally
from app.harness.verify import strip_unknown_citations


def test_tally_counts_seen_and_stripped_refs():
    tally = CitationTally()
    with use_tally(tally):
        out = strip_unknown_citations("A [P1, P9]. B [P8].", {"P1"})
    assert out == "A [P1]. B." and (tally.proposed, tally.stripped) == (3, 2)


def test_no_tally_outside_context():
    assert strip_unknown_citations("A [P1]", {"P1"}) == "A [P1]"


def test_tally_reaches_child_tasks():
    tally = CitationTally()

    async def branch():  # a parallel graph branch inherits the context of the task that created it
        strip_unknown_citations("x [P2]", set())

    async def main():
        with use_tally(tally):
            await asyncio.gather(branch(), branch())

    asyncio.run(main())
    assert tally.stripped == 2
