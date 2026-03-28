from models import normalize_url, compute_content_hash


def test_normalize_url_trailing_slash():
    assert normalize_url("https://example.com/") == "https://example.com"


def test_normalize_url_www():
    assert normalize_url("https://www.example.com") == "https://example.com"
    assert normalize_url("http://www.example.com") == "http://example.com"


def test_normalize_url_case():
    assert normalize_url("HTTPS://EXAMPLE.COM") == "https://example.com"


def test_normalize_url_whitespace():
    assert normalize_url("  https://example.com  ") == "https://example.com"


def test_compute_content_hash():
    content = "Hello, World!"
    hash1 = compute_content_hash(content)
    hash2 = compute_content_hash(content)

    assert hash1 == hash2
    assert len(hash1) == 64


def test_compute_content_hash_different():
    hash1 = compute_content_hash("Hello")
    hash2 = compute_content_hash("World")

    assert hash1 != hash2
