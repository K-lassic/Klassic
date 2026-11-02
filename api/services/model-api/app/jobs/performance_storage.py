"""#32 구조에서의 위치: 연주 작업 → 악기 편성·파생 파일 DB 기록. 실제 배치 악기만 저장한다."""
from app.db import Database
from app.services.arrange import Assignment
from app.services.catalog import instruments

async def _insert_ensemble(db: Database, kind: str, members: list[dict]) -> int:
    """members: [{part_role, instrument_code | original_name, original_program}]"""
    codes = [m["instrument_code"] for m in members if m.get("instrument_code")]
    ids: dict[str, int] = {}
    if codes:
        rows = await db.fetch_all(
            f"SELECT instrument_id, code FROM instrument WHERE code IN ({','.join(['%s'] * len(codes))})", codes)
        ids = {r["code"]: int(r["instrument_id"]) for r in rows}
    async with db.transaction() as cur:
        await cur.execute("INSERT INTO ensemble (ensemble_kind) VALUES (%s)", (kind,))
        ens_id = int(cur.lastrowid)
        part_no = 0
        for m in members:
            code = m.get("instrument_code")
            if code and code not in ids:
                continue
            part_no += 1
            await cur.execute(
                "INSERT INTO ensemble_member (ensemble_id, part_no, part_role, instrument_id, original_instrument_name, "
                "original_midi_program) VALUES (%s,%s,%s,%s,%s,%s)",
                (ens_id, part_no, m.get("part_role"), ids.get(code) if code else None,
                 None if code else m["original_name"][:100],
                 None if code else (m.get("original_program") if m.get("original_program") is not None
                                    and 0 <= m["original_program"] <= 127 else None)),
            )
    return ens_id


async def create_custom_ensemble(db: Database, assignment: Assignment) -> int:
    cat = instruments()
    members = [{"part_role": "percussion" if cat[t["instrument"]].is_percussion else "melody",
                "instrument_code": t["instrument"]} for t in sorted(assignment.tracks, key=lambda x: x["part"])]
    return await _insert_ensemble(db, "custom", members)


async def placed_ensemble_id(db: Database, ensemble_id: int | None, used: list[str]) -> int | None:
    """실제로 놓인 악기(arrange 가 돌려준 used)를 가리키는 악기 구성 id (2026-09-29 황송해 결정).

    - 고른 구성(ensemble_id)의 서비스 악기가 놓인 악기와 같으면 그 구성을 그대로 쓴다(기본 · 추천 · 직접 지정).
    - 다르면(예: 타악 성부가 없어 장구가 놓이지 않음) 놓인 악기만 담은 'custom' 구성을 찾아 다시 쓰거나 새로 만든다.
      그래서 기록(instrument_selection · derived_file)에 연주하지 않은 장구·북이 남지 않는다.
    - 원래 악기 구성(서비스 악기가 아닌 파트가 있음)이나 놓인 악기가 없으면 ensemble_id 를 그대로 돌려준다.
    """
    cat = instruments()
    placed: list[str] = []
    for code in used:
        if code in cat and code not in placed:
            placed.append(code)
    if not placed:
        return ensemble_id
    if ensemble_id is not None:
        rows = await db.fetch_all(
            "SELECT i.code FROM ensemble_member m LEFT JOIN instrument i ON i.instrument_id = m.instrument_id "
            "WHERE m.ensemble_id = %s", (ensemble_id,))
        codes = [r["code"] for r in rows]
        if any(c is None for c in codes) or set(codes) == set(placed):
            return ensemble_id
    # 선율 먼저, 그다음 타악 — 기본 구성과 같은 차례
    placed.sort(key=lambda c: cat[c].is_percussion)
    members = [{"part_role": "percussion" if cat[c].is_percussion else "melody", "instrument_code": c} for c in placed]
    signature = ",".join(f"{m['part_role']}:{m['instrument_code']}" for m in members)
    row = await db.fetch_one(
        "SELECT e.ensemble_id FROM ensemble e JOIN ensemble_member m ON m.ensemble_id = e.ensemble_id "
        "JOIN instrument i ON i.instrument_id = m.instrument_id WHERE e.ensemble_kind = 'custom' "
        "GROUP BY e.ensemble_id HAVING COUNT(*) = %s AND COUNT(*) = (SELECT COUNT(*) FROM ensemble_member x "
        "WHERE x.ensemble_id = e.ensemble_id) "
        "AND GROUP_CONCAT(CONCAT(m.part_role, ':', i.code) ORDER BY m.part_no SEPARATOR ',') = %s "
        "ORDER BY e.ensemble_id LIMIT 1", (len(members), signature))
    if row:
        return int(row["ensemble_id"])
    return await _insert_ensemble(db, "custom", members)


async def _default_ensemble_id(db: Database) -> int | None:
    row = await db.fetch_one("SELECT ensemble_id FROM ensemble WHERE ensemble_kind = 'default'")
    return int(row["ensemble_id"]) if row else None


async def _derived(db: Database, request_id: int, fmt: str, *, ensemble_id: int | None, status: str,
                   path_uri: str | None = None, renderer: tuple[str, str] | None = None,
                   failure: str | None = None, started=None, finished=None) -> int:
    return await db.execute(
        "INSERT INTO derived_file (request_id, format, basis, ensemble_id, render_status, renderer_name, renderer_version, "
        "render_started_at, render_finished_at, failure_reason, storage_uri) VALUES (%s,%s,'original',%s,%s,%s,%s,%s,%s,%s,%s)",
        (request_id, fmt, ensemble_id, status, renderer[0][:40] if renderer else None,
         renderer[1][:40] if renderer else None, started, finished, failure, path_uri),
    )
