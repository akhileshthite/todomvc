import js from '@eslint/js'
import vue from 'eslint-plugin-vue'

export default [
  {
    ignores: [
      'dist/', 'build/', 'contracts/', 'node_modules/',
      // Playwright output, gitignored but still linted otherwise.
      'playwright-report/', 'test-results/'
    ]
  },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        window: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      // These two only enforce where line breaks go inside a template.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off'
    }
  },
  {
    // Contracts run in Chelonia's sandbox, which provides `sbp` as a global.
    files: ['src/contracts/*.js'],
    languageOptions: { globals: { sbp: 'readonly' } }
  }
]
