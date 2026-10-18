import { redirect } from 'next/navigation'

// The proxy redirects "/" to each role's home page; this is a fallback.
export default function Home() {
  redirect('/dashboard')
}
