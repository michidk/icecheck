import { createFileRoute } from '@tanstack/react-router'
import { ManualDiagnostic } from '../../modules/icecheck/components/manual-diagnostic'

export const Route = createFileRoute('/manual/')({
  head: () => ({
    meta: [
      { title: 'Manual signaling diagnostic · icecheck' },
      { name: 'description', content: 'Exchange complete base64url WebRTC offers and answers without a signaling server.' },
    ],
  }),
  component: ManualDiagnostic,
})
