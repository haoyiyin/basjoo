"""Issue #43 / contract C6 — business hours resolved with `zoneinfo`.

`agent.business_hours` is `{"timezone": IANA, "schedule": [{"day": 0..6,
"start": minutes, "end": minutes}]}`, day 0 = Monday, `end <= start` wraps past
midnight. No config / unparsable config = always online (today's behaviour).

The DST assertion is the interesting one: `Asia/Shanghai` has no DST, so it
cannot distinguish "zoneinfo" from "a fixed +08:00 offset". The test therefore
uses `Europe/London` around a real transition and asserts on the *local wall
clock hour*, which a fixed offset would get wrong by an hour.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from services.business_hours import (
    config_payload,
    is_online,
    next_transition,
)


def make_agent(business_hours=None, away_message=None):
    """A duck-typed stand-in: the service only reads these two attributes."""
    return SimpleNamespace(business_hours=business_hours, away_message=away_message)


def shanghai(schedule):
    return make_agent({"timezone": "Asia/Shanghai", "schedule": schedule})


def at(year, month, day, hour, minute=0, tz="UTC"):
    """An aware instant, written in the zone that makes the test readable."""
    return datetime(year, month, day, hour, minute, tzinfo=ZoneInfo(tz))


# ------------------------------------------------- 7. no timezone → online


def test_no_business_hours_is_always_online():
    """Assertion 7: no config at all keeps today's behaviour."""
    assert is_online(make_agent(None)) is True
    assert is_online(make_agent({})) is True
    assert next_transition(make_agent(None)) is None
    assert config_payload(make_agent(None)) is None

    # Any moment of any day is online.
    for hour in (0, 6, 12, 23):
        moment = at(2024, 3, 4, hour)
        assert is_online(make_agent(None), moment) is True


def test_unparsable_config_is_treated_as_always_online(caplog):
    """Contract C6: anything unparsable = no hours = always online."""
    bad_configs = [
        {"timezone": "Not/AZone", "schedule": [{"day": 0, "start": 0, "end": 60}]},
        {"schedule": [{"day": 0, "start": 0, "end": 60}]},  # no timezone
        {"timezone": "Asia/Shanghai", "schedule": "not-a-list"},
        {"timezone": "Asia/Shanghai", "schedule": [{"day": 9, "start": 0, "end": 60}]},
        {"timezone": "Asia/Shanghai", "schedule": [{"start": 0, "end": 60}]},
        {"timezone": "Asia/Shanghai", "schedule": []},
        "not-an-object",
    ]

    for config in bad_configs:
        agent = make_agent(config)
        with caplog.at_level("WARNING"):
            assert is_online(agent, at(2024, 3, 4, 3)) is True, config
        assert next_transition(agent) is None, config


# ------------------------------------- 5. the boundary and wrapping ranges


def test_crossing_the_closing_time_flips_online_and_next_transition_is_the_boundary():
    """Assertion 5a: 09:00–18:00 — online before the close, offline after."""
    # Monday 2024-03-04. 540 min = 09:00, 1080 min = 18:00 Shanghai time.
    agent = shanghai([{"day": 0, "start": 540, "end": 1080}])

    before_close = at(2024, 3, 4, 17, 59, tz="Asia/Shanghai")
    after_close = at(2024, 3, 4, 18, 1, tz="Asia/Shanghai")

    assert is_online(agent, before_close) is True
    assert is_online(agent, after_close) is False

    transition = next_transition(agent, before_close)
    assert transition is not None
    assert transition.hour == 18 and transition.minute == 0, (
        "the next flip is the configured closing time"
    )
    assert transition.date() == before_close.date()


def test_a_wrapping_range_covers_both_sides_of_midnight():
    """Assertion 5b: 22:00→02:00 is online at 23:30 and 01:30, offline at 03:00."""
    agent = shanghai([{"day": 0, "start": 22 * 60, "end": 2 * 60}])

    # Monday 23:30 — inside the range that opened Monday.
    assert is_online(agent, at(2024, 3, 4, 23, 30, tz="Asia/Shanghai")) is True
    # Tuesday 01:30 — still inside the same range, past midnight.
    assert is_online(agent, at(2024, 3, 5, 1, 30, tz="Asia/Shanghai")) is True
    # Tuesday 03:00 — the range closed at 02:00.
    assert is_online(agent, at(2024, 3, 5, 3, 0, tz="Asia/Shanghai")) is False

    # And the boundary the widget would flip at is 02:00 local.
    transition = next_transition(agent, at(2024, 3, 4, 23, 30, tz="Asia/Shanghai"))
    assert transition is not None
    assert transition.hour == 2 and transition.minute == 0
    assert transition.date().isoformat() == "2024-03-05"


