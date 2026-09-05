#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Read-only WeChat environment detection (stdlib only).
Prints: installed/running status, version, data-dir candidates, account folders, message-store shape.
Used by the wechat-chat-export skill to know where to look. Never modifies anything.
"""
import os
import re
import subprocess
import sys
from pathlib import Path


def _reg_query(key, valname=None):
    """Return list of lines from `reg query`, or [] on any failure."""
    args = ["reg", "query", key]
    if valname:
        args += ["/v", valname]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=15)
        if r.returncode != 0:
            return []
        return r.stdout.splitlines()
    except Exception:
        return []


def _reg_get(key, valname):
    """Return the string value of a REG_SZ/REG_EXPAND_SZ value, or None."""
    for line in _reg_query(key, valname):
        m = re.search(r"REG_(SZ|EXPAND_SZ)\s+(.*)$", line)
        if m:
            return m.group(2).strip()
    return None


def _reg_dword(key, valname):
    for line in _reg_query(key, valname):
        m = re.search(r"REG_DWORD\s+0x([0-9a-fA-F]+)", line)
        if m:
            return int(m.group(1), 16)
    return None


def _version_str(dword):
    if dword is None:
        return None
    if (dword >> 24) == 0x63:
        # 3.x line build, e.g. 3.9.x. Report the raw marker; exact full version
        # comes from wxdump info once the client is running.
        return f"3.9.x line (DWORD 0x{dword:x})"
    return f"0x{dword:x}"


def _wechat_running():
    try:
        r = subprocess.run(["tasklist"], capture_output=True, text=True, timeout=30)
        for line in r.stdout.splitlines():
            if re.search(r"\bWeChat\.exe\b", line, re.IGNORECASE):
                return True
    except Exception:
        pass
    return False


def _exe_path_from_reg():
    p = _reg_get(r"HKCU\Software\Tencent\WeChat", "InstallPath")
    return Path(p) if p else None


def _data_roots():
    """Candidate data roots in priority order (existing dirs first)."""
    roots = []
    fp = _reg_get(r"HKCU\Software\Tencent\WeChat", "FileSavePath")
    if fp:
        roots.append(("registry FileSavePath", Path(fp)))
    docs = Path.home() / "Documents"
    roots.append(("default (Documents/WeChat Files)", docs / "WeChat Files"))
    roots.append(("WeChat 4.x (Documents/xwechat_files)", docs / "xwechat_files"))
    return roots


def _account_dirs(root):
    if not root.is_dir():
        return []
    out = []
    for p in sorted(root.iterdir()):
        try:
            if p.is_dir() and p.name not in ("All Users", "Applet", "WMPF", "Global", "Backup", "BackUp", "Config"):
                out.append(p)
        except OSError:
            continue
    return out


def _shape(acct):
    """Detect message-store shape of an account dir."""
    msg = acct / "Msg"
    if (msg / "Multi").is_dir() and list((msg / "Multi").glob("MSG*.db")):
        return "sharded (3.9.12+)"
    if (acct / "Msg" / "ChatMsg.db").is_file():
        return "legacy (pre-3.9.12)"
    if (acct / "db_storage").is_dir() or (acct / "msg").is_dir():
        return "wechat-4.x"
    return "unknown"


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    running = _wechat_running()
    ver = _reg_dword(r"HKCU\Software\Tencent\WeChat", "Version")
    exe = _exe_path_from_reg()

    print("== WeChat (PC) environment detect ==")
    print(f"running          : {'YES (WeChat.exe in tasklist)' if running else 'NO'}")
    print(f"version(dword)   : {_version_str(ver) if ver is not None else 'not registered'}")
    print(f"install(exe)     : {exe or 'not registered'}")
    if not running:
        print()
        print(">> WeChat is NOT running. Key extraction needs the target account logged in and running.")
        print("   Ask the user to start WeChat and log in, then rerun `wxdump info` later.")

    print()
    print("== data-dir candidates & accounts ==")
    found_any = False
    for why, root in _data_roots():
        if root.is_dir():
            accs = _account_dirs(root)
            print(f"[{why}]")
            print(f"  dir: {root}")
            if not accs:
                print("  (folder exists but no account subfolder found)")
                continue
            for a in accs:
                print(f"  - {a.name}   shape={_shape(a)}")
            found_any = True
        elif "registry" in why:
            print(f"[{why}]")
            print(f"  dir: {root}  (registered but missing on disk)")
    if not found_any:
        print("  (no existing WeChat data root found under the default locations)")
    print()
    print("Hint: account subfolders are usually `wxid_...`. For WeChat 4.x look under")
    print("`xwechat_files`, shape 'wechat-4.x'. Message DBs live under `<acct>/Msg`.")


if __name__ == "__main__":
    main()