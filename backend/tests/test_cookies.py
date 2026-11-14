from app.engine import cookies
from app.engine.errors import classify
from app.engine.extractor import base_options

SAMPLE = (
    "# Netscape HTTP Cookie File\n"
    ".youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc\n"
    "#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1999999999\tHSID\tdef\n"
)


def test_cookie_endpoints_never_return_contents(client):
    assert client.get("/api/cookies").json()["present"] is False
    r = client.put("/api/cookies", json={"content": SAMPLE})
    assert r.status_code == 200
    body = r.json()
    assert body["present"] and body["youtube"] and body["count"] == 2
    assert "abc" not in r.text and "def" not in r.text
    assert client.put("/api/cookies", json={"content": "hello world"}).status_code == 422
    assert client.get("/api/cookies").json()["count"] == 2  # bad upload kept the old file
    assert client.delete("/api/cookies").json()["present"] is False


def test_each_call_gets_its_own_cookie_snapshot(client):
    assert "cookiefile" not in base_options()
    client.put("/api/cookies", json={"content": SAMPLE.replace("# Netscape HTTP Cookie File\n", "")})
    a, b = base_options()["cookiefile"], base_options()["cookiefile"]
    assert a != b
    text = open(a, encoding="utf-8").read()
    assert text.startswith("# Netscape HTTP Cookie File") and "SID\tabc" in text
    client.delete("/api/cookies")


def test_age_gate_and_bot_check_are_classified_apart():
    age = classify("ERROR: [youtube] x: Sign in to confirm your age. Use --cookies-from-browser or --cookies")
    assert age.code == "auth" and "age-restricted" in age.message
    bot = classify("ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies")
    assert bot.code == "blocked"


def test_cookie_parser_rejects_garbage():
    import pytest

    with pytest.raises(cookies.CookieError):
        cookies._parse("just some text")
    with pytest.raises(cookies.CookieError):
        cookies._parse("# only comments\n")
