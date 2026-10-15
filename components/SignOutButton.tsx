'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { IconLogout } from './icons'

export default function SignOutButton({ className = 'btn btn-sm' }: { className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await createClient().auth.signOut()
        router.replace('/login')
        router.refresh()
      }}
    >
      <IconLogout className="icon" />
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
