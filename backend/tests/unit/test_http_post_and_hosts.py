import httpx
import respx

from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.urlsafety import is_allowed_host


async def _nosleep(_):
    return None


@respx.mock
async def test_post_sends_json_and_retries_like_get():
    route = respx.post("https://api.example.org/s").mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json={"hits": []})])
    client = HttpClient(retries=1, backoff=0.1, sleep=_nosleep)
    resp = await client.post("https://api.example.org/s", json={"q": "metformin"})
    await client.aclose()
    assert resp.status_code == 200 and route.call_count == 2
    assert route.calls[-1].request.content == b'{"q":"metformin"}'


@respx.mock
async def test_follow_redirects_false_returns_the_redirect_instead_of_leaving_the_host():
    respx.get("https://a.example.org/x").mock(
        return_value=httpx.Response(302, headers={"Location": "http://169.254.169.254/latest"}))
    other = respx.get("http://169.254.169.254/latest").mock(return_value=httpx.Response(200))
    client = HttpClient(retries=0, sleep=_nosleep)
    resp = await client.get("https://a.example.org/x", follow_redirects=False)
    await client.aclose()
    assert resp.status_code == 302 and other.call_count == 0


def test_thaijo_api_is_spaced_like_europe_pmc():
    assert DEFAULT_MIN_INTERVAL["www.tci-thaijo.org"] == 0.2


def test_allowed_host_takes_only_https_on_the_domain():
    ok = ["https://he01.tci-thaijo.org/index.php/x/oai", "https://www.tci-thaijo.org/api/v1/articles/search",
          "https://tci-thaijo.org/", "https://HE02.TCI-THAIJO.ORG/a", "https://he01.tci-thaijo.org:443/a"]
    bad = ["http://he01.tci-thaijo.org/a", "https://tci-thaijo.org.evil.example/a", "https://eviltci-thaijo.org/a",
           "https://user@he01.tci-thaijo.org/a", "https://he01.tci-thaijo.org:8443/a", "https://169.254.169.254/",
           "ftp://he01.tci-thaijo.org/a", "not a url", ""]
    assert all(is_allowed_host(u, "tci-thaijo.org") for u in ok)
    assert not any(is_allowed_host(u, "tci-thaijo.org") for u in bad)
