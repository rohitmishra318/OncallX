import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { alertsRouter } from './routes/alerts';
import { incidentsRouter } from './routes/incidents';
import { servicesRouter } from './routes/services';
import { teamsRouter } from './routes/teams';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors({ origin: '*', methods: '*', allowedHeaders: '*' }));
app.use(express.json());

// Routes
app.use('/auth', authRouter);
app.use('/alerts', alertsRouter);
app.use('/incidents', incidentsRouter);
app.use('/services', servicesRouter);
app.use('/teams', teamsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Global error handler (must be last)
app.use(errorHandler);

export default app;
