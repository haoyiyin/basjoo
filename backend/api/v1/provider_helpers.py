"""Shared provider-aware helpers for R2R client resolution."""

from models import Agent
from services.r2r_client import R2RClient


def get_agent_r2r_client(agent: Agent) -> R2RClient:
    """Create an R2RClient for the agent."""
    return R2RClient()
