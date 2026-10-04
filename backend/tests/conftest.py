import os

import pytest


def pytest_collection_modifyitems(config, items):
    if os.environ.get("MRA_INTEGRATION") == "1":
        return
    skip = pytest.mark.skip(reason="integration test; set MRA_INTEGRATION=1 with docker compose up")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)
