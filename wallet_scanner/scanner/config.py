"""Configuration loader for wallet scanner.

Loads settings from environment variables (.env files) and YAML config,
with support for runtime overrides via dataclass fields.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv


EVM_CHAIN_ENV_MAP: dict[str, str] = {
    "ethereum": "ALCHEMY_ETH_RPC_URL",
    "bsc": "ALCHEMY_BSC_RPC_URL",
    "polygon": "ALCHEMY_POLYGON_RPC_URL",
    "arbitrum": "ALCHEMY_ARB_RPC_URL",
    "base": "ALCHEMY_BASE_RPC_URL",
}

SOLANA_RPC_ENV_KEY = "HELIUS_RPC_URL"

NOTION_API_KEY_ENV = "NOTION_API_KEY"
NOTION_DATABASE_ID_ENV = "NOTION_DATABASE_ID"

DEFAULT_CHAINS = ["ethereum", "bsc", "polygon", "arbitrum", "base", "solana"]
DEFAULT_DEPTH = 20
DEFAULT_OUTPUT_DIR = "./results"
DEFAULT_THRESHOLD_USD = 10.0
DEFAULT_MAX_CONCURRENT = 10
DEFAULT_SCAN_INTERVAL_MS = 100


@dataclass
class Config:
    """Wallet scanner configuration container.

    Attributes:
        evm_rpc_urls: Mapping from EVM chain name to RPC endpoint URL.
        solana_rpc_url: Solana network RPC endpoint URL.
        notion_api_key: Notion integration API key.
        notion_database_id: Notion database ID for results storage.
        chains: List of chain identifiers to scan.
        depth: Number of derived addresses per mnemonic.
        output_dir: Directory path for saving scan results.
        threshold_usd: Minimum USD value threshold for reporting.
        max_concurrent: Maximum concurrent RPC requests.
        scan_interval_ms: Milliseconds to wait between requests.
    """

    evm_rpc_urls: dict[str, str]
    solana_rpc_url: str
    notion_api_key: str
    notion_database_id: str
    chains: list[str] = field(default_factory=lambda: DEFAULT_CHAINS.copy())
    depth: int = DEFAULT_DEPTH
    output_dir: str = DEFAULT_OUTPUT_DIR
    threshold_usd: float = DEFAULT_THRESHOLD_USD
    max_concurrent: int = DEFAULT_MAX_CONCURRENT
    scan_interval_ms: int = DEFAULT_SCAN_INTERVAL_MS


def _find_config_yaml() -> Path | None:
    """Search for config.yaml in project root and current working directory.

    Returns:
        Path to config.yaml if found, otherwise None.
    """
    candidates = [
        Path(__file__).parent.parent / "config.yaml",
        Path.cwd() / "config.yaml",
    ]
    for path in candidates:
        if path.exists():
            return path
    return None


def _load_yaml_config() -> dict[str, Any]:
    """Load and parse config.yaml if present.

    Returns:
        Parsed YAML content as dictionary, empty dict if file not found.

    Raises:
        ValueError: If config.yaml exists but cannot be parsed.
    """
    yaml_path = _find_config_yaml()
    if yaml_path is None:
        return {}

    try:
        with open(yaml_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"Failed to parse config.yaml: {e}")
    except OSError as e:
        raise ValueError(f"Failed to read config.yaml: {e}")


def _load_evm_rpc_urls() -> dict[str, str]:
    """Extract EVM chain RPC URLs from environment variables.

    Returns:
        Dictionary mapping chain names to RPC URLs.

    Raises:
        ValueError: If required RPC URL environment variable is missing.
    """
    urls: dict[str, str] = {}

    for chain, env_key in EVM_CHAIN_ENV_MAP.items():
        value = os.environ.get(env_key)
        if not value:
            raise ValueError(
                f"Missing required environment variable: {env_key} "
                f"(for chain: {chain})"
            )
        urls[chain] = value

    return urls


def _load_solana_rpc_url() -> str:
    """Extract Solana RPC URL from environment variables.

    Returns:
        Solana RPC endpoint URL.

    Raises:
        ValueError: If required RPC URL environment variable is missing.
    """
    value = os.environ.get(SOLANA_RPC_ENV_KEY)
    if not value:
        raise ValueError(
            f"Missing required environment variable: {SOLANA_RPC_ENV_KEY} "
            f"(for Solana RPC)"
        )
    return value


def _load_notion_credentials() -> tuple[str, str]:
    """Extract Notion API credentials from environment variables.

    Returns:
        Tuple of (api_key, database_id).

    Raises:
        ValueError: If required Notion environment variables are missing.
    """
    api_key = os.environ.get(NOTION_API_KEY_ENV)
    if not api_key:
        raise ValueError(
            f"Missing required environment variable: {NOTION_API_KEY_ENV}"
        )

    database_id = os.environ.get(NOTION_DATABASE_ID_ENV)
    if not database_id:
        raise ValueError(
            f"Missing required environment variable: {NOTION_DATABASE_ID_ENV}"
        )

    return api_key, database_id


def _resolve_override[T](
    yaml_value: T | None,
    cli_value: T | None,
    default: T,
) -> T:
    """Resolve configuration value with precedence: CLI > YAML > default.

    Args:
        yaml_value: Value loaded from config.yaml.
        cli_value: Value passed via CLI argument (may be None).
        default: Default value if neither override is provided.

    Returns:
        Resolved configuration value.
    """
    if cli_value is not None:
        return cli_value
    if yaml_value is not None:
        return yaml_value
    return default


def load_config(
    chains: list[str] | None = None,
    depth: int | None = None,
    output_dir: str | None = None,
    threshold_usd: float | None = None,
    max_concurrent: int | None = None,
    scan_interval_ms: int | None = None,
) -> Config:
    """Load complete wallet scanner configuration.

    Configuration sources (in order of precedence for overrides):
    1. CLI arguments (highest priority)
    2. config.yaml values
    3. Environment variables (for RPC URLs and Notion credentials)
    4. Hardcoded defaults (lowest priority)

    Args:
        chains: Override list of chains to scan.
        depth: Override number of derived addresses per mnemonic.
        output_dir: Override output directory path.
        threshold_usd: Override USD value threshold.
        max_concurrent: Override max concurrent RPC requests.
        scan_interval_ms: Override request interval in milliseconds.

    Returns:
        Fully populated Config instance.

    Raises:
        ValueError: If required environment variables are missing or
            if YAML configuration cannot be parsed.
    """
    load_dotenv(Path(__file__).parent.parent / ".env")
    load_dotenv(Path.cwd() / ".env")

    yaml_config = _load_yaml_config()

    evm_rpc_urls = _load_evm_rpc_urls()
    solana_rpc_url = _load_solana_rpc_url()
    notion_api_key, notion_database_id = _load_notion_credentials()

    yaml_chains = yaml_config.get("chains")
    yaml_depth = yaml_config.get("depth")
    yaml_output_dir = yaml_config.get("output_dir")
    yaml_threshold = yaml_config.get("threshold_usd")
    yaml_max_concurrent = yaml_config.get("max_concurrent")
    yaml_scan_interval = yaml_config.get("scan_interval_ms")

    return Config(
        evm_rpc_urls=evm_rpc_urls,
        solana_rpc_url=solana_rpc_url,
        notion_api_key=notion_api_key,
        notion_database_id=notion_database_id,
        chains=_resolve_override(yaml_chains, chains, DEFAULT_CHAINS.copy()),
        depth=_resolve_override(yaml_depth, depth, DEFAULT_DEPTH),
        output_dir=_resolve_override(yaml_output_dir, output_dir, DEFAULT_OUTPUT_DIR),
        threshold_usd=_resolve_override(yaml_threshold, threshold_usd, DEFAULT_THRESHOLD_USD),
        max_concurrent=_resolve_override(yaml_max_concurrent, max_concurrent, DEFAULT_MAX_CONCURRENT),
        scan_interval_ms=_resolve_override(yaml_scan_interval, scan_interval_ms, DEFAULT_SCAN_INTERVAL_MS),
    )
