"""Tests for file upload through tenant KB document ingestion pipeline.

TDD Task 3: Repair file upload by connecting UI flow to tenant KB document ingestion.
"""

import pytest
from io import BytesIO
from sqlalchemy import select
import database

# Mark as async tests
pytestmark = pytest.mark.asyncio


class TestFileUploadKbIngestion:
    """Test file upload connects to tenant KB document ingestion pipeline."""

    async def test_upload_files_creates_kb_document_records(self, client):
        """Test that file upload creates KbDocument records with pending status."""
        # Arrange: Get existing test agent via default_agent_id
        # The setup_test_db fixture creates a default agent
        from models import Agent, Tenant, KbDocument
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None, "Test agent should exist"

            # Create tenant for KB
            tenant = Tenant(name="test_tenant", slug="test_tenant")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            # Create KB for agent if not exists
            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id
            kb_id = kb.id

        # Act: Upload file via legacy endpoint
        test_file_content = b"This is test content for document processing."
        files = {"files": ("test_document.txt", BytesIO(test_file_content), "text/plain")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )

        # Assert: Response success
        assert response.status_code == 200, f"Upload failed: {response.text}"
        data = response.json()
        assert data["uploaded"] == 1
        assert data["failed"] == 0
        assert len(data["files"]) == 1

        # Assert: File item has proper KbDocument-like fields
        file_item = data["files"][0]
        assert file_item["filename"] == "test_document.txt"
        assert file_item["status"] == "pending"
        assert "id" in file_item

    async def test_upload_files_enforces_file_count_limit(self, client):
        """Test that file upload enforces max 5 files limit."""
        # Arrange
        from models import Agent, Tenant
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None

            tenant = Tenant(name="test_tenant3", slug="test_tenant3")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB 3",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id

        # Act: Try to upload 6 files (exceeds max 5)
        files = [
            ("files", (f"file{i}.txt", BytesIO(b"content"), "text/plain"))
            for i in range(6)
        ]

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )

        # Assert: Should reject excess files
        assert response.status_code == 400
        data = response.json()
        assert "max" in data.get("detail", "").lower() or "5" in data.get("detail", "")

    async def test_upload_files_rejects_unsupported_extensions(self, client):
        """Test that only supported extensions are accepted."""
        # Arrange
        from models import Agent, Tenant
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None

            tenant = Tenant(name="test_tenant4", slug="test_tenant4")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB 4",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id

        # Act: Try to upload unsupported file
        files = {"files": ("malware.exe", BytesIO(b"malicious content"), "application/octet-stream")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )

        # Assert: Should reject unsupported extension but return 200 with failed count
        assert response.status_code == 200
        data = response.json()
        assert data["failed"] == 1
        assert len(data["errors"]) == 1

    async def test_upload_files_without_kb_bound_creates_kb_first(self, client):
        """Test that uploading without kb_id creates KB and binds it automatically."""
        # Arrange: Create agent WITHOUT kb_id
        from models import Agent, Workspace

        async with database.AsyncSessionLocal() as session:
            # Get a workspace
            result = await session.execute(
                select(Workspace).limit(1)
            )
            workspace = result.scalar_one_or_none()
            assert workspace is not None

            agent = Agent(
                id="test_agent_no_kb_001",
                name="Test Agent No KB",
                workspace_id=workspace.id,
                kb_setup_completed=False,
            )
            # No kb_id bound
            session.add(agent)
            await session.commit()

            agent_id = agent.id

        # Act: Upload file
        test_content = b"Content for auto-KB creation test."
        files = {"files": ("test.txt", BytesIO(test_content), "text/plain")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )

        # Assert: Should succeed and create/bind KB
        assert response.status_code == 200
        data = response.json()
        assert data["uploaded"] == 1

        # Verify agent now has kb_id
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.id == agent_id)
            )
            updated_agent = result.scalar_one_or_none()
            assert updated_agent.kb_id is not None, "Agent should have kb_id after upload"

    async def test_upload_files_returns_kb_document_status(self, client):
        """Test that response includes KbDocument status."""
        # Arrange
        from models import Agent, Tenant
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None

            tenant = Tenant(name="test_tenant6", slug="test_tenant6")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB 6",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id

        # Act
        test_content = b"Status test content."
        files = {"files": ("status_test.pdf", BytesIO(test_content), "application/pdf")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )

        # Assert: Response should include proper file items with status
        assert response.status_code == 200
        data = response.json()
        assert "files" in data
        assert len(data["files"]) == 1
        file_item = data["files"][0]
        assert "status" in file_item
        # Status should reflect KbDocument status (pending/processing) not just KnowledgeFile
        assert file_item["status"] in ["pending", "processing"]

    async def test_file_list_exposes_processing_error_details(self, client):
        """When file processing fails, API should expose error_message.
        
        GAP: FileItem may not properly propagate KbDocument.error_message
        when processing fails.
        
        Expected: File with status='error'|'failed' should include error_message
        containing the KbDocument.error_message.
        """
        import uuid
        from io import BytesIO
        from models import Agent, Tenant, KbDocument
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None

            tenant = Tenant(name="test_tenant_error", slug="test_tenant_error")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB Error",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id

        # Upload a file
        test_content = b"Test content for error propagation"
        files = {"files": ("error_prop_test.txt", BytesIO(test_content), "text/plain")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )
        assert response.status_code == 200
        upload_data = response.json()
        file_id = upload_data["files"][0]["id"]

        # Simulate processing failure
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(KbDocument).where(KbDocument.id == file_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                object.__setattr__(doc, "status", "error")
                object.__setattr__(doc, "error_message", "Chunking failed: text too large")
                await session.commit()

        # Get file list
        response = await client.get(f"/api/v1/files:list?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()

        file_item = next((f for f in data["files"] if f["id"] == file_id), None)
        assert file_item is not None

        # File should show error status AND error_message
        if file_item.get("status") in ["failed", "error"]:
            assert "error_message" in file_item, (
                "GAP: FileItem with failed/error status must include error_message field"
            )
            assert file_item["error_message"] == "Chunking failed: text too large", (
                "GAP: error_message should contain KbDocument.error_message"
            )
        else:
            pytest.fail(
                f"GAP: File status '{file_item.get('status')}' does not reflect "
                f"KbDocument status 'error'. File list should expose processing errors."
            )

    async def test_file_list_shows_explicit_processing_state(self, client):
        """File list should show explicit processing state vs pending vs ready.
        
        GAP: File status may not accurately reflect KbDocument processing state.
        
        Expected: FileItem.status should be one of:
        - 'pending' = uploaded, waiting to process
        - 'processing' = currently being chunked/embed/upsert
        - 'ready' = successfully indexed
        - 'error' = processing failed
        """
        import uuid
        from io import BytesIO
        from models import Agent, Tenant, KbDocument
        from services.kb_service import KbService

        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(Agent).where(Agent.is_active == True).limit(1)
            )
            agent = result.scalar_one_or_none()
            assert agent is not None

            tenant = Tenant(name="test_tenant_state", slug="test_tenant_state")
            session.add(tenant)
            await session.flush()
            tenant_id = str(tenant.id)

            kb_svc = KbService(session=session)
            kb = await kb_svc.create_knowledge_base(
                tenant_id=tenant_id,
                name="Test KB State",
            )
            agent.kb_id = kb.id
            await session.commit()

            agent_id = agent.id

        # Upload a file
        test_content = b"Test content for state tracking"
        files = {"files": ("state_test.txt", BytesIO(test_content), "text/plain")}

        response = await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files=files,
        )
        assert response.status_code == 200
        upload_data = response.json()
        file_id = upload_data["files"][0]["id"]

        # Set to processing state
        async with database.AsyncSessionLocal() as session:
            result = await session.execute(
                select(KbDocument).where(KbDocument.id == file_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                object.__setattr__(doc, "status", "processing")
                await session.commit()

        # Get file list
        response = await client.get(f"/api/v1/files:list?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()

        file_item = next((f for f in data["files"] if f["id"] == file_id), None)
        assert file_item is not None

        # File status should reflect KbDocument status
        expected_statuses = ["pending", "processing", "ready", "error"]
        if file_item.get("status") not in expected_statuses:
            pytest.fail(
                f"GAP: File status '{file_item.get('status')}' is not in expected "
                f"processing states {expected_statuses}. File list should expose "
                f"accurate KB processing state."
            )
