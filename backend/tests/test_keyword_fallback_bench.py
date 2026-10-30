"""Issue #60 — the keyword matcher's latency budget.

1000 pairs against a 200-character message must stay under 20 ms on this box,
measured with `time.perf_counter` (pytest-benchmark is not installed, and adding
a dependency for one number is not worth it).

Best-of-N, not mean: the assertion is about what the matcher *costs*, not about
whatever the CI machine happened to be doing during one unlucky iteration. A
GC pause or a noisy neighbour must not fail a correctness suite; a genuine
algorithmic regression (an O(n·m) scan creeping in) moves every iteration and
still fails. The measured number is printed either way.
"""

import time

from services.keyword_fallback import match

PAIR_COUNT = 1000
MESSAGE_LENGTH = 200
ITERATIONS = 25
BUDGET_SECONDS = 0.020

# A realistic worst case: no pair matches, so every pair's every keyword is
# examined and none short-circuits. A matching message would exit earlier.
_BASE = (
    "请问我的订单什么时候发货我需要查询物流进度并且申请发票"
    "另外还想了解一下会员积分规则和售后联系方式谢谢"
)
# Padded to exactly 200 characters: a real visitor message with punctuation and
# mixed scripts, not 200 copies of one letter.
MESSAGE = (_BASE * 6)[:MESSAGE_LENGTH]
assert len(MESSAGE) == MESSAGE_LENGTH

def _fake_pairs() -> list[dict]:
    """1000 plain dicts — no DB, no ORM, no session. `match()` takes either."""
    pairs = []
    for index in range(PAIR_COUNT):
        pairs.append(
            {
                "id": f"qa_{index:04d}",
                "question": f"问题 {index}",
                "answer": f"答案 {index}",
                # Four keywords per pair, ~2–6 characters, none in MESSAGE.
                "keywords": [
                    f"关键词{index}",
                    f"keyword{index}",
                    f"术语{index}",
                    f"term{index}",
                ],
                "hits": index % 7,
                "enabled": True,
            }
        )
    return pairs

def test_bench_1000_pairs_200_chars_under_20ms(capsys):
    pairs = _fake_pairs()

    # Warm-up: the first call pays for module-level regex compilation and any
    # lazy code-path setup that a long-running process has already amortised.
    assert match(pairs, MESSAGE) is None

    durations: list[float] = []
    for _ in range(ITERATIONS):
        start = time.perf_counter()
        hit = match(pairs, MESSAGE)
        durations.append(time.perf_counter() - start)
        assert hit is None

    best = min(durations)
    mean = sum(durations) / len(durations)
    with capsys.disabled():
        print(
            f"\n[BENCH] {PAIR_COUNT} pairs x {MESSAGE_LENGTH} chars, "
            f"{ITERATIONS} iters: best={best * 1000:.2f} ms "
            f"mean={mean * 1000:.2f} ms budget={BUDGET_SECONDS * 1000:.0f} ms"
        )

    assert best < BUDGET_SECONDS, (
        f"keyword match over {PAIR_COUNT} pairs took {best * 1000:.2f} ms "
        f"(budget {BUDGET_SECONDS * 1000:.0f} ms)"
    )

def test_bench_a_matching_message_is_not_slower_than_a_miss(capsys):
    """A successful match must not be the slow path (it returns on the hit)."""
    pairs = _fake_pairs()
    # Make the LAST pair match, so the whole list is still scanned.
    pairs[-1]["keywords"] = ["关键词999", "订单什么时候发货"]
    assert match(pairs, MESSAGE) is not None

    durations: list[float] = []
    for _ in range(ITERATIONS):
        start = time.perf_counter()
        match(pairs, MESSAGE)
        durations.append(time.perf_counter() - start)

    best = min(durations)
    with capsys.disabled():
        print(f"\n[BENCH] matching hit: best={best * 1000:.2f} ms")
    assert best < BUDGET_SECONDS
