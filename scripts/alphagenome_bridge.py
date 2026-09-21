#!/usr/bin/env python3
"""
AlphaGenome API Bridge Script

The bridge between the TypeScript MCP server and the AlphaGenome Python SDK.
It reads one JSON request on stdin, runs one action, and writes one JSON
response on stdout. Logs go to stderr.

    {"action": "...", "api_key": "...", "params": {...}}

Actions:
    atlas_list_scorers, atlas_lookup_variant, atlas_lookup_variants,
    atlas_scan_region        precomputed scores from the AlphaGenome Atlas
    live_score_variant, live_score_variants
                             live inference with score_variant

Both sources return scores in the same shape and are summarised by the same
code (summaries.py). Scores and quantiles are reported as returned; no
pathogenicity class, risk label or percent change is derived from them.
"""

import json
import os
import sys
from typing import Optional

# The sibling modules are imported by name, wherever the bridge is started from.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import alphagenome  # noqa: F401  pylint: disable=unused-import
except ImportError as import_error:
    # stdout carries the JSON response and nothing else, so the Node side can
    # always parse it. Human-readable detail goes to stderr.
    print(f"alphagenome import failed: {import_error}", file=sys.stderr)
    print(json.dumps({
        "success": False,
        "error": (
            "AlphaGenome package not installed for this interpreter "
            f"({sys.executable}). Requires Python 3.10 or newer: pip install alphagenome. "
            "Set ALPHAGENOME_PYTHON to choose a different interpreter."
        ),
        "error_type": "ApiError"
    }))
    sys.exit(1)


def grpc_status_name(error: BaseException) -> Optional[str]:
    """Name of the gRPC status behind an exception, if there is one.

    The SDK re-raises some gRPC errors as built-in exceptions and keeps the
    original call as __cause__, so both places are checked.
    """
    for candidate in (error, getattr(error, '__cause__', None)):
        code = getattr(candidate, 'code', None)
        if callable(code):
            try:
                return code().name
            except Exception:
                continue
    return None


def classify_error(error: BaseException) -> str:
    """Map an exception to the error_type understood by the Node client."""
    # Matched by class name so that a request for one source does not have to
    # import the other source's client.
    kinds = {cls.__name__ for cls in type(error).__mro__}
    if 'AtlasNotAvailable' in kinds:
        return 'AtlasNotAvailableError'
    if 'AtlasQuotaExceeded' in kinds:
        return 'RateLimitError'
    if 'InvalidRequest' in kinds:
        return 'ValidationError'

    status = grpc_status_name(error)
    if isinstance(error, PermissionError) or status in ('UNAUTHENTICATED', 'PERMISSION_DENIED'):
        return 'ApiKeyError'
    if status == 'RESOURCE_EXHAUSTED':
        return 'RateLimitError'
    if isinstance(error, TimeoutError) or status == 'DEADLINE_EXCEEDED':
        return 'TimeoutError'
    if status in ('UNAVAILABLE', 'CANCELLED', 'ABORTED'):
        return 'NetworkError'
    if isinstance(error, (ValueError, IndexError, KeyError, TypeError)):
        return 'ValidationError'
    return 'ApiError'


def run(action: Optional[str], api_key: str, params: dict) -> dict:
    if isinstance(action, str) and action.startswith('atlas_'):
        import atlas_actions as module
    elif isinstance(action, str) and action.startswith('live_'):
        import live_actions as module
    else:
        raise ValueError(f"Unknown action: {action}")

    handler = module.ACTIONS.get(action)
    if handler is None:
        raise ValueError(f"Unknown action: {action}")
    return handler(module.create_client(api_key), params)


def main():
    """Main entry point for the bridge script."""
    try:
        request = json.loads(sys.stdin.read())
        action = request.get('action')
        api_key = request.get('api_key')
        params = request.get('params') or {}

        if not api_key:
            raise PermissionError("API key is required")

        result = run(action, api_key, params)
        print(json.dumps({'success': True, 'data': result}))
        sys.exit(0)

    except Exception as e:
        print(f"bridge error: {type(e).__name__}: {e}", file=sys.stderr)
        print(json.dumps({
            'success': False,
            'error': str(e) or type(e).__name__,
            'error_type': classify_error(e)
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
