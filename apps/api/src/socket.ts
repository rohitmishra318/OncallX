import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

let io: SocketIOServer;

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: { origin: '*' },
    path: '/ws',
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Unauthorized'));

    try {
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET ?? '') as {
        userId: string;
        teamId: string;
      };
      (socket as Socket & { teamId: string }).teamId = payload.teamId;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const workerSecret = socket.handshake.auth?.workerSecret as string | undefined;

    // Worker process internal connection — relay events into team rooms
    if (workerSecret && workerSecret === (process.env.WORKER_SECRET ?? 'worker_internal')) {
      socket.on('worker:emit', ({ teamId, event, data }: { teamId: string; event: string; data: unknown }) => {
        io.to(`team:${teamId}`).emit(event, data);
      });
      return;
    }

    const teamId = (socket as Socket & { teamId: string }).teamId;
    // Join team-scoped room — users only receive events for their own team
    socket.join(`team:${teamId}`);

    socket.on('disconnect', () => {
      socket.leave(`team:${teamId}`);
    });
  });

  return io;
}

// Emit a WebSocket event to all sockets in the given team room
export function emitToTeam(teamId: string, event: string, data: unknown): void {
  if (io) {
    io.to(`team:${teamId}`).emit(event, data);
  }
}

export function getIO(): SocketIOServer {
  return io;
}
