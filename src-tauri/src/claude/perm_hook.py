#!/usr/bin/env python3
# GlassForge PreToolUse permission hook.
#
# Invoked by `claude` ONLY for sessions launched from GlassForge, because
# we pass this via --settings <per-session-tempfile>. Your normal TTY
# claude is untouched.
#
# Protocol:
#   1. Read the hook payload (JSON) from stdin.
#   2. If GLASSFORGE_AUTO_EDITS=1 and the tool is an editor tool, exit 0.
#   3. Otherwise connect to $GLASSFORGE_PERM_SOCK (Unix socket opened by
#      GlassForge), send the payload + newline.
#   4. Read a single-line decision back: "allow" or "deny".
#   5. Exit 0 to let claude run the tool, or exit 2 to block it.
#
# If the env var isn't set — e.g. claude was invoked outside GlassForge
# somehow — exit 0 so the hook doesn't break the user's own sessions.

import json
import os
import socket
import sys

# Tools that "acceptEdits" mode auto-approves without prompting. Kept in
# sync with claude-code's own definition of edit tools so the user gets
# the behavior the mode's name promises.
EDIT_TOOLS = frozenset({"Edit", "Write", "MultiEdit", "NotebookEdit"})


def main() -> int:
    sock_path = os.environ.get("GLASSFORGE_PERM_SOCK")
    if not sock_path:
        return 0

    try:
        payload = sys.stdin.read()
    except Exception as e:
        print(f"glassforge perm-hook: failed to read stdin: {e}", file=sys.stderr)
        return 0

    if os.environ.get("GLASSFORGE_AUTO_EDITS") == "1":
        try:
            tool_name = json.loads(payload).get("tool_name", "")
        except Exception:
            tool_name = ""
        if tool_name in EDIT_TOOLS:
            return 0

    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(600)  # 10 minutes is plenty for a human decision
        s.connect(sock_path)
        if not payload.endswith("\n"):
            payload += "\n"
        s.sendall(payload.encode("utf-8"))
        f = s.makefile("r")
        decision = (f.readline() or "").strip()
    except Exception as e:
        print(f"glassforge perm-hook: ipc error: {e}", file=sys.stderr)
        return 0

    if decision == "allow":
        return 0
    print("Blocked by GlassForge manual approval", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
