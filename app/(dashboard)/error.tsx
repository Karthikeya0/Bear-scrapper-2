'use client'
import { useEffect } from 'react'
import { Alert } from '@/components/ui'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title" style={{ marginBottom: 12 }}>Something went wrong</h1>
      <Alert title="This page failed to load">{error.message || 'An unexpected error occurred.'}</Alert>
      <button className="btn btn-primary" onClick={reset}>Try again</button>
    </div>
  )
}
