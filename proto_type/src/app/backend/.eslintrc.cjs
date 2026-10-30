// 웹 서비스 린트 설정 (tasks T006)
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true },
  ignorePatterns: ['dist/'],
  rules: {
    // DB 행은 뷰마다 모양이 달라 좁은 곳에서 any 를 허용한다
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
