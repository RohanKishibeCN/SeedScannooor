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


TATUM_API_KEY_ENV = "TATUM_API_KEY"
HELIUS_RPC_URL_ENV = "HELIUS_RPC_URL"

NOTION_API_KEY_ENV = "NOTION_API_KEY"
NOTION_DATABASE_ID_ENV = "NOTION_DATABASE_ID"

DEPTH_ENV_KEY = "SCAN_DEPTH"
THRESHOLD_USD_ENV_KEY = "THRESHOLD_USD"

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
        tatum_api_key: Tatum API key for EVM chain balance queries.
        helius_rpc_url: Helius RPC endpoint URL for Solana balance queries.
        notion_api_key: Notion integration API key.
        notion_database_id: Notion database ID for results storage.
        chains: List of chain identifiers to scan.
        depth: Number of derived addresses per mnemonic.
        output_dir: Directory path for saving scan results.
        threshold_usd: Minimum USD value threshold for reporting.
        max_concurrent: Maximum concurrent RPC requests.
        scan_interval_ms: Milliseconds to wait between requests.
    """

    tatum_api_key: str
    helius_rpc_url: str
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


def _load_tatum_api_key() -> str:
    """Extract Tatum API key from environment variables.

    Returns:
        Tatum API key.

    Raises:
        ValueError: If required environment variable is missing.
    """
    value = os.environ.get(TATUM_API_KEY_ENV)
    if not value:
        raise ValueError(
            f"Missing required environment variable: {TATUM_API_KEY_ENV}"
        )
    return value


def _load_helius_rpc_url() -> str:
    """Extract Helius RPC URL from environment variables.

    Returns:
        Helius RPC endpoint URL.

    Raises:
        ValueError: If required environment variable is missing.
    """
    value = os.environ.get(HELIUS_RPC_URL_ENV)
    if not value:
        raise ValueError(
            f"Missing required environment variable: {HELIUS_RPC_URL_ENV}"
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
    env_value: T | None,
    yaml_value: T | None,
    cli_value: T | None,
    default: T,
) -> T:
    """Resolve configuration value with precedence: CLI > .env > YAML > default.

    Args:
        env_value: Value loaded from environment variable.
        yaml_value: Value loaded from config.yaml.
        cli_value: Value passed via CLI argument (may be None).
        default: Default value if neither override is provided.

    Returns:
        Resolved configuration value.
    """
    if cli_value is not None:
        return cli_value
    if env_value is not None:
        return env_value
    if yaml_value is not None:
        return yaml_value
    return default


def _load_depth() -> int | None:
    """Load SCAN_DEPTH from environment variable."""
    value = os.environ.get(DEPTH_ENV_KEY)
    if value:
        try:
            return int(value)
        except ValueError:
            raise ValueError(f"Environment variable {DEPTH_ENV_KEY} must be an integer, got: {value}")
    return None


def _load_threshold_usd() -> float | None:
    """Load THRESHOLD_USD from environment variable."""
    value = os.environ.get(THRESHOLD_USD_ENV_KEY)
    if value:
        try:
            return float(value)
        except ValueError:
            raise ValueError(f"Environment variable {THRESHOLD_USD_ENV_KEY} must be a float, got: {value}")
    return None


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

    tatum_api_key = _load_tatum_api_key()
    helius_rpc_url = _load_helius_rpc_url()
    notion_api_key, notion_database_id = _load_notion_credentials()

    yaml_chains = yaml_config.get("chains")
    yaml_depth = yaml_config.get("depth")
    yaml_output_dir = yaml_config.get("output_dir")
    yaml_threshold = yaml_config.get("threshold_usd")
    yaml_max_concurrent = yaml_config.get("max_concurrent")
    yaml_scan_interval = yaml_config.get("scan_interval_ms")

    env_depth = _load_depth()
    env_threshold = _load_threshold_usd()

    return Config(
        tatum_api_key=tatum_api_key,
        helius_rpc_url=helius_rpc_url,
        notion_api_key=notion_api_key,
        notion_database_id=notion_database_id,
        chains=_resolve_override(None, yaml_chains, chains, DEFAULT_CHAINS.copy()),
        depth=_resolve_override(env_depth, yaml_depth, depth, DEFAULT_DEPTH),
        output_dir=_resolve_override(None, yaml_output_dir, output_dir, DEFAULT_OUTPUT_DIR),
        threshold_usd=_resolve_override(env_threshold, yaml_threshold, threshold_usd, DEFAULT_THRESHOLD_USD),
        max_concurrent=_resolve_override(None, yaml_max_concurrent, max_concurrent, DEFAULT_MAX_CONCURRENT),
        scan_interval_ms=_resolve_override(None, yaml_scan_interval, scan_interval_ms, DEFAULT_SCAN_INTERVAL_MS),
    )
