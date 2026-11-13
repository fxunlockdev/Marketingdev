# -*- coding: utf-8 -*-
"""Desvio's Agent Reach channel registry: only the login-free channels exist in this image.

Replaces agent_reach/channels/__init__.py at build time. The modules of every channel that needs a
login, browser cookies or a key are deleted from the image, so they cannot be added or enabled.
"""

from typing import List, Optional

from .base import Channel
from .web import WebChannel
from .youtube import YouTubeChannel

ALL_CHANNELS: List[Channel] = [YouTubeChannel(), WebChannel()]


def get_channel(name: str) -> Optional[Channel]:
    """Get a channel by name."""
    for ch in ALL_CHANNELS:
        if ch.name == name:
            return ch
    return None


def get_all_channels() -> List[Channel]:
    """Get all registered channels."""
    return ALL_CHANNELS


__all__ = ["Channel", "ALL_CHANNELS", "get_channel", "get_all_channels"]
