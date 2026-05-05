"""资源限制加固模块。

提供内存监控、CPU 节流、并发控制等资源管理功能，
用于在钱包扫描过程中防止资源耗尽。
"""

import asyncio
import functools
import logging
import os
import resource
import sys
import time
from typing import Optional

logger = logging.getLogger(__name__)


def get_memory_usage_mb() -> float:
    """返回当前进程内存使用量（MB）"""
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return usage.ru_maxrss / 1024


def check_memory_limit(limit_mb: float = 500) -> bool:
    """检查是否超过内存限制，返回 True 表示超限"""
    return get_memory_usage_mb() > limit_mb


class CPUSmoother:
    """平滑 CPU 使用，避免突发峰值"""

    def __init__(self, interval_ms: int = 100):
        self.interval: float = interval_ms / 1000.0

    def throttle(self) -> None:
        """每次 RPC 请求后调用，降低 CPU 峰值"""
        time.sleep(self.interval)


class ConcurrencyGuard:
    """确保不超过最大并发数"""

    def __init__(self, max_concurrent: int = 10):
        self.semaphore: asyncio.Semaphore = asyncio.Semaphore(max_concurrent)

    async def __aenter__(self) -> "ConcurrencyGuard":
        await self.semaphore.acquire()
        return self

    async def __aexit__(self, *args: object) -> None:
        self.semaphore.release()


def monitor_resources(max_memory_mb: float = 500):
    """装饰器：定期检查内存使用，超过限制时记录警告"""

    def decorator(func: callable) -> callable:
        @functools.wraps(func)
        async def wrapper(*args: any, **kwargs: any) -> any:
            if check_memory_limit(max_memory_mb):
                logger.warning(f"Memory usage exceeds {max_memory_mb}MB limit!")
            return await func(*args, **kwargs)

        return wrapper

    return decorator


def set_low_priority() -> None:
    """降低进程调度优先级（仅在 Linux 上有效）"""
    try:
        os.nice(5)
    except (PermissionError, OSError):
        pass
