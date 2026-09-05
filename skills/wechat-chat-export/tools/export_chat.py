#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generic WeChat chat export from DECRYPTED databases (stdlib only).

Works on the output of `wxdump decrypt`: a directory of de_*.db files.
Auto-detects the message-store shape (sharded MSG*.db, legacy ChatMsg.db, ...),
resolves a contact by remark/nickname, and writes `<contact>_聊天记录.md` + .json.

Usage:
  python3 export_chat.py --decrypted <dir> --contact "<昵称或备注>" [--wxid <wxid>] [--self-name "我"] [--out <dir>]

Only reads decrypted local data. Never talks to the network.
"""
import argparse
import datetime
import html
import json
import re
import sqlite3
import sys
from pathlib import Path

CAND_TABLES = ("MSG", "ChatMsg", "ChatCRMsg")
CONTACT_TABLES = ("Contact",)

_NAME_COL = {"talker": ("strtalker", "talker", "strtalkerid", "talkerid"),
             "time": ("createtime", "create_time"),
             "content": ("strcontent", "content", "msgcontent"),
             "sender": ("issender", "is_sender", "issend"),
             "type": ("type",),
             "subtype": ("subtype",),
             "svrid": ("msgsvrid", "msgserverid", "svrid")}


def _cols(conn, table):
    try:
        rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    except sqlite3.Error:
        return []
    return [r[1].lower() for r in rows]


def _pick(cols, key):
    for cand in _NAME_COL[key]:
        if cand in cols:
            return cand
    return None


def _tables(conn):
    try:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    except sqlite3.Error:
        return []
    return [r[0] for r in rows]


def _db_files(dec_dir):
    return [p for p in sorted(Path(dec_dir).rglob("*.db"))
            if "-wal" not in p.name and "-shm" not in p.name]


def _message_sources(files):
    """Return list of dict(path, table, maple) that look like message containers."""
    sources = []
    for path in files:
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        except sqlite3.Error:
            continue
        try:
            for table in _tables(conn):
                if table.upper() not in CAND_TABLES and table.lower() != "msg":
                    continue
                cols = _cols(conn, table)
                colmap = {k: _pick(cols, k) for k in _NAME_COL}
                if colmap["talker"] and colmap["time"] and colmap["content"] and colmap["type"]:
                    sources.append({"path": str(path), "table": table, "colmap": colmap})
        finally:
            conn.close()
    return sources


def _find_contact(files, name):
    """Search for contact in any db exposing a Contact table. Return (wxid, info|None, candidates)."""
    for path in files:
        try:
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        except sqlite3.Error:
            continue
        try:
            tables = [t.lower() for t in _tables(conn)]
            if "contact" not in tables:
                continue
            cols = [r[1].lower() for r in conn.execute('PRAGMA table_info("Contact")').fetchall()]
            user = _pick_simple(cols, "username")
            nick = _pick_simple(cols, "nickname")
            remark = _pick_simple(cols, "remark")
            alias = _pick_simple(cols, "alias")
            sql = (f"SELECT {user}{', '+nick if nick else ''}{', '+remark if remark else ''}"
                   f"{', '+alias if alias else ''} FROM Contact")
            rows = conn.execute(sql).fetchall()
            contacts = []
            for r in rows:
                rec = {"wxid": r[0], "nickname": None, "remark": None, "alias": None}
                i = 1
                if nick:
                    rec["nickname"] = r[i]; i += 1
                if remark:
                    rec["remark"] = r[i]; i += 1
                if alias:
                    rec["alias"] = r[i]
                contacts.append(rec)
            conn.close()

            name_l = name.lower()
            exact = [c for c in contacts if c["remark"] and c["remark"].lower() == name_l or
                     c["nickname"] and c["nickname"].lower() == name_l or
                     c["alias"] and c["alias"].lower() == name_l]
            if exact:
                return exact[0]["wxid"], exact[0], exact
            fuzzy = [c for c in contacts if c["remark"] and name_l in c["remark"].lower() or
                     c["nickname"] and name_l in c["nickname"].lower() or
                     c["alias"] and name_l in c["alias"].lower()]
            if fuzzy:
                return None, None, fuzzy
            return None, None, []
        except sqlite3.Error:
            continue
        finally:
            try:
                conn.close()
            except Exception:
                pass
    return None, None, []


def _pick_simple(cols, name):
    for c in cols:
        if c == name:
            return c
        if c == "username" and name == "username":
            return c
    for c in cols:
        if c.endswith(name) or name.endswith(c):
            return c
    return None


def _gather(sources, wxid):
    msgs = []
    for src in sources:
        cm = src["colmap"]
        conn = sqlite3.connect(f"file:{src['path']}?mode=ro", uri=True)
        conn.text_factory = lambda b: b.decode("utf-8", "replace")
        try:
            cols = list(cm.values())
            tq = ", ".join([f'"{c}"' for c in cols])
            cur = conn.execute(f'SELECT {tq} FROM "{src["table"]}" WHERE "{cm["talker"]}" = ?', (wxid,))
            for row in cur.fetchall():
                m = dict(zip(cols, row))
                msgs.append({
                    "time": m.get(cm["time"]),
                    "type": m.get(cm["type"]),
                    "subtype": m.get(cm["subtype"]),
                    "sender": m.get(cm["sender"]),
                    "content": m.get(cm["content"]),
                    "svrid": m.get(cm["svrid"]),
                    "_src": src["path"] + ":" + src["table"],
                })
        finally:
            conn.close()
    return msgs


def _fmt_time(ts):
    try:
        return datetime.datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OSError):
        return str(ts)


def _emoji_name(xml):
    m = re.search(r"<emoji[^>]*/?>([^<]*)</emoji>", xml)
    if m and m.group(1).strip():
        return m.group(1).strip()
    return "[表情]"


def _app_desc(content, subtype):
    sub = int(subtype) if subtype is not None else 0
    if sub == 57:
        return "[视频通话]"
    if sub == 6:
        return "[语音通话]"
    if not content:
        return "[链接/卡片]"
    t = re.search(r"<title>([^<]*)</title>", content or "")
    d = re.search(r"<des>([^<]*)</des>", content or "")
    u = re.search(r"<url>([^<]*)</url>", content or "")
    parts = []
    if t and t.group(1): parts.append(html.unescape(t.group(1)))
    if d and d.group(1): parts.append(html.unescape(d.group(1)))
    if u and u.group(1): parts.append("链接:" + html.unescape(u.group(1)))
    return "[链接] " + " · ".join(parts) if parts else "[链接/卡片]"


def _sys_desc(content):
    if not content:
        return ""
    m = re.search(r">([^<]*)</revokemsg>", content)
    if m:
        return html.unescape(m.group(1))
    return content.replace("\n", " ").strip()[:200]


def _render(m, self_name, contact_name):
    created = _fmt_time(m["time"])
    who = self_name if int(m.get("sender") or 0) == 1 else contact_name
    t = int(m.get("type") or 0)
    content = m.get("content") or ""
    if isinstance(content, (bytes, bytearray)):
        content = content.decode("utf-8", "replace")
    if t == 1:
        kind, text = "text", content
    elif t == 3:
        kind, text = "image", "[图片]"
    elif t == 34:
        kind, text = "voice", "[语音]"
    elif t == 43:
        kind, text = "video", "[视频]"
    elif t == 47:
        kind, text = "emoji", _emoji_name(content)
    elif t == 49:
        kind, text = "app", _app_desc(content, m.get("subtype"))
    elif t == 10000:
        kind, text = "system", _sys_desc(content)
    elif t == 10002:
        kind, text = "recall", "[撤回了一条消息]"
    else:
        kind, text = f"type{t}", content[:200]
    return {"time": created, "sender": who, "kind": kind, "content": text}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--decrypted", required=True, help="dir with de_*.db (output of wxdump decrypt)")
    ap.add_argument("--contact", required=True, help="contact remark or nickname")
    ap.add_argument("--wxid", help="target wxid (skip fuzzy contact lookup)")
    ap.add_argument("--self-name", default="我", help="sender label for messages from self")
    ap.add_argument("--out", default=".", help="output directory")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    dec = Path(args.decrypted)
    files = _db_files(dec)
    if not files:
        sys.exit(f"No *.db found under {dec}")

    wxid = args.wxid
    info = None
    if not wxid:
        wxid, info, cands = _find_contact(files, args.contact)
        if not wxid:
            print("Contact not uniquely resolved. Candidates:")
            for c in (cands or [])[:20]:
                print(f"  wxid={c['wxid']} remark={c['remark']!r} nick={c['nickname']!r}")
            print("Pass --wxid <wxid> to pick one (or none matched).")
            sys.exit(2)

    contact_name = args.contact
    if info:
        contact_name = info["remark"] or info["nickname"] or args.contact

    sources = _message_sources(files)
    msgs = _gather(sources, wxid)
    seen, uniq = set(), []
    for m in msgs:
        sv = m.get("svrid") or (m.get("time"), m.get("content"), m.get("_src"))
        if sv in seen:
            continue
        seen.add(sv)
        uniq.append(m)
    uniq.sort(key=lambda m: (m.get("time") or 0, m.get("_src") or ""))
    recs = [_render(m, args.self_name, contact_name) for m in uniq]

    if not recs:
        sys.exit(f"No messages found for {contact_name} ({wxid}). Is the right account/decrypted dir?")
    first, last = recs[0]["time"], recs[-1]["time"]
    n_text = sum(1 for r in recs if r["kind"] == "text")
    n_call = sum(1 for r in recs if r["kind"] == "app" and r["content"] in ("[视频通话]", "[语音通话]"))
    n_img = sum(1 for r in recs if r["kind"] in ("image", "video", "voice"))

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[<>:"/\\|?*]', "_", contact_name)
    md = (f"# 与 {contact_name} 的聊天记录\n\n"
          f"- 微信号: {wxid}\n"
          f"- 记录时间: {first} ~ {last}\n"
          f"- 消息总数: {len(recs)} (文字 {n_text} · 通话 {n_call} · 图片/语音/视频 {n_img})\n\n---\n\n")
    for r in recs:
        md += f"**[{r['time']}] {r['sender']}**\n\n> {r['content']}\n\n"
    md_path = outdir / f"{safe}_聊天记录.md"
    md_path.write_text(md, encoding="utf-8")

    json_path = outdir / f"{safe}_聊天记录.json"
    payload = {
        "contact": {"wxid": wxid, "show": contact_name,
                    "remark": info["remark"] if info else None,
                    "nickname": info["nickname"] if info else None},
        "count": len(recs),
        "messages": recs,
    }
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"exported {len(recs)} messages for {contact_name} ({wxid})")
    print(f"markdown : {md_path}")
    print(f"json     : {json_path}")


if __name__ == "__main__":
    main()