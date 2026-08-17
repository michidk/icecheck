import { createFileRoute } from '@tanstack/react-router'
import { ManualDiagnostic } from '../../modules/icecheck/components/manual-diagnostic'

export const Route = createFileRoute('/(home)/')({
  head: () => ({
    meta: [
      { title: 'WebRTC connection diagnostic · icecheck' },
      { name: 'description', content: 'Test a direct WebRTC path between two browsers with a private copy-and-paste offer and answer exchange.' },
    ],
  }),
  component: ManualDiagnostic,
})
