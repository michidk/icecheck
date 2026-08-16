import { createFileRoute } from '@tanstack/react-router'
import { AssistedDiagnostic } from '../../modules/icecheck/components/assisted-diagnostic'

export const Route = createFileRoute('/session/')({
  head: () => ({
    meta: [
      { title: 'Server-assisted WebRTC diagnostic · icecheck' },
      { name: 'description', content: 'Trace WebSocket signaling, direct ICE paths, data channels, and synthetic video between two browsers.' },
    ],
  }),
  component: AssistedDiagnostic,
})