def test_two_ranges_on_one_day_are_both_honoured():
    """Lunch break: 09:00–12:00 and 13:00–18:00 on Monday."""
    agent = shanghai(
        [
            {"day": 0, "start": 9 * 60, "end": 12 * 60},
            {"day": 0, "start": 13 * 60, "end": 18 * 60},
        ]
    )

    assert is_online(agent, at(2024, 3, 4, 11, 0, tz="Asia/Shanghai")) is True
    assert is_online(agent, at(2024, 3, 4, 12, 30, tz="Asia/Shanghai")) is False
    assert is_online(agent, at(2024, 3, 4, 14, 0, tz="Asia/Shanghai")) is True

    transition = next_transition(agent, at(2024, 3, 4, 11, 0, tz="Asia/Shanghai"))
    assert transition is not None and transition.hour == 12


def test_day_zero_is_monday():
    """`day` 0 must mean Monday (Python `weekday()`), not Sunday."""
    monday_only = shanghai([{"day": 0, "start": 9 * 60, "end": 18 * 60}])

    assert at(2024, 3, 4, 12, tz="Asia/Shanghai").weekday() == 0  # a Monday
    assert is_online(monday_only, at(2024, 3, 4, 12, tz="Asia/Shanghai")) is True
    # Tuesday 12:00 is outside a Monday-only schedule.
    assert is_online(monday_only, at(2024, 3, 5, 12, tz="Asia/Shanghai")) is False


def test_naive_datetimes_are_read_as_utc():
    """SQLite drops the offset; the codebase's convention is that it was UTC."""
    agent = shanghai([{"day": 0, "start": 9 * 60, "end": 18 * 60}])
    # 2024-03-04 04:00 UTC == 12:00 Shanghai → inside the range.
    assert is_online(agent, datetime(2024, 3, 4, 4, 0)) is True
    # 2024-03-04 12:00 UTC == 20:00 Shanghai → outside.
    assert is_online(agent, datetime(2024, 3, 4, 12, 0)) is False


# ------------------------------------------------------- 6. DST via zoneinfo


def test_dst_transition_uses_the_local_wall_clock_not_a_fixed_offset():
    """Assertion 6: `Europe/London` around the 2024-03-31 spring forward.

    London is UTC+00:00 before the transition and UTC+01:00 after. A schedule of
    09:00–17:00 local therefore has a different *UTC* shape on each side; a fixed
    offset would place the 09:00 boundary at the wrong instant.
    """
    london = make_agent(
        {
            "timezone": "Europe/London",
            "schedule": [
                {"day": 5, "start": 540, "end": 1020},  # Saturday 09:00–17:00
                {"day": 6, "start": 540, "end": 1020},  # Sunday   09:00–17:00
            ],
        }
    )

    # Saturday 2024-03-30 (before the clocks go forward), 09:00 local == 09:00Z.
    before_dst = at(2024, 3, 30, 9, 0, tz="Europe/London")
    assert before_dst.utcoffset() == timedelta(0)
    assert is_online(london, before_dst) is True

    # Sunday 2024-03-31 (after), 09:00 local == 08:00Z because the offset is +01:00.
    after_dst = at(2024, 3, 31, 9, 0, tz="Europe/London")
    assert after_dst.utcoffset() == timedelta(hours=1)
    assert is_online(london, after_dst) is True

    # The same *UTC* instant that was inside the window on Saturday is outside on
    # Sunday: 09:00Z == 10:00 local after the change, which is still inside — so
    # use the closing edge instead: 16:00Z is 17:00 local (closed) on Sunday but
    # 16:00 local (open) on Saturday.
    saturday_1600z = datetime(2024, 3, 30, 16, 0, tzinfo=timezone.utc)
    sunday_1600z = datetime(2024, 3, 31, 16, 0, tzinfo=timezone.utc)
    assert is_online(london, saturday_1600z) is True
    assert is_online(london, sunday_1600z) is False, (
        "after the DST change 16:00Z is 17:00 local, past the closing time; a "
        "fixed UTC offset would still report open here"
    )

    # `next_transition` reports the local wall-clock hour, which is what the
    # operator configured, on both sides of the transition.
    saturday_close = next_transition(london, at(2024, 3, 30, 12, 0, tz="Europe/London"))
    sunday_close = next_transition(london, at(2024, 3, 31, 12, 0, tz="Europe/London"))
    assert saturday_close is not None and saturday_close.hour == 17
    assert sunday_close is not None and sunday_close.hour == 17
    assert saturday_close.utcoffset() == timedelta(0)
    assert sunday_close.utcoffset() == timedelta(hours=1), (
        "the closing instant carries the post-transition offset"
    )


def test_zoneinfo_is_what_resolves_the_timezone():
    """Guard: the module resolves names through `zoneinfo`, not a table."""
    import services.business_hours as module

    source = open(module.__file__, encoding="utf-8").read()
    assert "ZoneInfo(" in source
    assert "timezone(timedelta(hours=" not in source, "no fixed-offset arithmetic"
