import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Three suites with different needs, kept apart so none pays for the others:
// the domain maths is pure and runs in node, anything rendering React needs a
// DOM, and the server has a real database behind it. The split is by location
// and extension - `.test.ts` under src/domain or src/api is domain, `.test.tsx`
// anywhere is a component, anything under src/lib or src/app/api is the
// backend - so a new file lands in the right project by being named and placed
// for what it is.
//
// Vitest gets its own config rather than sharing next.config.ts: Next builds
// with Turbopack and has no Vite config to borrow, which is also why the
// Storybook PWA-stripping hack that used to live here is gone.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        test: {
          name: 'domain',
          environment: 'node',
          include: ['src/domain/**/*.test.ts', 'src/api/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/lib/**/*.test.ts', 'src/app/api/**/*.test.ts'],
        },
      },
    ],
  },
})
