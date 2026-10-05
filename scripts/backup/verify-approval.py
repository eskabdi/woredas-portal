#!/usr/bin/env python3
"""Check a restore-backup.yml dispatch was approved in the Super Admin Console.

The backup-admin Edge Function signs every approved dispatch with
HMAC-SHA256 over

    restore-approval.v1|<request_id>|<artifact_id>|<mode>|<issued_at>

(approvalMessage() in supabase/functions/backup-admin/github.ts) using
RESTORE_APPROVAL_KEY, a secret held only by that function and the GitHub
`restore` environment. A dispatch made with the GitHub token or repository
write access alone carries no valid signature and is refused here.

issued_at must lie within APPROVAL_WINDOW_S of RUN_CREATED, the time GitHub
created this run: a signature cannot be replayed into a run dispatched later.
RUN_CREATED, not "now", because a required reviewer on the environment may
hold the job for hours before it starts.

Reads everything from the environment; prints nothing secret. Exit 0 = valid.
"""

import hmac
import hashlib
import os
import re
import sys

APPROVAL_VERSION = "restore-approval.v1"
APPROVAL_WINDOW_S = 600


def main() -> int:
    env = os.environ
    key = env.get("RESTORE_APPROVAL_KEY", "")
    request_id = env.get("REQUEST_ID", "")
    artifact_id = env.get("ARTIFACT_ID", "")
    mode = env.get("MODE", "")
    issued_at = env.get("ISSUED_AT", "")
    approval = env.get("APPROVAL", "")
    run_created = env.get("RUN_CREATED", "")

    if len(key) < 32:
        print("approval: key missing", file=sys.stderr)
        return 1
    if not (
        re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", request_id)
        and re.fullmatch(r"[1-9][0-9]{0,14}", artifact_id)
        and mode in ("verify", "restore_to_target")
        and re.fullmatch(r"[0-9]{10}", issued_at)
        and re.fullmatch(r"[0-9a-f]{64}", approval)
        and re.fullmatch(r"[0-9]{10}", run_created)
    ):
        print("approval: malformed input", file=sys.stderr)
        return 1

    if abs(int(run_created) - int(issued_at)) > APPROVAL_WINDOW_S:
        print("approval: not issued when this run was created", file=sys.stderr)
        return 1

    message = f"{APPROVAL_VERSION}|{request_id}|{artifact_id}|{mode}|{issued_at}"
    expected = hmac.new(key.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, approval):
        print("approval: signature mismatch", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
