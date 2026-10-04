from __future__ import annotations

from dataclasses import dataclass

from app.services.http import HttpClient


@dataclass(frozen=True)
class OALocation:
    landing_url: str | None
    pdf_url: str | None
    license: str | None
    host_type: str | None


class UnpaywallClient:
    def __init__(self, http: HttpClient, base_url: str, email: str) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.email = email

    async def oa_locations(self, doi: str) -> list[OALocation]:
        """Legal open-access copies of a DOI (best first). Empty without a contact email."""
        if not self.email:
            return []
        resp = await self.http.get(f"{self.base_url}/{doi}", params={"email": self.email})
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not data.get("is_oa"):
            return []
        raw = [data.get("best_oa_location") or {}] + list(data.get("oa_locations") or [])
        out: list[OALocation] = []
        seen: set[tuple[str | None, str | None]] = set()
        for loc in raw:
            landing, pdf = loc.get("url_for_landing_page") or loc.get("url"), loc.get("url_for_pdf")
            if not (landing or pdf) or (landing, pdf) in seen:
                continue
            seen.add((landing, pdf))
            out.append(OALocation(landing, pdf, loc.get("license"), loc.get("host_type")))
        return out
