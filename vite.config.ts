import { defineConfig } from 'vite';

// GitHub Pages: djson98.github.io/skate/ → base를 '/skate/'로 잡아야 JS/에셋 경로 맞음
// 로컬 개발(npm run dev)에서는 base 무시되고 '/' 로 동작
export default defineConfig({
  base: '/skate/',
});
