import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
}, {
  rules: {
    'no-console': 'off',
  },
})
