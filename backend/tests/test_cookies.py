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


def test_google_only_cookies_are_not_reported_as_youtube(client):
    drive = "#HttpOnly_.google.com\tTRUE\t/\tTRUE\t1999999999\tSAPISID\tabc\n.drive.google.com\tTRUE\t/\tTRUE\t1999999999\tX\ty\n"
    body = client.put("/api/cookies", json={"content": drive}).json()
    assert body["google"] and not body["youtube"]


def test_drive_auth_helpers():
    from app.engine import gdrive

    assert gdrive.sid_authorization({}) is None
    auth = gdrive.sid_authorization({"SAPISID": "s", "__Secure-3PAPISID": "t"}, now=1000)
    import hashlib
    assert auth.startswith("SAPISIDHASH 1000_" + hashlib.sha1(b"1000 s https://drive.google.com").hexdigest())
    assert "SAPISID3PHASH 1000_" in auth
    assert gdrive.auth_user("https://drive.google.com/file/d/x/view?authuser=2") == "2"
    assert gdrive.auth_user("https://drive.google.com/u/1/file/d/x/view") == "1"
    assert gdrive.auth_user("https://drive.google.com/file/d/x/view") == "0"
    assert gdrive.resource_key("https://drive.google.com/file/d/x/view?resourcekey=0-abc") == "0-abc"
    msg = classify("ERROR: [GoogleDrive] x: Google Drive: this file isn't public. If ...")
    assert msg.code == "auth" and "Drive" in msg.message


def test_drive_folder_page_parsing():
    from app.engine import gdrive

    page = ("<title>Lectures - Google Drive</title><script>window['_DRIVE_ivd'] = '[[[\x22id1\x22,[\x22f\x22],"
            "\x22Week 1.mp4\x22,\x22video\/mp4\x22],[\x22sub\x22,[\x22f\x22],\x22Part 2\x22,"
            "\x22application\/vnd.google-apps.folder\x22]],null]';</script>")
    title, items = gdrive.parse_folder_page(page)
    assert title == "Lectures"
    assert [(i["id"], i["mime"]) for i in items] == [("id1", "video/mp4"), ("sub", "application/vnd.google-apps.folder")]
    assert gdrive.parse_folder_page("<html>sign in</html>") == (None, None)
