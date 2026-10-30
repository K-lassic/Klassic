// #26 명령줄 도구 공통 — 인자 읽기 · 화면에 안 보이게 비밀번호 묻기.
//
//   구조에서의 위치: 운영자가 서버 PC 에서 `docker compose run --rm -it web node dist/tools/<도구>.js …` 로 실행한다.
//     웹 화면 · 외부에서는 부를 수 없다 (관리자 API 가 생기기 전의 대체 수단 — #5 ※).
import { createInterface } from 'node:readline';

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 입력하는 글자를 화면에 보이지 않게 묻는다 (터미널이 있을 때만 — docker compose run -it) */
export function askHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('터미널이 없어 비밀번호를 물을 수 없습니다 — docker compose run 에 -it 를 붙이세요'));
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (s.includes(prompt)) out.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

/** 도구 실행 감싸기 — 실패하면 원인 한 줄만 보여 주고 끝 코드 1 */
export function runTool(main: () => Promise<void>, cleanup: () => Promise<void>): void {
  main()
    .then(cleanup)
    .catch(async (e: unknown) => {
      console.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
      await cleanup().catch(() => undefined);
      process.exit(1);
    });
}
