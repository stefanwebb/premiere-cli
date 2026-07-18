"""Send a log message to the Premiere Bridge CEP panel, if it's open."""

import argparse
import json
import sys
import urllib.error
import urllib.request

DEFAULT_PORT = 47823
VALID_LEVELS = {"info", "warn", "error"}


def log(message: str, level: str = "info", source: str | None = None, port: int = DEFAULT_PORT) -> None:
    """POST a log message to the Premiere Bridge panel's /log endpoint.

    Raises ValueError for an invalid level, ConnectionError if the panel
    isn't reachable, or RuntimeError if the panel rejects the message.
    """
    if level not in VALID_LEVELS:
        raise ValueError(f"level must be one of {sorted(VALID_LEVELS)}, got {level!r}")

    payload = {"message": message, "level": level}
    if source:
        payload["source"] = source

    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/log",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read().decode("utf-8"))
        raise RuntimeError(f"panel rejected the log message: {body.get('error', 'unknown error')}") from exc
    except OSError as exc:
        raise ConnectionError(
            f"could not reach the Premiere Bridge panel on port {port} "
            f"(is the panel open in Premiere Pro?): {exc}"
        ) from exc

    if not body.get("ok"):
        raise RuntimeError(f"panel rejected the log message: {body.get('error', 'unknown error')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a log message to the Premiere Bridge CEP panel.")
    parser.add_argument("message", help="Text to display in the panel's log")
    parser.add_argument("--level", choices=sorted(VALID_LEVELS), default="info", help="Log level (default: info)")
    parser.add_argument("--source", default=None, help="Name of the script/tool sending this message")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Bridge panel port (default: {DEFAULT_PORT})")
    args = parser.parse_args()

    try:
        log(args.message, level=args.level, source=args.source, port=args.port)
    except (ConnectionError, RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
