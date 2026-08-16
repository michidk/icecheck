import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect } from 'react'

const startIcecheck = createClientOnlyFn(() => import('../lib/icecheck-client.client.js'))

export function useIcecheckClient() {
  useEffect(() => {
    void startIcecheck()
  }, [])
}
