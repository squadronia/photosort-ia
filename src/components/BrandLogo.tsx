import type { Theme } from '../domain/models'

export function BrandLogo({ theme, className }: { theme: Theme; className: string }) {
  const src = theme === 'dark'
    ? '/brand/photosort-logo-dark.png?v=2'
    : '/brand/photosort-logo-light.png?v=2'

  return <img alt="PhotoSort" className={className} src={src} />
}
