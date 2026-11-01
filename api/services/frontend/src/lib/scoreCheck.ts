// 악보를 그리기 전 확인(2026-09-30 황송해 64번, SD_02 머리말) — 그리지 못하면 실제 원인에서 고른 문장을 보인다.
/** 그리기 전에 MusicXML 을 살펴 이유가 분명한 실패를 먼저 가린다 */
export function precheck(xml: string): string | null {
  if (!xml.trim()) return '악보 파일이 비어 있어 그리지 못했습니다.';
  let doc: Document;
  try { doc = new DOMParser().parseFromString(xml, 'application/xml'); } catch { return '악보 파일(MusicXML)을 읽지 못했습니다.'; }
  if (doc.getElementsByTagName('parsererror').length) return '악보 파일(MusicXML)의 형식이 맞지 않아 읽지 못했습니다.';
  const root = doc.documentElement?.nodeName;
  if (root !== 'score-partwise' && root !== 'score-timewise') return '악보 파일(MusicXML)이 아니라서 읽지 못했습니다.';
  const notes = Array.from(doc.getElementsByTagName('note')).filter((n) => !n.getElementsByTagName('rest').length);
  if (!notes.length) return '악보에서 음표를 찾지 못해 그릴 것이 없습니다.';
  return null;
}

