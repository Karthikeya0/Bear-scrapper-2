// Remembers which workflows this browser just started, so the Activity panel can show them as
// "running" until n8n writes their run log. Browser-only and best-effort (private windows may block storage).

const KEY = 'bear_activity_started'
const listeners = new Set<() => void>()

export type StartedMap = Record<string, number>

export function readStarted(): StartedMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as StartedMap
  } catch {
    return {}
  }
}

function write(map: StartedMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {}
  listeners.forEach(l => l())
}

export function markStarted(workflow: string) {
  write({ ...readStarted(), [workflow]: Date.now() })
}

export function clearStarted(workflow: string) {
  const map = readStarted()
  delete map[workflow]
  write(map)
}

export function onStartedChange(listener: () => void) {
  listeners.add(listener)
  const storage = (e: StorageEvent) => e.key === KEY && listener()
  window.addEventListener('storage', storage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', storage)
  }
}
