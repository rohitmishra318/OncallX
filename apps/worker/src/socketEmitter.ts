import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

// The worker emits WebSocket events by connecting as a client to the API's Socket.IO server.
// This is the clean separation: worker process → API process → team rooms → browser clients.
function getSocket(): Socket {
  if (!socket) {
    const apiUrl = process.env.API_WS_URL ?? 'http://localhost:4000';
    socket = io(apiUrl, {
      path: '/ws',
      auth: { workerSecret: process.env.WORKER_SECRET ?? 'worker_internal' },
      reconnection: true,
    });
    socket.on('connect_error', (err) => {
      console.error('[worker socket] Connect error:', err.message);
    });
  }
  return socket;
}

export async function emitWorkerEvent(
  teamId: string,
  event: string,
  data: unknown
): Promise<void> {
  const s = getSocket();
  s.emit('worker:emit', { teamId, event, data });
}
