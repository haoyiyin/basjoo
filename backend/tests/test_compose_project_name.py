"""The compose project name must be pinned in the file, not derived from $PWD.

`docker compose` defaults the project name to the checkout directory. Run the
same file from a second checkout — a git worktree, a release tarball — and its
volumes get that prefix instead (`basjoo-ui_backend-data`), which means a fresh
empty database and an instance that looks like it lost its admin accounts.

`name:` is the only thing that prevents that, so deleting it is a regression
even though nothing in the app imports it.
"""

from pathlib import Path

import yaml

COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.yml"
EXPECTED = "basjoo"


def test_compose_pins_the_project_name():
    config = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    assert config.get("name") == EXPECTED, (
        "docker-compose.yml must pin `name:`. Without it compose derives the "
        "project from the directory, so a second checkout silently starts on an "
        "empty set of volumes."
    )


def test_named_volumes_are_plain_so_compose_prefixes_them_consistently():
    """Volume keys stay unprefixed; the pinned project name supplies the prefix."""
    config = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    volumes = config.get("volumes") or {}
    assert "backend-data" in volumes
    for key, spec in volumes.items():
        external = (spec or {}).get("name") if spec else None
        assert external is None, (
            f"volume {key!r} hard-codes name={external!r}; the project prefix is "
            "what keeps an existing stack's data attached, so leave it implicit."
        )
