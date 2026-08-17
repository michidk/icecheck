import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from './-components/home-page'

export const Route = createFileRoute('/(home)/')({
  head: () => ({
    meta: [
      { title: 'WebRTC connectivity diagnostic · icecheck' },
      { name: 'description', content: 'Test a native WebRTC connection between two browsers using a manual copy-and-paste exchange.' },
    ],
  }),
  component: HomePage,
})
