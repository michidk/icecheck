import { defineWebSocketHandler } from 'h3'
import { nitroSignalingBroker } from '../nitro-signaling.mjs'

export default defineWebSocketHandler({
  open(peer) {
    nitroSignalingBroker.connect(peer)
  },
  message(peer, message) {
    nitroSignalingBroker.receive(peer, message.text())
  },
  close(peer) {
    nitroSignalingBroker.disconnect(peer)
  },
  error(peer) {
    nitroSignalingBroker.disconnect(peer)
  },
})
