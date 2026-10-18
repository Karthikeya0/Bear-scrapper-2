import type { MetadataRoute } from 'next'

/** Lets you "Add to Home Screen" on a phone and open the dashboard like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bear Studios Operations',
    short_name: 'Bear Radar',
    description: 'Leads, outreach approvals and results for Bear Studios.',
    start_url: '/outreach',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
