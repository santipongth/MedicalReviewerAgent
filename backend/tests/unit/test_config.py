from app.config import Settings


def test_defaults_are_local_dev():
    s = Settings(_env_file=None)
    assert s.database_url.startswith("postgresql+psycopg://")
    assert s.redis_url == "redis://localhost:6379/0"
    assert s.review_rate_limit == "5/hour"


def test_checkpoint_conninfo_strips_sqlalchemy_driver():
    s = Settings(_env_file=None, database_url="postgresql+psycopg://u:p@db:5432/mra")
    assert s.checkpoint_conninfo == "postgresql://u:p@db:5432/mra"


def test_env_override(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://r:6379/3")
    assert Settings(_env_file=None).redis_url == "redis://r:6379/3"
