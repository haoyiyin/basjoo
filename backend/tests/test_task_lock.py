import asyncio

import pytest

from services.task_lock import TaskLock, TaskType


@pytest.mark.asyncio
async def test_cancel_tasks_cancels_registered_task_before_acquire():
    lock = TaskLock()
    agent_id = "agent_pending"
    task_id = "crawl_pending"

    async def pending_task():
        await asyncio.sleep(10)

    task = asyncio.create_task(pending_task())
    await lock.register_task_handle(agent_id, task_id, task)

    cancelled = await lock.cancel_tasks(agent_id, {TaskType.URL_CRAWL})

    assert cancelled == [task_id]
    assert task.cancelled() or task.cancelling()

    with pytest.raises(asyncio.CancelledError):
        await task

    await lock.release_task(agent_id, task_id)
    assert lock.get_registered_task_ids(agent_id) == set()


@pytest.mark.asyncio
async def test_delete_task_blocks_rebuild_and_new_fetches():
    lock = TaskLock()
    agent_id = "agent_delete"

    acquired, error = await lock.acquire_task(agent_id, TaskType.URL_DELETE, "delete_1")
    assert acquired, error

    rebuild_acquired, rebuild_error = await lock.acquire_task(
        agent_id,
        TaskType.INDEX_REBUILD,
        "rebuild_1",
    )
    fetch_acquired, fetch_error = await lock.acquire_task(
        agent_id,
        TaskType.URL_FETCH,
        "fetch_1",
    )

    assert rebuild_acquired is False
    assert "delete_1" in rebuild_error
    assert fetch_acquired is False
    assert "delete_1" in fetch_error

    await lock.release_task(agent_id, "delete_1")


@pytest.mark.asyncio
async def test_delete_task_can_start_while_fetch_is_active_for_cancellation():
    lock = TaskLock()
    agent_id = "agent_fetch_then_delete"

    fetch_acquired, fetch_error = await lock.acquire_task(agent_id, TaskType.URL_FETCH, "fetch_1")
    assert fetch_acquired, fetch_error

    delete_acquired, delete_error = await lock.acquire_task(agent_id, TaskType.URL_DELETE, "delete_1")

    assert delete_acquired, delete_error

    await lock.release_task(agent_id, "delete_1")
    await lock.release_task(agent_id, "fetch_1")
