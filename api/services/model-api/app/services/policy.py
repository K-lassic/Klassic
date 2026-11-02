"""#32 구조에서의 위치: 렌더링·결과·다운로드 API → DB의 MP3 제공 정책 읽기. 정책은 변경하지 않는다."""


async def mp3_allowed(db) -> bool:
    row = await db.fetch_one("SELECT api_mp3_allowed FROM v_mp3_license")
    return bool(row and int(row["api_mp3_allowed"]) == 1)
