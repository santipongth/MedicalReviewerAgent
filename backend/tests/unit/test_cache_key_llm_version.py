from app.services.llm_store import publish_version


async def test_a_new_config_version_makes_a_repeated_topic_run_again(client, redis):
    body = {"topic": "metformin and colorectal cancer"}
    first = await client.post("/api/v1/reviews", json=body)
    again = await client.post("/api/v1/reviews", json=body)
    assert first.status_code == again.status_code == 202
    assert again.json()["review_id"] == first.json()["review_id"]  # same config: reused
    await publish_version(redis, 7)
    other = await client.post("/api/v1/reviews", json=body)
    assert other.status_code == 202 and other.json()["review_id"] != first.json()["review_id"]
