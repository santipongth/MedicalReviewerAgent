"""Real Crawl4AI service: `docker compose up -d crawl4ai`, export CRAWL4AI_API_TOKEN (same value as .env),
then MRA_INTEGRATION=1 uv run pytest -m integration tests/integration/test_crawl4ai_live.py."""
import os

import pytest

from app.services.crawler import Crawl4AIClient
from app.services.quality import looks_like_fulltext
from app.services.sections import extract_markdown_sections

pytestmark = pytest.mark.integration


@pytest.fixture
async def crawler():
    token = os.environ.get("CRAWL4AI_API_TOKEN")
    if not token:
        pytest.skip("export CRAWL4AI_API_TOKEN (same value as in .env)")
    client = Crawl4AIClient(os.environ.get("CRAWL4AI_URL", "http://localhost:11235"), token)
    yield client
    await client.aclose()


async def test_live_open_access_html_article(crawler):
    page = await crawler.crawl("https://www.mdpi.com/2072-6694/18/16/2537", pdf=False)
    assert page.ok, page.error
    assert looks_like_fulltext(page.markdown, "Dual Metabolic Targeting of Cancer metformin", pdf=False)
    text = extract_markdown_sections(page.markdown, max_chars=60_000)
    assert "## Methods" in text and "## Results" in text


async def test_live_pdf_and_robots(crawler):
    pdf = await crawler.crawl("https://www.frontiersin.org/articles/10.3389/fendo.2018.00622/pdf", pdf=True)
    assert pdf.ok and len(pdf.markdown) > 20_000
    denied = await crawler.crawl("https://jeccr.biomedcentral.com/track/pdf/10.1186/s13046-019-1495-2", pdf=True)
    assert denied.robots_denied and not denied.ok
