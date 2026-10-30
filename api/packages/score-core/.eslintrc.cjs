// score-core 린트 설정 (TypeScript strict 기준)
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, browser: true, node: true },
  ignorePatterns: ['dist/'],
};
