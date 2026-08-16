import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: import.meta.env.BASE_URL,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultPendingComponent: () => <div className="boot-screen">Loading icecheck…</div>,
  })
}
