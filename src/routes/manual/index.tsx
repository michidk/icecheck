import { createFileRoute } from '@tanstack/react-router'
import { ManualDiagnostic } from '../../modules/icecheck/components/manual-diagnostic'

export const Route = createFileRoute('/manual/')({
  head: () => ({
    meta: [
      { title: 'WebRTC diagnostic · icecheck' },
      { name: 'description', content: 'Exchange complete base64url WebRTC offers and answers between two browsers.' },
    ],
  }),
  component: ManualDiagnostic,
})
