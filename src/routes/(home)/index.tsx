import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from './-components/home-page'

export const Route = createFileRoute('/(home)/')({
  head: () => ({
    meta: [
      { title: 'Debug ICE, STUN & WebRTC · icecheck' },
      { name: 'description', content: 'Debug direct WebRTC connectivity between two browsers with LAN and STUN-assisted path diagnostics.' },
    ],
  }),
  component: HomePage,
})
