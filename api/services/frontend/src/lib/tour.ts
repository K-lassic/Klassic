// 체험하기 장 목록 (2026-09-30 황송해 결정 165번 — SD_02 §4-7 S1-T) — 최대 6장. 문구는 합쇼체.
export type TourPic = 'intro' | 'upload' | 'instrument' | 'pitch' | 'save' | 'share';
export interface TourSlide { title: string; lines: string[]; pic: TourPic }

export const TOUR_SLIDES: TourSlide[] = [
  { title: 'Klassic 을 소개합니다', pic: 'intro', lines: ['국악보 사진을 올리면 소리로 듣고, 다른 악기로 바꾸고, 파일로 저장할 수 있습니다.', '네 단계만 따라오시면 됩니다.'] },
  { title: '1단계 · 악보 올리기', pic: 'upload', lines: ['악보 종류를 고른 뒤 사진이나 PDF 를 끌어 놓으십시오.', '악보가 없으면 예시 파일로 해 볼 수 있습니다.'] },
  { title: '2단계 · 다른 악기로 변환하기', pic: 'instrument', lines: ['변환한 악보를 들어 보고, 성부마다 연주할 악기를 바꿀 수 있습니다.'] },
  { title: '3단계 · 악보 음계 변환하기', pic: 'pitch', lines: ['틀린 음표를 눌러 반음씩 올리거나 내리십시오.', '고친 내용은 저절로 저장됩니다.'] },
  { title: '4단계 · 저장하기', pic: 'save', lines: ['MP3 · PDF · MIDI · MusicXML 가운데 필요한 형식을 골라 받으십시오.', '만든 악보는 1단계 "내가 만든 악보"에서 다시 받을 수 있습니다.'] },
  { title: '악보 공유하기', pic: 'share', lines: ['다른 사람이 공유한 악보를 먼저 들어 보고, 내 악보도 모두에게 공유할 수 있습니다.'] },
];
