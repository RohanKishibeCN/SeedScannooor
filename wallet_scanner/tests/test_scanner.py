import json
import os
import re
import sys
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scanner.filter import calculate_total_usd, should_keep
from scanner.mnemonic import derive_addresses, load_mnemonics
from scanner.output import aggregate_results, get_timestamp, write_json_output

try:
    from scanner.evm import scan_evm_addresses
    HAS_EVM = True
except ImportError:
    HAS_EVM = False

try:
    from scanner.solana import get_sol_balance
    HAS_SOLANA = True
except ImportError:
    HAS_SOLANA = False


class TestMnemonicDerivation:
    TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"

    def test_derive_addresses_returns_all_chains(self):
        result = derive_addresses(self.TEST_MNEMONIC, depth=3)
        assert set(result.keys()) == {"ethereum", "bsc", "polygon", "arbitrum", "base", "solana"}
        for chain, addresses in result.items():
            assert len(addresses) == 3

    def test_load_mnemonics_file_not_found(self):
        result = load_mnemonics("/nonexistent/path/mnemonics.txt")
        assert result == []

    def test_invalid_mnemonic_skipped(self):
        result = derive_addresses("invalid mnemonic word", depth=2)
        for chain in result.values():
            assert chain == []


class TestFilterThreshold:
    def test_threshold_9_99_rejected(self):
        assert should_keep(9.99, 10.0) is False

    def test_threshold_10_00_accepted(self):
        assert should_keep(10.00, 10.0) is True

    def test_threshold_10_01_accepted(self):
        assert should_keep(10.01, 10.0) is True

    def test_threshold_0_rejected(self):
        assert should_keep(0.0, 10.0) is False


class TestCalculateTotalUSD:
    def test_calculate_with_prices(self):
        addresses = [
            {"eth": {"ETH": 1.0}, "sol": {"SOL": 0.0, "USDT": 100.0, "USDC": 0.0}},
            {"eth": {"ETH": 0.0}, "sol": {"SOL": 0.0, "USDT": 0.0, "USDC": 50.0}},
        ]
        prices = {"ethereum": 3000.0, "tether": 1.0, "usd-coin": 1.0}
        total = calculate_total_usd(addresses, prices)
        assert total == 3150.0


class TestOutputFormat:
    def test_aggregate_results_format(self):
        all_addresses = {
            "ethereum": [
                {"address": "0x1234567890abcdef", "native_balance": 1.5, "usdt": 100.0, "usdc": 50.0}
            ],
            "solana": [
                {"address": "Sol1234567890abcdef", "sol": 2.0, "usdt": 0.0, "usdc": 25.0}
            ],
        }
        result = aggregate_results(all_addresses, mnemonic_index=1, snapshot_time="2024-01-01T00:00:00Z")
        assert "mnemonic_index" in result
        assert "addresses" in result
        assert "total_usd_value" in result
        assert "snapshot_time" in result
        mnemonic_words = ["abandon", "about", "abroad", "abuse", "absent", "absorb", "abstract"]
        for addr in result["addresses"]:
            addr_str = json.dumps(addr)
            for word in mnemonic_words:
                assert word not in addr_str.lower()

    def test_timestamp_format(self):
        timestamp = get_timestamp()
        pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$"
        assert re.match(pattern, timestamp)
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        assert dt.tzinfo == timezone.utc


class TestSecurity:
    MNEMONIC_WORDS = ["abandon", "about", "abroad", "abuse", "absent", "absorb", "abstract", "absurd", "abuse", "accident", "account", "accuse", "achieve", "acid", "acoustic", "acquire", "across", "act", "action", "actor", "actress"]

    def test_no_mnemonic_in_output(self):
        result = derive_addresses(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            depth=2
        )
        output_str = json.dumps(result)
        for word in self.MNEMONIC_WORDS:
            assert word not in output_str.lower()


@pytest.mark.skipif(not HAS_EVM, reason="EVM module not available")
class TestEVMMock:
    @pytest.mark.asyncio
    async def test_scan_evm_addresses_handles_rpc_error(self):
        mock_session = AsyncMock()
        mock_response = MagicMock()
        mock_response.status = 500
        mock_session.post.return_value.__aenter__.return_value = mock_response

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await scan_evm_addresses(
                rpc_url="http://invalid-rpc.example.com",
                addresses=["0x1234567890123456789012345678901234567890"],
                token_contracts={},
            )
        assert len(result) == 1
        assert result[0]["address"] == "0x1234567890123456789012345678901234567890"


@pytest.mark.skipif(not HAS_SOLANA, reason="Solana module not available")
class TestSolanaMock:
    @pytest.mark.asyncio
    async def test_get_sol_balance_handles_error(self):
        mock_session = AsyncMock()
        mock_response = MagicMock()
        mock_response.status = 500
        mock_session.post.return_value.__aenter__.return_value = mock_response

        with patch("aiohttp.ClientSession", return_value=mock_session):
            result = await get_sol_balance("http://invalid-rpc.example.com", "Sol1234567890")
        assert result == 0.0
