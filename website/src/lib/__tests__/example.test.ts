import { describe, it, expect } from 'vitest'

describe('Example Unit Test', () => {
  it('should pass', () => {
    // given
    const a = 1
    const b = 2

    // when
    const sum = a + b

    // then
    expect(sum).toBe(3)
  })
})
