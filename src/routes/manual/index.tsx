import { createFileRoute } from '@tanstack/react-router'
import { ManualDiagnostic } from '../../modules/icecheck/components/manual-diagnostic'

export const Route = createFileRoute('/manual/')({
  head: () => ({
    meta: [
      { title: 'Debug a WebRTC connection · icecheck' },
      { name: 'description', content: 'Test a direct WebRTC path between two browsers with a private copy-and-paste offer and answer exchange.' },
    ],
  }),
  component: ManualDiagnostic,
})
