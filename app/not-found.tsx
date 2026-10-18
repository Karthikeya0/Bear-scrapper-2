import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="center-screen">
      <div className="card card-pad center-card" style={{ textAlign: 'center' }}>
        <div className="brand-mark" style={{ margin: '0 auto 16px' }}>B</div>
        <h1 className="page-title" style={{ fontSize: 20 }}>Page not found</h1>
        <p className="page-desc" style={{ marginBottom: 20 }}>The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
        <Link href="/" className="btn btn-primary">Go to dashboard</Link>
      </div>
    </div>
  )
}
