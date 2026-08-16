import { createFileRoute } from '@tanstack/react-router'
import { HomePage } from './-components/home-page'

export const Route = createFileRoute('/(home)/')({
  head: () => ({
    meta: [
      { title: 'Choose a WebRTC diagnostic · icecheck' },
      { name: 'description', content: 'Choose assisted room signaling or a manual copy-and-paste WebRTC diagnostic.' },
    ],
  }),
  component: HomePage,
})
