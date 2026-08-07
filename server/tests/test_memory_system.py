import asyncio
import os
import sys
import shutil
import unittest
import json
from unittest.mock import AsyncMock, patch

# Ensure server folder is in sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import init_db, list_memory_entries, get_memory_entry
from memory import memory_engine, cosine_similarity

class TestMemorySystem(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Initialize database
        init_db()
        # Set clean test workspace path
        self.test_vault_id = "test-vault-uuid-123"
        self.test_dir = os.path.expanduser("~/.vaultagent")
        
    def tearDown(self):
        # Clean up test directories if needed
        pass

    def test_cosine_similarity(self):
        v1 = [1.0, 0.0, 0.0]
        v2 = [1.0, 0.0, 0.0]
        v3 = [0.0, 1.0, 0.0]
        self.assertAlmostEqual(cosine_similarity(v1, v2), 1.0)
        self.assertAlmostEqual(cosine_similarity(v1, v3), 0.0)

    async def test_embedding_fallback(self):
        # Empty key should return 768-dim zero vector fallback
        vec = await memory_engine.get_embedding("test text", gemini_key=None)
        self.assertEqual(len(vec), 768)
        self.assertTrue(all(val == 0.0 for val in vec))

    async def test_remember_and_retrieve(self):
        # Mock embedding API
        mock_vector = [0.1] * 768
        mock_vector[0] = 0.9 # Make it unique
        
        with patch.object(memory_engine, 'get_embedding', return_value=mock_vector):
            content = "The user prefers TypeScript for building backend systems."
            entry_id = await memory_engine.remember(
                content=content,
                scope="vault",
                vault_id=self.test_vault_id,
                gemini_key="mock-key",
                memory_type="Preference",
                status="confirmed"
            )
            
            # 1. Verify in database
            db_entry = get_memory_entry(entry_id)
            self.assertIsNotNone(db_entry)
            self.assertEqual(db_entry["content"], content)
            self.assertEqual(db_entry["scope"], "vault")
            self.assertEqual(db_entry["status"], "confirmed")
            
            # 2. Verify vector retrieval
            results = await memory_engine.proactive_context(
                prompt="typescript backend preference",
                scope="vault",
                vault_id=self.test_vault_id,
                gemini_key="mock-key",
                semantic_threshold=0.5
            )
            self.assertTrue(len(results) > 0)
            self.assertEqual(results[0], content)

    async def test_contradiction_handling(self):
        # Mock embedding similarity and LLM contradiction check
        mock_vec_1 = [0.2] * 768

        with patch.object(memory_engine, 'get_embedding', return_value=mock_vec_1):
            # Save first memory
            id1 = await memory_engine.remember(
                content="Likes light theme",
                scope="vault",
                vault_id=self.test_vault_id,
                gemini_key="mock-key",
                memory_type="Preference",
                status="confirmed"
            )

            # Trigger duplicate contradiction check with a mock CONTRADICT output
            with patch.object(memory_engine, '_verify_fact_with_llm', return_value=f"CONTRADICT {id1}"):
                await memory_engine._handle_duplicate_or_contradiction(
                    content="Likes dark theme",
                    scope="vault",
                    vault_id=self.test_vault_id,
                    gemini_key="mock-key",
                    openrouter_key="mock-key",
                    memory_type="Preference"
                )

                # Verify first memory was marked dismissed
                entry1 = get_memory_entry(id1)
                self.assertEqual(entry1["status"], "dismissed")

                # Verify second memory is now pending in database
                entries = list_memory_entries(scope="vault", vault_id=self.test_vault_id, status="pending")
                has_dark_theme = any("dark theme" in e["content"] for e in entries)
                self.assertTrue(has_dark_theme)

    async def test_extract_facts_default_scope(self):
        mock_response = json.dumps([
            {
                "content": "Likes custom build configuration",
                "scope": "invalid-scope",
                "memory_type": "Preference",
                "confidence": 0.85
            }
        ])
        
        from unittest.mock import MagicMock
        mock_res_obj = MagicMock()
        mock_res_obj.status_code = 200
        mock_res_obj.json.return_value = {
            "choices": [{"message": {"content": mock_response}}]
        }
        
        async def mock_post(*args, **kwargs):
            return mock_res_obj
            
        with patch('httpx.AsyncClient.post', new=mock_post):
            await memory_engine.extract_and_gate_facts(
                note_content="Likes custom build configuration",
                vault_id=self.test_vault_id,
                keys={"x-openrouter-key": "mock-key"}
            )
            
            entries = list_memory_entries(vault_id=self.test_vault_id)
            matching = [e for e in entries if "custom build" in e["content"]]
            self.assertTrue(len(matching) > 0)
            self.assertEqual(matching[0]["scope"], "vault")

if __name__ == "__main__":
    unittest.main()
