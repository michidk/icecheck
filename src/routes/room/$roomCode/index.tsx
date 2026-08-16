import { createFileRoute } from '@tanstack/react-router'
import { AssistedDiagnostic } from '../../../modules/icecheck/components/assisted-diagnostic'

export const Route = createFileRoute('/room/$roomCode/')({
  head: () => ({
    meta: [
      { title: 'Join WebRTC diagnostic room · icecheck' },
      { name: 'description', content: 'Join a two-browser native WebRTC connectivity diagnostic.' },
    ],
  }),
  component: AssistedDiagnostic,
})
