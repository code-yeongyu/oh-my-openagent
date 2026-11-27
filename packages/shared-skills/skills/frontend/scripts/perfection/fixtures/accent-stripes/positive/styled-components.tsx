import styled, { createGlobalStyle } from "styled-components"

export const Banner = styled.div`
  padding: ${({ theme }) => theme.space[4]}px;
  border-radius: 12px;
  border-left: 4px solid #2563eb;
`

export const Global = createGlobalStyle`
  .promo-card {
    border-radius: 8px;
    border-top: 3px solid var(--color-brand);
  }
`
