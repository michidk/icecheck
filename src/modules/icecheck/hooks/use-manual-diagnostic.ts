import { createClientOnlyFn } from '@tanstack/react-start'
import { useEffect } from 'react'

const loadManualDiagnostic = createClientOnlyFn(() => import('../lib/manual-client.client.ts'))

export function useManualDiagnostic() {
  useEffect(() => {
    let disposed = false
    let disposeController: (() => void) | undefined

    void loadManualDiagnostic().then(({ mountManualDiagnostic }) => {
      if (disposed) return
      disposeController = mountManualDiagnostic().dispose
    })

    return () => {
      disposed = true
      disposeController?.()
    }
  }, [])
}
