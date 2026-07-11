import http from 'http';
import app from './app';
import { initSocket } from './socket';

const PORT = parseInt(process.env.PORT ?? '4000', 10);

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`[api] Server listening on port ${PORT}`);
});

export { server };
