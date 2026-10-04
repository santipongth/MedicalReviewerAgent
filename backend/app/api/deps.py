from fastapi import Request

from app.config import Settings
from app.runtime import AppDeps


def get_deps(request: Request) -> AppDeps:
    return request.app.state.deps


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings
